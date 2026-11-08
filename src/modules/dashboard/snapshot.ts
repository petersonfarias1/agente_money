/**
 * ==============================================================================
 * APEX AEA — Mission Control: snapshot builder
 * ==============================================================================
 * A Snapshot is an immutable portrait of the agent at one instant. It is read
 * from the agent's SQLite file through a `readOnly` handle, from the cached
 * runtime configuration and from the tombstone on disk. Nothing here writes.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import type { AppConfig, ModelClass, MetabolicTier, TierStatus } from '../../types.ts';
import { getConfig } from '../../config.ts';
import { evaluateTier } from '../../core/metabolism.ts';

// ==============================================================================
// Types
// ==============================================================================

export type LivenessState = 'ALIVE' | 'STALE' | 'DEAD' | 'UNKNOWN';

export interface SnapshotState {
  seq: number;
}

export interface ActionRow {
  id: number;
  component: string;
  actionType: string;
  details: string;
  tier: string;
  balanceUsd: number;
  timestamp: number;
}

export interface LedgerRow {
  id: number;
  txHash?: string;
  chain: string;
  token: string;
  amount: number;
  entryType: string;
  counterparty?: string;
  timestamp: number;
}

export interface PositionRow {
  id: number;
  conditionId: string;
  question: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  currentValue: number;
  stakeUsd: number;
  payoutUsd?: number;
  status: string;
  openedAt: string;
  closedAt?: string;
}

export interface Liveness {
  state: LivenessState;
  lastTickAt: number | null;
  ageMs: number | null;
  tierIntervalMs: number;
  detail: string;
}

export interface SnapshotOptions {
  dbPath?: string;
  tombstonePath?: string;
  x402HealthUrl?: string | null;
  config?: AppConfig;
  now?: () => number;
  probeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const TIER_RANK: Record<string, number> = {
  VERDE: 4,
  AMARELO: 3,
  LARANJA: 2,
  VERMELHO: 1,
};

const INCOME_TYPES = new Set([
  'INCOME_X402',
  'INCOME_POLYMARKET',
  'INCOME_BOUNTY',
  'ROYALTY_IN',
]);
const EXPENSE_TYPES = new Set(['EXPENSE_GAS', 'EXPENSE_LLM', 'ROYALTY_OUT']);
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export class DatabaseUnavailableError extends Error {
  constructor(message = 'DatabaseUnavailable') {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

// ==============================================================================
// Read-only boundary
// ==============================================================================

/**
 * The only way the dashboard touches SQLite. `readOnly: true` makes SQLite
 * reject writes at the engine, not at our own guard clauses.
 */
export function openReadOnly(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}

// ==============================================================================
// Liveness
// ==============================================================================

export function deriveLiveness(input: {
  now: number;
  lastTickAt: number | null;
  tierIntervalMs: number;
  lastActionType?: string | null;
}): Liveness {
  const now = Number(input.now);
  const lastTickAt = input.lastTickAt == null ? null : Number(input.lastTickAt);
  const tierIntervalMs = Number(input.tierIntervalMs) || 0;

  if (lastTickAt == null) {
    if (input.lastActionType === 'PERMADEATH_EXECUTED') {
      return {
        state: 'DEAD',
        lastTickAt: null,
        ageMs: null,
        tierIntervalMs,
        detail: 'permadeath executado',
      };
    }
    return {
      state: 'UNKNOWN',
      lastTickAt: null,
      ageMs: null,
      tierIntervalMs,
      detail: 'nenhuma operação registrada',
    };
  }

  const ageMs = Math.max(0, now - lastTickAt);

  if (input.lastActionType === 'PERMADEATH_EXECUTED') {
    return {
      state: 'DEAD',
      lastTickAt,
      ageMs,
      tierIntervalMs,
      detail: 'permadeath executado',
    };
  }

  if (ageMs > FIFTEEN_MINUTES) {
    return {
      state: 'DEAD',
      lastTickAt,
      ageMs,
      tierIntervalMs,
      detail: `sem tick há ${Math.floor(ageMs / 60000)} min`,
    };
  }

  if (ageMs > tierIntervalMs * 2) {
    return {
      state: 'STALE',
      lastTickAt,
      ageMs,
      tierIntervalMs,
      detail: `sem tick há ${Math.floor(ageMs / 60000)} min`,
    };
  }

  return { state: 'ALIVE', lastTickAt, ageMs, tierIntervalMs, detail: 'tick recente' };
}

