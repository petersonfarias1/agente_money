/**
 * ==============================================================================
 * Unit Test Suite: Mission Control — read-only HTTP server
 * ==============================================================================
 * Proofs for C10, C15-C19, C29, C31, C35, C39-C52.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../src/types.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { DashboardServer } from '../../src/modules/dashboard/server.ts';
import { openReadOnly } from '../../src/modules/dashboard/snapshot.ts';

const NOW = 1_800_000_000_000;
const temporaryDirs: string[] = [];
const runningServers: DashboardServer[] = [];
const extraServers: http.Server[] = [];

afterEach(async () => {
  for (const server of runningServers.splice(0)) {
    await server.close();
  }
  for (const server of extraServers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of temporaryDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'info',
    networkMode: 'mock',
    network: {
      baseRpcUrl: '',
      polygonRpcUrl: '',
      baseUsdcAddress: '0x0000000000000000000000000000000000000001',
      polygonUsdcAddress: '0x0000000000000000000000000000000000000002',
      isMock: true,
    },
    privateKey: '0xSUPERSECRETPRIVATEKEY',
    motherWalletAddress: '0x1111111111111111111111111111111111111111',
    initialCapitalUsd: 75,
    tierThresholds: { green: 50, yellow: 10, orange: 2, red: 0 },
    heartbeatIntervals: { greenMs: 60000, yellowMs: 300000, orangeMs: 60000 },
    kelly: { fraction: 0.25, maxBankrollCap: 0.05 },
    polymarket: {
      clobApiUrl: '',
      apiKey: 'APIKEY-SECRET-VALUE',
      apiSecret: 'APISECRET-SECRET-VALUE',
      apiPassphrase: 'PASSPHRASE-SECRET-VALUE',
    },
    x402: { port: 4020, priceUsdc: 0.01, settlementChain: 'base' },
    bounties: { githubToken: 'GITHUB-TOKEN-SECRET-VALUE', minRewardUsd: 10 },
    evolution: { mitosisMultiplier: 3, royaltyPercentage: 5 },
    inference: {
      mode: 'free',
      capPerTick: 5,
      providers: [
        {
          id: 'ollama',
          type: 'ollama',
          baseUrl: 'http://localhost:11434',
          model: 'llama3',
          free: true,
        },
      ],
    },
    mock: { useMockApis: true, initialBalanceUsd: 75, simulateErrors: false },
  };
}

function createDb(seed?: (db: DatabaseService) => void): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dashboard-server-'));
  temporaryDirs.push(dir);
  const dbPath = path.join(dir, 'agent.db');
  const db = new DatabaseService(dbPath);
  seed?.(db);
  db.close();
  return { dir, dbPath };
}

function recordTick(db: DatabaseService, balanceUsd = 25, timestamp = NOW - 1000): void {
  db.recordAction({
    component: 'heartbeat',
    actionType: 'TICK_EVALUATED',
    details: '{"cycle":1}',
    tier: balanceUsd > 50 ? 'VERDE' : balanceUsd >= 10 ? 'AMARELO' : balanceUsd > 0 ? 'LARANJA' : 'VERMELHO',
    balanceUsd,
    timestamp,
  });
}

function recordMany(db: DatabaseService, count: number, component = 'heartbeat'): void {
  for (let i = 0; i < count; i++) {
    db.recordAction({
      component,
      actionType: i % 2 === 0 ? 'TICK_EVALUATED' : 'TASK_SKIPPED',
      details: JSON.stringify({ index: i }),
      tier: 'VERDE',
      balanceUsd: 100 + i,
      timestamp: NOW - count * 1000 + i * 1000,
    });
  }
}

async function startServer(
  options: ConstructorParameters<typeof DashboardServer>[0] = {}
): Promise<{ server: DashboardServer; base: string }> {
  const server = new DashboardServer(options);
  runningServers.push(server);
  const base = await server.listen();
  return { server, base };
}

async function getJson(base: string, pathname: string): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${base}${pathname}`);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

describe('Mission Control server', () => {
  // -------------------------------------------------------------------- SSE

  it('C10 Last-Event-ID resume: the first event id is greater than the cursor', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
      streamIntervalMs: 50,
      port: 0,
    });

    const controller = new AbortController();
    const response = await fetch(`${base}/api/stream`, {
      headers: { 'Last-Event-ID': '1' },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!/(^|\n)id: \d+/.test(buffer)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();

    const match = buffer.match(/id: (\d+)/);
    assert.ok(match, `no SSE id in ${buffer.slice(0, 120)}`);
    assert.ok(Number(match[1]) > 1);
  });

  // --------------------------------------------------------------- actions

  it('C15 actions default limit: 50 items', async () => {
    const { dir, dbPath } = createDb((db) => recordMany(db, 60));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/actions');
    assert.equal(status, 200);
    assert.equal(body.items.length, 50);
    assert.equal(body.nextBefore, body.items[49].id);
  });

  it('C16 actions limit 500: 500 items', async () => {
    const { dir, dbPath } = createDb((db) => recordMany(db, 520));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/actions?limit=500');
    assert.equal(status, 200);
    assert.equal(body.items.length, 500);
  });

  it('C17 actions limit 501: 400 InvalidParameter limit', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/actions?limit=501');
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'limit' });
  });

  it('C18 actions component filter: only that component', async () => {
    const { dir, dbPath } = createDb((db) => {
      recordMany(db, 10, 'heartbeat');
      recordMany(db, 10, 'death');
    });
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/actions?component=heartbeat&limit=50');
    assert.equal(status, 200);
    assert.equal(body.items.length, 10);
    assert.ok(body.items.every((item: any) => item.component === 'heartbeat'));
  });

  it('C19 actions before cursor: strictly lower ids in descending order', async () => {
    const { dir, dbPath } = createDb((db) => recordMany(db, 10));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/actions?before=6&limit=50');
    assert.equal(status, 200);
    assert.deepEqual(
      body.items.map((item: any) => item.id),
      [5, 4, 3, 2, 1]
    );
  });

  // ---------------------------------------------------------------- config

  it('C29 config endpoint: live thresholds, intervals, Kelly, x402 and mitosis', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/config');

    assert.equal(status, 200);
    assert.equal(body.networkMode, 'mock');
    assert.equal(body.tierThresholds.green, 50);
    assert.equal(body.tierThresholds.yellow, 10);
    assert.equal(body.tierThresholds.orange, 2);
    assert.equal(body.tierThresholds.red, 0);
    assert.equal(body.heartbeatIntervals.greenMs, 60000);
    assert.equal(body.heartbeatIntervals.yellowMs, 300000);
    assert.equal(body.heartbeatIntervals.orangeMs, 60000);
    assert.equal(body.kelly.fraction, 0.25);
    assert.equal(body.kelly.maxBankrollCap, 0.05);
    assert.equal(body.x402.port, 4020);
    assert.equal(body.x402.priceUsdc, 0.01);
    assert.equal(body.x402.settlementChain, 'base');
    assert.equal(body.evolution.mitosisMultiplier, 3);
  });

  it('C31 no secret leak: config, snapshot and health carry no secret value', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });

    const secrets = [
      '0xSUPERSECRETPRIVATEKEY',
      'APISECRET-SECRET-VALUE',
      'PASSPHRASE-SECRET-VALUE',
      'GITHUB-TOKEN-SECRET-VALUE',
      'APIKEY-SECRET-VALUE',
    ];
    const bodies = await Promise.all([
      fetch(`${base}/api/config`).then((response) => response.text()),
      fetch(`${base}/api/snapshot`).then((response) => response.text()),
      fetch(`${base}/api/health`).then((response) => response.text()),
    ]);

    for (const secret of secrets) {
      for (const body of bodies) {
        assert.equal(body.includes(secret), false, `secret leaked: ${secret}`);
      }
    }
  });

  // --------------------------------------------------------------- lineage

  it('C35 lineage endpoint: generation, child address, status and royalties', async () => {
    const { dir, dbPath } = createDb((db) => {
      recordTick(db);
      db.recordLineage({
        childAddress: '0x2222222222222222222222222222222222222222',
        parentAddress: '0x1111111111111111111111111111111111111111',
        generation: 2,
        birthTimestamp: NOW - 5000,
        seedCapitalUsd: 10,
        totalRoyaltiesPaidUsd: 1.5,
        status: 'ACTIVE',
      });
    });
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/lineage');

    assert.equal(status, 200);
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0].generation, 2);
    assert.equal(body.children[0].childAddress, '0x2222222222222222222222222222222222222222');
    assert.equal(body.children[0].status, 'ACTIVE');
    assert.equal(body.children[0].totalRoyaltiesPaidUsd, 1.5);
    assert.equal(body.royaltiesPaidUsd, 1.5);
  });

  // ------------------------------------------------------- trust boundary

  it('C39 read-only boundary: CREATE TABLE fails and the db hash never changes', async () => {
    const { dir, dbPath } = createDb((db) => {
      recordMany(db, 12);
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5,
        entryType: 'INCOME_X402',
        timestamp: NOW - 500,
      });
    });
    const hash = () =>
      crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    const before = hash();

    const probe = openReadOnly(dbPath);
    assert.throws(() => probe.exec('CREATE TABLE should_not_exist (id INTEGER);'));
    probe.close();

    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });

    for (const pathname of [
      '/',
      '/assets/app.js',
      '/assets/ui_core.js',
      '/assets/styles.css',
      '/api/snapshot',
      '/api/actions',
      '/api/ledger',
      '/api/positions',
      '/api/lineage',
      '/api/config',
      '/api/export?table=actions&format=csv',
      '/api/health',
    ]) {
      const response = await fetch(`${base}${pathname}`);
      assert.ok(response.status < 500, `${pathname} -> ${response.status}`);
      await response.arrayBuffer();
    }

    assert.equal(hash(), before);
  });

  it('C40 method not allowed: POST /api/snapshot is 405', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const response = await fetch(`${base}/api/snapshot`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: 'MethodNotAllowed' });
  });

  it('C41 host guard: non-local host without token exits 1 with the required message', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings=ExperimentalWarning',
        'src/modules/dashboard/main.ts',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DASHBOARD_HOST: '0.0.0.0',
          DASHBOARD_TOKEN: '',
          DASHBOARD_PORT: '0',
        },
        encoding: 'utf8',
        timeout: 20000,
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /DASHBOARD_TOKEN obrigatório fora de localhost/);
  });

  it('C42 token auth: 401 without credentials and 200 with a bearer token', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
      token: 'tok-123',
    });

    const unauthorized = await fetch(`${base}/api/snapshot`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: 'Unauthorized' });

    const authorized = await fetch(`${base}/api/snapshot`, {
      headers: { Authorization: 'Bearer tok-123' },
    });
    assert.equal(authorized.status, 200);
    await authorized.arrayBuffer();

    const query = await fetch(`${base}/api/snapshot?token=tok-123`);
    assert.equal(query.status, 200);
    await query.arrayBuffer();
  });

  it('C43 x402 probe timeout: degraded.x402 timeout and reachable false', async () => {
    const hang = http.createServer(() => {
      // never answers
    });
    extraServers.push(hang);
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', () => resolve()));
    const address = hang.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: `http://127.0.0.1:${port}/health`,
      probeTimeoutMs: 150,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/snapshot');

    assert.equal(status, 200);
    assert.equal(body.x402.reachable, false);
    assert.equal(body.degraded.x402, 'timeout');
  });

  it('C44 database unavailable: a non-SQLite file answers 503', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dashboard-bad-'));
    temporaryDirs.push(dir);
    const dbPath = path.join(dir, 'agent.db');
    fs.writeFileSync(dbPath, 'not a sqlite database', 'utf8');

    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/snapshot');

    assert.equal(status, 503);
    assert.deepEqual(body, { error: 'DatabaseUnavailable' });
  });

  it('C45 database absent: 200 with liveness UNKNOWN and zeroed aggregates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dashboard-empty-'));
    temporaryDirs.push(dir);

    const { base } = await startServer({
      dbPath: path.join(dir, 'absent.db'),
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/snapshot');

    assert.equal(status, 200);
    assert.equal(body.liveness.state, 'UNKNOWN');
    assert.equal(body.kpi.cycles, 0);
    assert.equal(body.kpi.actions, 0);
    assert.equal(body.revenue.netUsd, 0);
  });

  // ---------------------------------------------------------------- export

  it('C46 csv export: text/csv with BOM, header and CRLF rows', async () => {
    const { dir, dbPath } = createDb((db) => recordMany(db, 3));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const response = await fetch(`${base}/api/export?table=actions&format=csv`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = text.split('\r\n');
    assert.match(lines[0], /id,component,action_type,details,tier,balance_usd,timestamp/);
    assert.ok(lines.length >= 4);
  });

  it('C47 export table whitelist: unknown table is 400 InvalidParameter table', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/export?table=users');
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'table' });
  });

  // ----------------------------------------------------------------- assets

  it('C48 index csp: self-only CSP, pt-BR lang, aria-live and no external refs', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const response = await fetch(`${base}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-security-policy'),
      "default-src 'self'"
    );
    assert.match(html, /lang="pt-BR"/);
    assert.match(html, /aria-live="polite"/);
    assert.equal(/(?:src|href)\s*=\s*["']https?:\/\//i.test(html), false);
  });

  it('C49 asset 404: a missing asset answers 404', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const response = await fetch(`${base}/assets/inexistente.js`);
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  });

  // ------------------------------------------------------- parameter errors

  it('C50 ledger entryType validation: unknown entry type is 400 InvalidParameter entryType', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/ledger?entryType=BOGUS');
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'InvalidParameter', parameter: 'entryType' });
  });

  it('C51 dashboard health: 200 with database ok and integer uptimeMs', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });
    const { status, body } = await getJson(base, '/api/health');
    assert.equal(status, 200);
    assert.equal(body.database, 'ok');
    assert.equal(Number.isInteger(body.uptimeMs), true);
  });

  it('C52 concurrent writer: an insert from another connection appears in the next snapshot', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db));
    const { base } = await startServer({
      dbPath,
      tombstonePath: path.join(dir, 'none.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    });

    const first = await getJson(base, '/api/snapshot');
    assert.equal(first.status, 200);

    const writer = new DatabaseSync(dbPath);
    writer
      .prepare(
        'INSERT INTO actions (component, action_type, details, tier, balance_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?);'
      )
      .run('writer', 'CONCURRENT_WRITER', '{"ok":true}', 'VERDE', 101, NOW);
    writer.close();

    const second = await getJson(base, '/api/snapshot');
    assert.equal(second.status, 200);
    assert.equal(second.body.activity.recentActions[0].actionType, 'CONCURRENT_WRITER');
  });
});

describe('Mission Control server — agent start contract', () => {
  function stubControl(result: { state: string; pid: number | null; error?: string }) {
    const calls: unknown[] = [];
    const control = {
      calls,
      snapshot: () => ({ state: 'stopped', pid: null }),
      start: async (options: unknown) => { calls.push(options); return result; },
      stop: async () => ({ state: 'stopped', pid: null }),
    };
    return control;
  }

  async function postStart(base: string, body: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/api/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it('POST /api/agent/start forwards an explicit inference mode to the control', async () => {
    const { dir, dbPath } = createDb();
    const control = stubControl({ state: 'running', pid: 4321 });
    const { base } = await startServer({
      dbPath, tombstonePath: path.join(dir, 'none.json'), x402HealthUrl: null, agentControl: control as never,
    });

    const response = await postStart(base, { mode: 'paid' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { state: 'running' });
    assert.deepEqual(control.calls, [{ mode: 'paid' }]);

    assert.equal((await postStart(base, {})).status, 200);
    assert.deepEqual(control.calls[1], {});
  });

  it('POST /api/agent/start rejects an unknown mode or extra keys with 400 without starting', async () => {
    const { dir, dbPath } = createDb();
    const control = stubControl({ state: 'running', pid: 4321 });
    const { base } = await startServer({
      dbPath, tombstonePath: path.join(dir, 'none.json'), x402HealthUrl: null, agentControl: control as never,
    });

    assert.deepEqual(await postStart(base, { mode: 'turbo' }), { status: 400, body: { error: 'InvalidRequest' } });
    assert.deepEqual(await postStart(base, { mode: 'free', extra: 1 }), { status: 400, body: { error: 'InvalidRequest' } });
    assert.equal(control.calls.length, 0);
  });

  it('POST /api/agent/start answers 500 AgentStartFailed with the refusal reason', async () => {
    const { dir, dbPath } = createDb();
    const reason = 'NoLLMAvailable: free — no free provider configured';
    const control = stubControl({ state: 'stopped', pid: null, error: reason });
    const { base } = await startServer({
      dbPath, tombstonePath: path.join(dir, 'none.json'), x402HealthUrl: null, agentControl: control as never,
    });

    assert.deepEqual(await postStart(base, {}), { status: 500, body: { error: 'AgentStartFailed', reason } });
  });
});
