/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Persistence Layer
 * ==============================================================================
 * Zero-dependency SQLite persistence service using Node.js built-in `node:sqlite`.
 * Supports:
 * - WAL (Write-Ahead Logging) journal mode & busy timeout
 * - Foreign key integrity & synchronous normal pragma
 * - In-memory (:memory:) and file-backed database storage with auto-directory creation
 * - Robust nested transactions via SAVEPOINT
 * - 5 schemas: ledger, actions, lineage, system_config, polymarket_positions
 * - Financial ledger aggregations for metabolic accounting & permadeath snapshots
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LedgerEntry,
  ActionEntry,
  LineageEntry,
  SupportedChain,
  LedgerEntryType,
  LineageStatus,
  OrderOutcome,
  PositionStatus,
} from '../types.ts';

export interface PolymarketPositionRecord {
  id?: number;
  conditionId: string;
  marketId?: string;
  question: string;
  outcome: OrderOutcome;
  shares: number;
  avgPrice: number;
  currentValue: number;
  stakeUsd: number;
  payoutUsd?: number;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
}

export class DatabaseService {
  private db: DatabaseSync;
  private transactionDepth = 0;
  private initialized = false;
  private closed = false;

  constructor(dbPath: string = './data/agent.db') {
    if (dbPath !== ':memory:') {
      const resolvedPath = path.resolve(dbPath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(resolvedPath);
    } else {
      this.db = new DatabaseSync(':memory:');
    }

    this.initialize();
  }

  public initialize(): void {
    if (this.initialized) return;

    // Concurrency and Integrity Pragmas
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    // 1. Ledger Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_hash TEXT,
        chain TEXT NOT NULL CHECK(chain IN ('base', 'polygon')),
        token TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount >= 0),
        entry_type TEXT NOT NULL CHECK(entry_type IN (
          'INCOME_X402', 'INCOME_POLYMARKET', 'INCOME_BOUNTY',
          'EXPENSE_GAS', 'EXPENSE_LLM', 'ROYALTY_IN', 'ROYALTY_OUT', 'SEED_CAPITAL'
        )),
        counterparty TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON ledger(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_entry_type ON ledger(entry_type);
      CREATE INDEX IF NOT EXISTS idx_ledger_chain ON ledger(chain);
      CREATE INDEX IF NOT EXISTS idx_ledger_tx_hash ON ledger(tx_hash);
    `);

    // 2. Actions Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component TEXT NOT NULL,
        action_type TEXT NOT NULL,
        details TEXT NOT NULL,
        tier TEXT NOT NULL CHECK(tier IN ('VERDE', 'AMARELO', 'LARANJA', 'VERMELHO')),
        balance_usd REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_actions_timestamp ON actions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_actions_component ON actions(component);
    `);

    // 3. Lineage Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lineage (
        child_address TEXT PRIMARY KEY,
        parent_address TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
        birth_timestamp INTEGER NOT NULL,
        seed_capital_usd REAL NOT NULL CHECK(seed_capital_usd >= 0),
        total_royalties_paid_usd REAL NOT NULL DEFAULT 0.0 CHECK(total_royalties_paid_usd >= 0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INSOLVENT'))
      );
      CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_address);
      CREATE INDEX IF NOT EXISTS idx_lineage_status ON lineage(status);
    `);

    // 4. System Config Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 5. Polymarket Positions Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS polymarket_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT NOT NULL,
        market_id TEXT,
        question TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
        shares REAL NOT NULL DEFAULT 0.0,
        avg_price REAL NOT NULL DEFAULT 0.0,
        current_value REAL NOT NULL DEFAULT 0.0,
        stake_usd REAL NOT NULL DEFAULT 0.0,
        payout_usd REAL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'WON', 'LOST', 'CANCELLED')),
        opened_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_poly_condition ON polymarket_positions(condition_id);
      CREATE INDEX IF NOT EXISTS idx_poly_status ON polymarket_positions(status);
    `);

    this.initialized = true;
    this.closed = false;
  }

  /**
   * Executes a function inside an atomic transaction, supporting arbitrary nested calls.
   * Uses BEGIN IMMEDIATE for top-level transaction and SAVEPOINT for nested levels.
   */
  public transaction<T>(fn: () => T): T {
    this.assertOpen();
    const isRoot = this.transactionDepth === 0;
    const savepoint = `sp_${this.transactionDepth}`;

    if (isRoot) {
      this.db.exec('BEGIN IMMEDIATE;');
    } else {
      this.db.exec(`SAVEPOINT ${savepoint};`);
    }

    this.transactionDepth++;
    try {
      const result = fn();
      if (isRoot) {
        this.db.exec('COMMIT;');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
      }
      return result;
    } catch (err) {
      if (isRoot) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Ignore rollback failure if already rolled back
        }
      } else {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
          this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
        } catch {
          // Ignore savepoint rollback failure
        }
      }
      throw err;
    } finally {
      this.transactionDepth--;
    }
  }

  // ============================================================================
  // Ledger Operations
  // ============================================================================

  public insertLedger(entry: Omit<LedgerEntry, 'id'>): number {
    this.assertOpen();
    const stmt = this.db.prepare(`
      INSERT INTO ledger (tx_hash, chain, token, amount, entry_type, counterparty, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    const res = stmt.run(
      entry.txHash ?? null,
      entry.chain,
      entry.token,
      entry.amount,
      entry.entryType,
      entry.counterparty ?? null,
      entry.timestamp
    );
    return Number(res.lastInsertRowid);
  }

  public getLedgerEntries(limit = 50, offset = 0): LedgerEntry[] {
    this.assertOpen();
    const stmt = this.db.prepare(
      'SELECT * FROM ledger ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?;'
    );
    const rows = stmt.all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      txHash: (r.tx_hash as string) ?? undefined,
      chain: r.chain as SupportedChain,
      token: r.token as string,
      amount: Number(r.amount),
      entryType: r.entry_type as LedgerEntryType,
      counterparty: (r.counterparty as string) ?? undefined,
      timestamp: Number(r.timestamp),
    }));
  }

  public getTotalRevenue(): number {
    this.assertOpen();
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0.0) as rev
      FROM ledger
      WHERE entry_type IN ('INCOME_X402', 'INCOME_POLYMARKET', 'INCOME_BOUNTY', 'ROYALTY_IN');
    `);
    const result = stmt.get() as { rev: number };
    return Number(result.rev ?? 0);
  }

  public getTotalExpenses(): number {
    this.assertOpen();
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0.0) as exp
      FROM ledger
      WHERE entry_type IN ('EXPENSE_GAS', 'EXPENSE_LLM', 'ROYALTY_OUT');
    `);
    const result = stmt.get() as { exp: number };
    return Number(result.exp ?? 0);
  }

  public getLedgerSnapshot(limit = 100): LedgerEntry[] {
    return this.getLedgerEntries(limit, 0);
  }

  public hasTxHash(txHash: string): boolean {
    this.assertOpen();
    const stmt = this.db.prepare('SELECT 1 FROM ledger WHERE tx_hash = ? LIMIT 1;');
    return stmt.get(txHash) !== undefined;
  }

  // ============================================================================
  // Actions Operations
  // ============================================================================

  public recordAction(action: Omit<ActionEntry, 'id'>): number {
    this.assertOpen();
    const stmt = this.db.prepare(`
      INSERT INTO actions (component, action_type, details, tier, balance_usd, timestamp)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    const res = stmt.run(
      action.component,
      action.actionType,
      action.details,
      action.tier,
      action.balanceUsd,
      action.timestamp
    );
    return Number(res.lastInsertRowid);
  }

  public getActions(limit = 50, component?: string): ActionEntry[] {
    this.assertOpen();
    let rows: Record<string, unknown>[];
    if (component) {
      const stmt = this.db.prepare(
        'SELECT * FROM actions WHERE component = ? ORDER BY timestamp DESC, id DESC LIMIT ?;'
      );
      rows = stmt.all(component, limit) as Record<string, unknown>[];
    } else {
      const stmt = this.db.prepare(
        'SELECT * FROM actions ORDER BY timestamp DESC, id DESC LIMIT ?;'
      );
      rows = stmt.all(limit) as Record<string, unknown>[];
    }
    return rows.map((r) => ({
      id: Number(r.id),
      component: r.component as string,
      actionType: r.action_type as string,
      details: r.details as string,
      tier: r.tier as string,
      balanceUsd: Number(r.balance_usd),
      timestamp: Number(r.timestamp),
    }));
  }

  // ============================================================================
  // Lineage Operations
  // ============================================================================

  public recordLineage(entry: LineageEntry): void {
    this.assertOpen();
    const stmt = this.db.prepare(`
      INSERT INTO lineage (child_address, parent_address, generation, birth_timestamp, seed_capital_usd, total_royalties_paid_usd, status)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      entry.childAddress,
      entry.parentAddress,
      entry.generation,
      entry.birthTimestamp,
      entry.seedCapitalUsd,
      entry.totalRoyaltiesPaidUsd,
      entry.status
    );
  }

  public getLineageByChild(childAddress: string): LineageEntry | null {
    this.assertOpen();
    const stmt = this.db.prepare('SELECT * FROM lineage WHERE child_address = ?;');
    const r = stmt.get(childAddress) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      childAddress: r.child_address as string,
      parentAddress: r.parent_address as string,
      generation: Number(r.generation),
      birthTimestamp: Number(r.birth_timestamp),
      seedCapitalUsd: Number(r.seed_capital_usd),
      totalRoyaltiesPaidUsd: Number(r.total_royalties_paid_usd),
      status: r.status as LineageStatus,
    };
  }

  public updateRoyaltiesPaid(
    childAddress: string,
    additionalUsd: number,
    parentAddress: string = '0x0000000000000000000000000000000000000000'
  ): void {
    this.assertOpen();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO lineage (
        child_address, parent_address, generation, birth_timestamp,
        seed_capital_usd, total_royalties_paid_usd, status
      )
      VALUES (?, ?, 1, ?, 0.0, ?, 'ACTIVE')
      ON CONFLICT(child_address) DO UPDATE SET
        total_royalties_paid_usd = total_royalties_paid_usd + excluded.total_royalties_paid_usd;
    `);
    stmt.run(childAddress, parentAddress, now, additionalUsd);
  }

  public updateLineageStatus(childAddress: string, status: LineageStatus): void {
    this.assertOpen();
    const stmt = this.db.prepare('UPDATE lineage SET status = ? WHERE child_address = ?;');
    stmt.run(status, childAddress);
  }

  // ============================================================================
  // System Config Operations
  // ============================================================================

  public setConfig(key: string, value: string): void {
    this.assertOpen();
    const stmt = this.db.prepare(`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    `);
    stmt.run(key, value, Date.now());
  }

  public getConfig(key: string): string | null {
    this.assertOpen();
    const stmt = this.db.prepare('SELECT value FROM system_config WHERE key = ?;');
    const r = stmt.get(key) as Record<string, unknown> | undefined;
    return r ? (r.value as string) : null;
  }

  // ============================================================================
  // Polymarket Positions Operations
  // ============================================================================

  public savePosition(pos: PolymarketPositionRecord): number {
    this.assertOpen();
    const stmt = this.db.prepare(`
      INSERT INTO polymarket_positions (
        condition_id, market_id, question, outcome, shares, avg_price, current_value, stake_usd, payout_usd, status, opened_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    const res = stmt.run(
      pos.conditionId,
      pos.marketId ?? null,
      pos.question,
      pos.outcome,
      pos.shares,
      pos.avgPrice,
      pos.currentValue,
      pos.stakeUsd,
      pos.payoutUsd ?? null,
      pos.status,
      pos.openedAt,
      pos.closedAt ?? null
    );
    return Number(res.lastInsertRowid);
  }

  public getPositionById(id: number): PolymarketPositionRecord | null {
    this.assertOpen();
    const stmt = this.db.prepare('SELECT * FROM polymarket_positions WHERE id = ?;');
    const r = stmt.get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      conditionId: r.condition_id as string,
      marketId: (r.market_id as string) ?? undefined,
      question: r.question as string,
      outcome: r.outcome as OrderOutcome,
      shares: Number(r.shares),
      avgPrice: Number(r.avg_price),
      currentValue: Number(r.current_value),
      stakeUsd: Number(r.stake_usd),
      payoutUsd: r.payout_usd !== null ? Number(r.payout_usd) : undefined,
      status: r.status as PositionStatus,
      openedAt: r.opened_at as string,
      closedAt: (r.closed_at as string) ?? undefined,
    };
  }

  public getPositions(limit = 50, status?: PositionStatus): PolymarketPositionRecord[] {
    this.assertOpen();
    let rows: Record<string, unknown>[];
    if (status) {
      const stmt = this.db.prepare(
        'SELECT * FROM polymarket_positions WHERE status = ? ORDER BY id DESC LIMIT ?;'
      );
      rows = stmt.all(status, limit) as Record<string, unknown>[];
    } else {
      const stmt = this.db.prepare(
        'SELECT * FROM polymarket_positions ORDER BY id DESC LIMIT ?;'
      );
      rows = stmt.all(limit) as Record<string, unknown>[];
    }
    return rows.map((r) => ({
      id: Number(r.id),
      conditionId: r.condition_id as string,
      marketId: (r.market_id as string) ?? undefined,
      question: r.question as string,
      outcome: r.outcome as OrderOutcome,
      shares: Number(r.shares),
      avgPrice: Number(r.avg_price),
      currentValue: Number(r.current_value),
      stakeUsd: Number(r.stake_usd),
      payoutUsd: r.payout_usd !== null ? Number(r.payout_usd) : undefined,
      status: r.status as PositionStatus,
      openedAt: r.opened_at as string,
      closedAt: (r.closed_at as string) ?? undefined,
    }));
  }

  public updatePositionStatus(
    id: number,
    status: PositionStatus,
    payoutUsd?: number,
    closedAt?: string
  ): void {
    this.assertOpen();
    const stmt = this.db.prepare(`
      UPDATE polymarket_positions
      SET status = ?, payout_usd = COALESCE(?, payout_usd), closed_at = COALESCE(?, closed_at)
      WHERE id = ?;
    `);
    stmt.run(status, payoutUsd ?? null, closedAt ?? null, id);
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  public close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
      this.initialized = false;
    }
  }

  public isOpen(): boolean {
    return this.initialized && !this.closed;
  }

  private assertOpen(): void {
    if (this.closed || !this.initialized) {
      throw new Error('Database is closed or uninitialized.');
    }
  }
}

/**
 * Singleton database instance helper.
 */
let instance: DatabaseService | null = null;

export function getDatabase(dbPath?: string): DatabaseService {
  if (!instance || !instance.isOpen()) {
    instance = new DatabaseService(dbPath);
  }
  return instance;
}

export function resetDatabase(): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // Ignored
    }
    instance = null;
  }
}