// ==============================================================================
// Pure derivations
// ==============================================================================

export function alertSeverity(actionType: string): 'critical' | 'warning' | 'info' {
  if (
    actionType === 'PERMADEATH_EXECUTED' ||
    actionType === 'IMMUNE_SYSTEM_ROLLBACK' ||
    actionType === 'TICK_FAILED'
  ) {
    return 'critical';
  }
  if (actionType === 'REPLAY_ATTACK_PREVENTED' || actionType === 'DAEMON_STOPPED') {
    return 'warning';
  }
  return 'info';
}

export interface TierTransition {
  from: string;
  to: string;
  direction: 'up' | 'down';
  severity: 'info' | 'warning';
  timestamp: number;
  actionId: number;
}

export function tierTransitions(
  actions: Array<Pick<ActionRow, 'id' | 'tier' | 'timestamp'>>
): TierTransition[] {
  const ordered = actions.slice().sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id - b.id;
  });
  const out: TierTransition[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous.tier || !current.tier || previous.tier === current.tier) continue;
    const fromRank = TIER_RANK[previous.tier];
    const toRank = TIER_RANK[current.tier];
    if (fromRank === undefined || toRank === undefined) continue;
    const down = toRank < fromRank;
    out.push({
      from: previous.tier,
      to: current.tier,
      direction: down ? 'down' : 'up',
      severity: down ? 'warning' : 'info',
      timestamp: current.timestamp,
      actionId: current.id,
    });
  }
  return out;
}

export interface Alert {
  id: number;
  severity: 'critical' | 'warning' | 'info';
  component: string;
  actionType: string;
  timestamp: number;
  message: string;
}

export function buildAlerts(
  actions: Array<Pick<ActionRow, 'id' | 'component' | 'actionType' | 'timestamp'>>
): Alert[] {
  return actions
    .slice()
    .sort((a, b) => (b.timestamp - a.timestamp) || (b.id - a.id))
    .slice(0, 20)
    .map((a) => ({
      id: a.id,
      severity: alertSeverity(a.actionType),
      component: a.component,
      actionType: a.actionType,
      timestamp: a.timestamp,
      message: `${a.component} · ${a.actionType}`,
    }));
}

export interface RevenueGroup {
  entryType: string;
  amountUsd: number;
  count: number;
}

export function revenueByType(
  rows: Array<{ entryType: string; amount: number }>
): RevenueGroup[] {
  const groups = new Map<string, RevenueGroup>();
  for (const row of rows) {
    const key = row.entryType;
    const existing = groups.get(key) ?? { entryType: key, amountUsd: 0, count: 0 };
    existing.amountUsd += Number(row.amount) || 0;
    existing.count += 1;
    groups.set(key, existing);
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, amountUsd: round2(g.amountUsd) }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

export interface PositionsSummary {
  counts: { OPEN: number; WON: number; LOST: number; CANCELLED: number };
  openExposureUsd: number;
  winRate: number | null;
  total: number;
}

export function winRate(won: number, lost: number): number | null {
  const w = Number(won) || 0;
  const l = Number(lost) || 0;
  return w + l <= 0 ? null : w / (w + l);
}

export function positionsSummary(
  rows: Array<{ status: string; stakeUsd?: number; currentValue?: number }>
): PositionsSummary {
  const counts = { OPEN: 0, WON: 0, LOST: 0, CANCELLED: 0 };
  let exposure = 0;
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
    if (row.status === 'OPEN') exposure += Number(row.stakeUsd ?? row.currentValue ?? 0) || 0;
  }
  return {
    counts,
    openExposureUsd: round2(exposure),
    winRate: winRate(counts.WON, counts.LOST),
    total: rows.length,
  };
}

