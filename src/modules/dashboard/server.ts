/**
 * ==============================================================================
 * APEX AEA — Mission Control: read-only HTTP server
 * ==============================================================================
 * GET-only surface over the agent's SQLite file. The dashboard never writes:
 * queries run through `openReadOnly`, and every non-GET method is rejected
 * before routing. SSE carries the live snapshot to the SPA.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, LedgerEntryType, PositionStatus, SupportedChain } from '../../types.ts';
import {
  DatabaseUnavailableError,
  buildSnapshot,
  openReadOnly,
  positionsSummary,
  readTombstone,
  resolveDashboardConfig,
  sanitizeConfig,
} from './snapshot.ts';
import type { SnapshotOptions, SnapshotState } from './snapshot.ts';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const LEDGER_TYPES = new Set<LedgerEntryType>([
  'INCOME_X402',
  'INCOME_POLYMARKET',
  'INCOME_BOUNTY',
  'EXPENSE_GAS',
  'EXPENSE_LLM',
  'ROYALTY_IN',
  'ROYALTY_OUT',
  'SEED_CAPITAL',
]);

const CHAINS = new Set<SupportedChain>(['base', 'polygon']);
const POSITION_STATUSES = new Set<PositionStatus>(['OPEN', 'WON', 'LOST', 'CANCELLED']);

const EXPORT_TABLES: Record<string, string[]> = {
  actions: ['id', 'component', 'action_type', 'details', 'tier', 'balance_usd', 'timestamp'],
  ledger: ['id', 'tx_hash', 'chain', 'token', 'amount', 'entry_type', 'counterparty', 'timestamp'],
  positions: [
    'id',
    'condition_id',
    'market_id',
    'question',
    'outcome',
    'shares',
    'avg_price',
    'current_value',
    'stake_usd',
    'payout_usd',
    'status',
    'opened_at',
    'closed_at',
  ],
  lineage: [
    'child_address',
    'parent_address',
    'generation',
    'birth_timestamp',
    'seed_capital_usd',
    'total_royalties_paid_usd',
    'status',
  ],
};

export interface DashboardServerOptions {
  host?: string;
  port?: number;
  token?: string;
  dbPath?: string;
  tombstonePath?: string;
  x402HealthUrl?: string | null;
  config?: AppConfig;
  now?: () => number;
  probeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  streamIntervalMs?: number;
}

interface QueryResult {
  status: number;
  body: unknown;
  contentType?: string;
  extraHeaders?: Record<string, string>;
}

type RawRow = Record<string, unknown>;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(columns: string[], rows: RawRow[]): string {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((column) => csvCell(row[column])).join(','));
  return `\ufeff${[header, ...lines].join('\r\n')}\r\n`;
}

export class DashboardServer {
  private options: DashboardServerOptions;
  private state: SnapshotState = { seq: 0 };
  private server: http.Server | null = null;
  private clients = new Set<http.ServerResponse>();
  private startedAt = Date.now();
  private boundUrl = '';
  private snapshotOptions: SnapshotOptions;

  constructor(options: DashboardServerOptions = {}) {
    this.options = options;
    this.snapshotOptions = {
      dbPath: options.dbPath,
      tombstonePath: options.tombstonePath,
      x402HealthUrl: options.x402HealthUrl,
      config: options.config,
      now: options.now,
      probeTimeoutMs: options.probeTimeoutMs,
      fetchImpl: options.fetchImpl,
    };
  }

  get url(): string {
    return this.boundUrl;
  }

  get config(): AppConfig {
    return this.options.config ?? resolveDashboardConfig();
  }

  private get dbPath(): string {
    return this.options.dbPath ?? process.env.DATABASE_PATH ?? './data/agent.db';
  }

  async listen(): Promise<string> {
    if (this.server) return this.boundUrl;
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 0;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          this.sendJson(res, 500, { error: 'InternalError' });
        } else {
          res.end();
        }
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        resolve();
      });
    });
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    this.boundUrl = `http://${displayHost}:${actualPort}`;
    return this.boundUrl;
  }

  async close(): Promise<void> {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // already closed
      }
    }
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ============================================================================
  // Request handling
  // ============================================================================

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method !== 'GET') {
      this.sendJson(res, 405, { error: 'MethodNotAllowed' });
      return;
    }

    if (!this.authorized(req, url)) {
      this.sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (url.pathname === '/') {
      this.sendAsset(res, 'index.html');
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      this.sendAsset(res, url.pathname.slice('/assets/'.length));
      return;
    }

    if (url.pathname === '/api/stream') {
      await this.sendStream(req, res, url);
      return;
    }

    let result: QueryResult;
    try {
      result = await this.route(url);
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        this.sendJson(res, 503, { error: 'DatabaseUnavailable' });
        return;
      }
      throw error;
    }
    this.sendQueryResult(res, result);
  }

  private authorized(req: http.IncomingMessage, url: URL): boolean {
    const token = this.options.token;
    if (!token) return true;
    const header = req.headers.authorization ?? '';
    if (header === `Bearer ${token}`) return true;
    return url.searchParams.get('token') === token;
  }

  private async route(url: URL): Promise<QueryResult> {
    switch (url.pathname) {
      case '/api/snapshot':
        return { status: 200, body: await buildSnapshot(this.state, this.snapshotOptions) };
      case '/api/actions':
        return this.actions(url);
      case '/api/ledger':
        return this.ledger(url);
      case '/api/positions':
        return this.positions(url);
      case '/api/lineage':
        return this.lineage();
      case '/api/config':
        return { status: 200, body: sanitizeConfig(this.config) };
      case '/api/export':
        return this.exportTable(url);
      case '/api/health':
        return this.health();
      default:
        return { status: 404, body: { error: 'NotFound' } };
    }
  }

  private actions(url: URL): QueryResult {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit == null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'limit' } };
    }
    const component = url.searchParams.get('component') || undefined;
    const rawBefore = url.searchParams.get('before');
    let before: number | null = null;
    if (rawBefore != null) {
      before = Number(rawBefore);
      if (!Number.isInteger(before) || before < 1) {
        return { status: 400, body: { error: 'InvalidParameter', parameter: 'before' } };
      }
    }

    if (!fs.existsSync(this.dbPath)) {
      return { status: 200, body: { items: [], nextBefore: null } };
    }
    const db = openReadOnly(this.dbPath);
    try {
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (component) {
        clauses.push('component = ?');
        params.push(component);
      }
      if (before != null) {
        clauses.push('id < ?');
        params.push(before);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM actions ${where} ORDER BY id DESC LIMIT ?;`)
        .all(...params, limit) as RawRow[];
      const items = rows.map((row) => ({
        id: Number(row.id),
        component: String(row.component ?? ''),
        actionType: String(row.action_type ?? ''),
        details: String(row.details ?? ''),
        tier: String(row.tier ?? ''),
        balanceUsd: Number(row.balance_usd ?? 0),
        timestamp: Number(row.timestamp ?? 0),
      }));
      const nextBefore = items.length === limit ? items[items.length - 1].id : null;
      return { status: 200, body: { items, nextBefore } };
    } finally {
      db.close();
    }
  }

  private ledger(url: URL): QueryResult {
    const rawEntryType = url.searchParams.get('entryType');
    if (rawEntryType != null && !LEDGER_TYPES.has(rawEntryType as LedgerEntryType)) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'entryType' } };
    }
    const rawChain = url.searchParams.get('chain');
    if (rawChain != null && !CHAINS.has(rawChain as SupportedChain)) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'chain' } };
    }
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit == null ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'limit' } };
    }

    if (!fs.existsSync(this.dbPath)) {
      return {
        status: 200,
        body: {
          items: [],
          totals: { revenueUsd: 0, expenseUsd: 0, netUsd: 0 },
        },
      };
    }
    const db = openReadOnly(this.dbPath);
    try {
      const clauses: string[] = [];
      const params: string[] = [];
      if (rawEntryType) {
        clauses.push('entry_type = ?');
        params.push(rawEntryType);
      }
      if (rawChain) {
        clauses.push('chain = ?');
        params.push(rawChain);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM ledger ${where} ORDER BY id DESC LIMIT ?;`)
        .all(...params, limit) as RawRow[];
      const items = rows.map((row) => ({
        id: Number(row.id),
        txHash: row.tx_hash == null ? null : String(row.tx_hash),
        chain: String(row.chain ?? ''),
        token: String(row.token ?? ''),
        amount: Number(row.amount ?? 0),
        entryType: String(row.entry_type ?? ''),
        counterparty: row.counterparty == null ? null : String(row.counterparty),
        timestamp: Number(row.timestamp ?? 0),
      }));
      const groups = db
        .prepare('SELECT entry_type, COALESCE(SUM(amount), 0) amount FROM ledger GROUP BY entry_type;')
        .all() as RawRow[];
      let revenue = 0;
      let expense = 0;
      for (const group of groups) {
        const type = String(group.entry_type ?? '');
        const amount = Number(group.amount ?? 0) || 0;
        if (
          type === 'INCOME_X402' ||
          type === 'INCOME_POLYMARKET' ||
          type === 'INCOME_BOUNTY' ||
          type === 'ROYALTY_IN'
        ) {
          revenue += amount;
        } else if (
          type === 'EXPENSE_GAS' ||
          type === 'EXPENSE_LLM' ||
          type === 'ROYALTY_OUT'
        ) {
          expense += amount;
        }
      }
      return {
        status: 200,
        body: {
          items,
          totals: {
            revenueUsd: round2(revenue),
            expenseUsd: round2(expense),
            netUsd: round2(revenue - expense),
          },
        },
      };
    } finally {
      db.close();
    }
  }

  private positions(url: URL): QueryResult {
    const rawStatus = url.searchParams.get('status');
    if (rawStatus != null && !POSITION_STATUSES.has(rawStatus as PositionStatus)) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'status' } };
    }
    if (!fs.existsSync(this.dbPath)) {
      return {
        status: 200,
        body: {
          items: [],
          summary: positionsSummary([]),
        },
      };
    }
    const db = openReadOnly(this.dbPath);
    try {
      const rows = (
        rawStatus
          ? db
              .prepare('SELECT * FROM polymarket_positions WHERE status = ? ORDER BY id DESC LIMIT 500;')
              .all(rawStatus)
          : db.prepare('SELECT * FROM polymarket_positions ORDER BY id DESC LIMIT 500;').all()
      ) as RawRow[];
      const items = rows.map((row) => ({
        id: Number(row.id),
        conditionId: String(row.condition_id ?? ''),
        question: String(row.question ?? ''),
        outcome: String(row.outcome ?? ''),
        shares: Number(row.shares ?? 0),
        avgPrice: Number(row.avg_price ?? 0),
        currentValue: Number(row.current_value ?? 0),
        stakeUsd: Number(row.stake_usd ?? 0),
        payoutUsd: row.payout_usd == null ? null : Number(row.payout_usd),
        status: String(row.status ?? ''),
        openedAt: String(row.opened_at ?? ''),
        closedAt: row.closed_at == null ? null : String(row.closed_at),
      }));
      const summary = positionsSummary(
        items.map((item) => ({
          status: item.status,
          stakeUsd: item.stakeUsd,
          currentValue: item.currentValue,
        }))
      );
      return { status: 200, body: { items, summary } };
    } finally {
      db.close();
    }
  }

  private lineage(): QueryResult {
    if (!fs.existsSync(this.dbPath)) {
      return { status: 200, body: { children: [], royaltiesPaidUsd: 0 } };
    }
    const db = openReadOnly(this.dbPath);
    try {
      const rows = db
        .prepare('SELECT * FROM lineage ORDER BY generation ASC, birth_timestamp ASC;')
        .all() as RawRow[];
      const children = rows.map((row) => ({
        childAddress: String(row.child_address ?? ''),
        parentAddress: String(row.parent_address ?? ''),
        generation: Number(row.generation ?? 0),
        birthTimestamp: Number(row.birth_timestamp ?? 0),
        seedCapitalUsd: Number(row.seed_capital_usd ?? 0),
        totalRoyaltiesPaidUsd: Number(row.total_royalties_paid_usd ?? 0),
        status: String(row.status ?? ''),
      }));
      const royaltiesPaidUsd = round2(
        children.reduce((sum, child) => sum + child.totalRoyaltiesPaidUsd, 0)
      );
      return { status: 200, body: { children, royaltiesPaidUsd } };
    } finally {
      db.close();
    }
  }

  private exportTable(url: URL): QueryResult {
    const table = url.searchParams.get('table');
    if (!table || !(table in EXPORT_TABLES)) {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'table' } };
    }
    const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      return { status: 400, body: { error: 'InvalidParameter', parameter: 'format' } };
    }
    if (!fs.existsSync(this.dbPath)) {
      return { status: 503, body: { error: 'DatabaseUnavailable' } };
    }
    const db = openReadOnly(this.dbPath);
    try {
      const columns = EXPORT_TABLES[table];
      const rows = db
        .prepare(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY rowid ASC LIMIT 10000;`)
        .all() as RawRow[];
      if (format === 'csv') {
        return {
          status: 200,
          body: toCsv(columns, rows),
          contentType: 'text/csv; charset=utf-8',
          extraHeaders: { 'Content-Disposition': `attachment; filename="${table}.csv"` },
        };
      }
      return {
        status: 200,
        body: { table, items: rows },
        contentType: 'application/json; charset=utf-8',
        extraHeaders: { 'Content-Disposition': `attachment; filename="${table}.json"` },
      };
    } finally {
      db.close();
    }
  }

  private health(): QueryResult {
    let database = 'missing';
    if (fs.existsSync(this.dbPath)) {
      try {
        const db = openReadOnly(this.dbPath);
        db.prepare('SELECT 1 AS ok;').get();
        db.close();
        database = 'ok';
      } catch {
        database = 'unavailable';
      }
    }
    return {
      status: 200,
      body: {
        status: 'ok',
        database,
        uptimeMs: Math.max(0, Math.round(Date.now() - this.startedAt)),
        seq: this.state.seq,
        version: 1,
      },
    };
  }

  // ============================================================================
  // SSE
  // ============================================================================

  private async sendStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);

    const lastEventId = Number(
      req.headers['last-event-id'] ?? url.searchParams.get('lastEventId')
    );
    if (Number.isInteger(lastEventId) && lastEventId > this.state.seq) {
      this.state.seq = lastEventId;
    }

    let closed = false;
    let sending = false;

    const send = async () => {
      if (closed || sending) return;
      sending = true;
      try {
        const snapshot = await buildSnapshot(this.state, this.snapshotOptions);
        if (closed) return;
        res.write(`id: ${snapshot.seq}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch {
        if (!closed) {
          res.write('event: error\ndata: {"error":"DatabaseUnavailable"}\n\n');
        }
      } finally {
        sending = false;
      }
    };

    const intervalMs = this.options.streamIntervalMs ?? 2000;
    const snapshotTimer = setInterval(send, intervalMs);
    const pingTimer = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 15000);

    const cleanup = () => {
      closed = true;
      clearInterval(snapshotTimer);
      clearInterval(pingTimer);
      this.clients.delete(res);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    await send();
  }

  // ============================================================================
  // Responses
  // ============================================================================

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  private sendQueryResult(res: http.ServerResponse, result: QueryResult): void {
    if (result.contentType && typeof result.body === 'string') {
      const payload = Buffer.from(result.body, 'utf8');
      res.writeHead(result.status, {
        ...SECURITY_HEADERS,
        ...result.extraHeaders,
        'Content-Type': result.contentType,
        'Content-Length': payload.length,
      });
      res.end(payload);
      return;
    }
    this.sendJson(res, result.status, result.body);
  }

  private sendAsset(res: http.ServerResponse, name: string): void {
    const safeName = path.basename(name);
    if (safeName !== name || name.includes('..')) {
      this.sendJson(res, 404, { error: 'NotFound' });
      return;
    }
    const filePath = path.join(PUBLIC_DIR, safeName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      this.sendJson(res, 404, { error: 'NotFound' });
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const payload = fs.readFileSync(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': ASSET_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': payload.length,
    });
    res.end(payload);
  }
}

export { readTombstone };