export function allowedOperations(status: {
  allowSpeculativeResearch: boolean;
  allowSelfModification: boolean;
}): string[] {
  const operations = ['ciclo de heartbeat', 'leitura de saldo'];
  if (status.allowSpeculativeResearch) operations.push('pesquisa especulativa');
  if (status.allowSelfModification) operations.push('automodificação');
  if (!status.allowSpeculativeResearch && !status.allowSelfModification) {
    operations.push('operações de sobrevivência');
  }
  return operations;
}

export interface SanitizedConfig extends Record<string, unknown> {
  privateKey?: never;
}

const SENSITIVE_NAME = /(privatekey|secret|passphrase|token|apikey)/;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/_/g, '').toLowerCase();
      if (normalized === 'privatekey') continue;
      out[key] = SENSITIVE_NAME.test(normalized) ? '***' : redact(child);
    }
    return out;
  }
  return value;
}

export function sanitizeConfig(config: AppConfig): SanitizedConfig {
  return redact(config) as SanitizedConfig;
}

// ==============================================================================
// Tombstone
// ==============================================================================

export interface TombstoneState {
  present: boolean;
  invalid?: boolean;
  path?: string;
  reason?: string;
  deathTimestamp?: string;
  totalCyclesExecuted?: number;
  totalRevenueGenerated?: number;
  totalExpensesIncurred?: number;
  data?: Record<string, unknown>;
}

export function readTombstone(tombstonePath = 'tombstone.json'): TombstoneState {
  const resolved = tombstonePath;
  if (!fs.existsSync(resolved)) return { present: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return { present: true, invalid: true, path: resolved };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: true, invalid: true, path: resolved };
  }
  const data = parsed as Record<string, unknown>;
  return {
    present: true,
    path: resolved,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    deathTimestamp:
      typeof data.deathTimestamp === 'string' ? data.deathTimestamp : undefined,
    totalCyclesExecuted: Number(data.totalCyclesExecuted ?? 0),
    totalRevenueGenerated: Number(data.totalRevenueGenerated ?? 0),
    totalExpensesIncurred: Number(data.totalExpensesIncurred ?? 0),
    data,
  };
}

// ==============================================================================
// Snapshot
// ==============================================================================

const FALLBACK_CONFIG: AppConfig = {
  nodeEnv: 'production',
  logLevel: 'info',
  networkMode: 'mock',
  network: {
    baseRpcUrl: '',
    polygonRpcUrl: '',
    baseUsdcAddress: '',
    polygonUsdcAddress: '',
    isMock: true,
  },
  privateKey: '',
  motherWalletAddress: '',
  initialCapitalUsd: 0,
  tierThresholds: { green: 50, yellow: 10, orange: 2, red: 0 },
  heartbeatIntervals: { greenMs: 60000, yellowMs: 300000, orangeMs: 60000 },
  kelly: { fraction: 0.25, maxBankrollCap: 0.05 },
  polymarket: { clobApiUrl: '' },
  x402: { port: 4020, priceUsdc: 0.01, settlementChain: 'base' },
  bounties: { minRewardUsd: 10 },
  evolution: { mitosisMultiplier: 3, royaltyPercentage: 5 },
  mock: { useMockApis: true, initialBalanceUsd: 75, simulateErrors: false },
};

export function resolveDashboardConfig(injected?: AppConfig): AppConfig {
  if (injected) return injected;
  try {
    return getConfig();
  } catch {
    return FALLBACK_CONFIG;
  }
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

interface RawRow {
  [key: string]: unknown;
}

function mapAction(row: RawRow): ActionRow {
  return {
    id: Number(row.id),
    component: String(row.component ?? ''),
    actionType: String(row.action_type ?? ''),
    details: String(row.details ?? ''),
    tier: String(row.tier ?? ''),
    balanceUsd: Number(row.balance_usd ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  };
}

function mapLedger(row: RawRow): LedgerRow {
  return {
    id: Number(row.id),
    txHash: row.tx_hash == null ? undefined : String(row.tx_hash),
    chain: String(row.chain ?? ''),
    token: String(row.token ?? ''),
    amount: Number(row.amount ?? 0),
    entryType: String(row.entry_type ?? ''),
    counterparty: row.counterparty == null ? undefined : String(row.counterparty),
    timestamp: Number(row.timestamp ?? 0),
  };
}

function mapPosition(row: RawRow): PositionRow {
  return {
    id: Number(row.id),
    conditionId: String(row.condition_id ?? ''),
    question: String(row.question ?? ''),
    outcome: String(row.outcome ?? ''),
    shares: Number(row.shares ?? 0),
    avgPrice: Number(row.avg_price ?? 0),
    currentValue: Number(row.current_value ?? 0),
    stakeUsd: Number(row.stake_usd ?? 0),
    payoutUsd: row.payout_usd == null ? undefined : Number(row.payout_usd),
    status: String(row.status ?? ''),
    openedAt: String(row.opened_at ?? ''),
    closedAt: row.closed_at == null ? undefined : String(row.closed_at),
  };
}

function capSeries(points: Array<{ t: number; usd: number }>, max = 240): Array<{ t: number; usd: number }> {
  if (points.length <= max) return points;
  const out: Array<{ t: number; usd: number }> = [];
  for (let i = 0; i < max; i++) {
    const end = Math.floor(((i + 1) * points.length) / max) - 1;
    out.push(points[Math.max(0, Math.min(end, points.length - 1))]);
  }
  return out;
}

async function probeX402(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ reachable: boolean; reason?: string; health?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { reachable: false, reason: 'unreachable' };
    let health: unknown = null;
    try {
      health = await response.json();
    } catch {
      health = null;
    }
    return { reachable: true, health };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return {
      reachable: false,
      reason: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the next snapshot of a process. `state.seq` is the only mutable value;
 * two calls in a row always produce 1 and 2.
 */
export async function buildSnapshot(
  state: SnapshotState,
  options: SnapshotOptions = {}
): Promise<Record<string, unknown>> {
  state.seq += 1;
  const seq = state.seq;
  const now = options.now ? options.now() : Date.now();
  const config = resolveDashboardConfig(options.config);
  const dbPath = options.dbPath ?? process.env.DATABASE_PATH ?? './data/agent.db';
  const tombstonePath = options.tombstonePath ?? process.env.TOMBSTONE_PATH ?? 'tombstone.json';
  const tombstone = readTombstone(tombstonePath);

  let actions: ActionRow[] = [];
  let ledgerRows: LedgerRow[] = [];
  let ledgerGroups: RawRow[] = [];
  let positions: PositionRow[] = [];
  let lineage: RawRow[] = [];
  let systemConfig: RawRow[] = [];
  let cycleCount = 0;
  let actionCount = 0;
  let lastTickAt: number | null = null;
  let lastBalanceUsd: number | null = null;
  let last7dExpenses = 0;
  let componentCounts: RawRow[] = [];
  let series: Array<{ t: number; usd: number }> = [];

  if (fs.existsSync(dbPath)) {
    let db: DatabaseSync | null = null;
    try {
      db = openReadOnly(dbPath);
      actions = (db
        .prepare('SELECT * FROM actions ORDER BY id DESC LIMIT 200;')
        .all() as RawRow[]).map(mapAction);
      cycleCount = Number(
        (db.prepare("SELECT COUNT(*) c FROM actions WHERE action_type = 'TICK_EVALUATED';").get() as RawRow)?.c ?? 0
      );
      actionCount = Number(
        (db.prepare('SELECT COUNT(*) c FROM actions;').get() as RawRow)?.c ?? 0
      );
      lastTickAt =
        Number(
          (db
            .prepare("SELECT timestamp FROM actions WHERE action_type = 'TICK_EVALUATED' ORDER BY id DESC LIMIT 1;")
            .get() as RawRow | undefined)?.timestamp ?? 0
        ) || null;
      ledgerRows = (db
        .prepare('SELECT * FROM ledger ORDER BY id ASC LIMIT 5000;')
        .all() as RawRow[]).map(mapLedger);
      ledgerGroups = db
        .prepare('SELECT entry_type, COALESCE(SUM(amount), 0) amount, COUNT(*) c FROM ledger GROUP BY entry_type;')
        .all() as RawRow[];
      last7dExpenses = Number(
        (db
          .prepare(
            "SELECT COALESCE(SUM(amount), 0) e FROM ledger WHERE entry_type IN ('EXPENSE_GAS', 'EXPENSE_LLM', 'ROYALTY_OUT') AND timestamp >= ?;"
          )
          .get(now - SEVEN_DAYS) as RawRow)?.e ?? 0
      );
      positions = (db
        .prepare('SELECT * FROM polymarket_positions ORDER BY id DESC LIMIT 500;')
        .all() as RawRow[]).map(mapPosition);
      lineage = db
        .prepare('SELECT * FROM lineage ORDER BY generation ASC, birth_timestamp ASC;')
        .all() as RawRow[];
      systemConfig = db.prepare('SELECT * FROM system_config ORDER BY key ASC;').all() as RawRow[];
      componentCounts = db
        .prepare('SELECT component, COUNT(*) c FROM actions GROUP BY component ORDER BY c DESC LIMIT 8;')
        .all() as RawRow[];
      series = (db
        .prepare("SELECT timestamp t, balance_usd usd FROM actions WHERE action_type = 'TICK_EVALUATED' ORDER BY id DESC LIMIT 2000;")
        .all() as RawRow[])
        .map((r) => ({ t: Number(r.t), usd: Number(r.usd) }))
        .reverse();
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) throw error;
      throw new DatabaseUnavailableError(
        `SQLite read failed for ${dbPath}: ${(error as Error).message}`
      );
    } finally {
      try {
        db?.close();
      } catch {
        // the handle may already be closed after a failed open
      }
    }
  }

  const newestAction = actions[0] ?? null;
  if (newestAction) lastBalanceUsd = newestAction.balanceUsd;

  let tierStatus: TierStatus | null = null;
  if (lastBalanceUsd != null && Number.isFinite(lastBalanceUsd)) {
    tierStatus = evaluateTier(lastBalanceUsd, {
      thresholds: config.tierThresholds,
      intervals: config.heartbeatIntervals,
    });
  }

  const liveness = deriveLiveness({
    now,
    lastTickAt,
    tierIntervalMs: tierStatus?.heartbeatIntervalMs ?? 0,
    lastActionType: newestAction?.actionType ?? null,
  });

  let revenueUsd = 0;
  let expenseUsd = 0;
  for (const row of ledgerGroups) {
    const entryType = String(row.entry_type ?? '');
    const amount = Number(row.amount ?? 0) || 0;
    if (INCOME_TYPES.has(entryType)) revenueUsd += amount;
    else if (EXPENSE_TYPES.has(entryType)) expenseUsd += amount;
  }
  revenueUsd = round2(revenueUsd);
  expenseUsd = round2(expenseUsd);
  const runwayDays =
    last7dExpenses > 0 && lastBalanceUsd != null
      ? round2(lastBalanceUsd / (last7dExpenses / 7))
      : null;

  const summary = positionsSummary(positions);
  const royaltiesPaidUsd = round2(
    lineage.reduce((sum, row) => sum + (Number(row.total_royalties_paid_usd) || 0), 0)
  );

  const x402Url =
    options.x402HealthUrl === null
      ? null
      : options.x402HealthUrl ?? `http://127.0.0.1:${config.x402.port}/health`;
  const probe = x402Url
    ? await probeX402(
        x402Url,
        options.probeTimeoutMs ?? 800,
        options.fetchImpl ?? fetch
      )
    : { reachable: false, reason: 'disabled' };

  const degraded: Record<string, string> = {};
  if (x402Url && !probe.reachable && probe.reason) degraded.x402 = probe.reason;

  const sanitized = sanitizeConfig(config) as Record<string, unknown>;
  sanitized.systemConfig = systemConfig.map((row) => ({
    key: String(row.key ?? ''),
    value: SENSITIVE_NAME.test(String(row.key ?? '').replace(/_/g, '').toLowerCase())
      ? '***'
      : String(row.value ?? ''),
    updatedAt: Number(row.updated_at ?? 0),
  }));

  const tier: {
    tier: MetabolicTier | null;
    modelClass: ModelClass | null;
    heartbeatIntervalMs: number;
    allowSpeculativeResearch: boolean;
    allowSelfModification: boolean;
    reason: string | null;
    operations: string[];
  } | null = tierStatus
    ? {
        tier: tierStatus.tier,
        modelClass: tierStatus.modelClass,
        heartbeatIntervalMs: tierStatus.heartbeatIntervalMs,
        allowSpeculativeResearch: tierStatus.allowSpeculativeResearch,
        allowSelfModification: tierStatus.allowSelfModification,
        reason: tierStatus.reason ?? null,
        operations: allowedOperations(tierStatus),
      }
    : null;

  return {
    generatedAt: now,
    seq,
    networkMode: config.networkMode,
    agent: {
      name: tombstone.present && !tombstone.invalid ? (tombstone.data?.agentName ?? null) : null,
      address:
        tombstone.present && !tombstone.invalid
          ? (tombstone.data?.agentAddress ?? null)
          : (config.motherWalletAddress || null),
      generation:
        tombstone.present && !tombstone.invalid
          ? Number(tombstone.data?.generation ?? 0) || null
          : null,
      mode: config.network.isMock ? 'mock' : 'live',
    },
    liveness,
    tier,
    balance: {
      totalUsd: lastBalanceUsd,
      source: lastBalanceUsd == null ? 'none' : 'last-action',
      updatedAt: newestAction?.timestamp ?? null,
    },
    kpi: {
      cycles: cycleCount,
      actions: actionCount,
      components: componentCounts.length,
      criticalAlerts: buildAlerts(actions).filter((a) => a.severity === 'critical').length,
    },
    revenue: {
      totalUsd: revenueUsd,
      expenseUsd,
      netUsd: round2(revenueUsd - expenseUsd),
      burn7dUsd: round2(last7dExpenses),
      runwayDays,
      byType: revenueByType(ledgerRows),
      series: capSeries(series),
    },
    activity: {
      recentActions: actions.slice(0, 10),
      components: componentCounts.map((row) => ({
        component: String(row.component ?? ''),
        count: Number(row.c ?? 0),
      })),
      transitions: tierTransitions(actions),
    },
    alerts: buildAlerts(actions),
    positions: {
      ...summary,
      items: positions.slice(0, 50),
    },
    lineage: {
      children: lineage.map((row) => ({
        childAddress: String(row.child_address ?? ''),
        parentAddress: String(row.parent_address ?? ''),
        generation: Number(row.generation ?? 0),
        birthTimestamp: Number(row.birth_timestamp ?? 0),
        seedCapitalUsd: Number(row.seed_capital_usd ?? 0),
        totalRoyaltiesPaidUsd: Number(row.total_royalties_paid_usd ?? 0),
        status: String(row.status ?? ''),
      })),
      royaltiesPaidUsd,
    },
    x402: {
      reachable: probe.reachable,
      url: x402Url,
      health: probe.health ?? null,
      reason: probe.reason ?? null,
    },
    config: sanitized,
    degraded,
    tombstone,
  };
}
