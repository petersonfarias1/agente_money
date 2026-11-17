/**
 * ==============================================================================
 * Unit Test Suite: Mission Control — snapshot builder
 * ==============================================================================
 * Proofs for C3-C8, C11-C13, C22-C23, C25-C28, C30, C32, C34 and C36-C38.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../src/types.ts';
import { DatabaseService } from '../../src/core/database.ts';
import {
  alertSeverity,
  allowedOperations,
  buildAlerts,
  buildSnapshot,
  deriveLiveness,
  positionsSummary,
  readTombstone,
  revenueByType,
  sanitizeConfig,
  tierTransitions,
  winRate,
} from '../../src/modules/dashboard/snapshot.ts';
import type { MissionControlInferenceView } from '../../src/modules/dashboard/snapshot.ts';

const NOW = 1_800_000_000_000;
const temporaryDirs: string[] = [];

afterEach(() => {
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
    privateKey: '0xdeadbeef',
    motherWalletAddress: '0x1111111111111111111111111111111111111111',
    initialCapitalUsd: 75,
    tierThresholds: { green: 50, yellow: 10, orange: 2, red: 0 },
    heartbeatIntervals: { greenMs: 60000, yellowMs: 300000, orangeMs: 60000 },
    kelly: { fraction: 0.25, maxBankrollCap: 0.05 },
    polymarket: {
      clobApiUrl: '',
      apiKey: 'poly-key',
      apiSecret: 'poly-secret',
      apiPassphrase: 'poly-passphrase',
    },
    x402: { port: 4020, priceUsdc: 0.01, settlementChain: 'base' },
    bounties: { githubToken: 'ghp-secret', minRewardUsd: 10 },
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
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp_dashboard_snap_'));
  temporaryDirs.push(dir);
  const dbPath = path.join(dir, 'agent.db');
  const db = new DatabaseService(dbPath);
  seed?.(db);
  db.close();
  return { dir, dbPath };
}

function recordTick(db: DatabaseService, balanceUsd: number, timestamp = NOW - 1000): void {
  db.recordAction({
    component: 'heartbeat',
    actionType: 'TICK_EVALUATED',
    details: '{}',
    tier: balanceUsd > 50 ? 'VERDE' : balanceUsd >= 10 ? 'AMARELO' : balanceUsd > 0 ? 'LARANJA' : 'VERMELHO',
    balanceUsd,
    timestamp,
  });
}

function inferenceView(snapshot: Record<string, unknown>): MissionControlInferenceView {
  return snapshot.inference as MissionControlInferenceView;
}

describe('Mission Control snapshot', () => {
  // ------------------------------------------------------------------ liveness

  it('C3 liveness ALIVE boundary: age equals twice the tier interval', () => {
    const liveness = deriveLiveness({
      now: NOW,
      lastTickAt: NOW - 2 * 60000,
      tierIntervalMs: 60000,
      lastActionType: 'TICK_EVALUATED',
    });
    assert.equal(liveness.state, 'ALIVE');
  });

  it('C4 liveness STALE boundary: one millisecond past twice the interval', () => {
    const liveness = deriveLiveness({
      now: NOW,
      lastTickAt: NOW - (2 * 60000 + 1),
      tierIntervalMs: 60000,
      lastActionType: 'TICK_EVALUATED',
    });
    assert.equal(liveness.state, 'STALE');
    assert.match(liveness.detail, /sem tick há 2 min/);
  });

  it('C5 liveness DEAD age: one millisecond past fifteen minutes', () => {
    const liveness = deriveLiveness({
      now: NOW,
      lastTickAt: NOW - (15 * 60 * 1000 + 1),
      tierIntervalMs: 60000,
      lastActionType: 'TICK_EVALUATED',
    });
    assert.equal(liveness.state, 'DEAD');
  });

  it('C6 liveness DEAD permadeath: last action is PERMADEATH_EXECUTED', () => {
    const liveness = deriveLiveness({
      now: NOW,
      lastTickAt: NOW - 1000,
      tierIntervalMs: 60000,
      lastActionType: 'PERMADEATH_EXECUTED',
    });
    assert.equal(liveness.state, 'DEAD');
    assert.equal(liveness.detail, 'permadeath executado');
  });

  it('C7 liveness UNKNOWN: no actions at all', () => {
    const liveness = deriveLiveness({
      now: NOW,
      lastTickAt: null,
      tierIntervalMs: 60000,
      lastActionType: null,
    });
    assert.equal(liveness.state, 'UNKNOWN');
  });

  // ----------------------------------------------------------------------- seq

  it('C8 seq monotonic: two builds return 1 then 2', async () => {
    const { dir } = createDb();
    const state = { seq: 0 };
    const options = {
      dbPath: path.join(dir, 'missing.db'),
      tombstonePath: path.join(dir, 'missing-tombstone.json'),
      x402HealthUrl: null,
      config: makeConfig(),
      now: () => NOW,
    };
    const first = await buildSnapshot(state, options);
    const second = await buildSnapshot(state, options);
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
  });

  // ------------------------------------------------------------------ alerts

  it('C11 alertSeverity: critical, warning and info mapping', () => {
    assert.equal(alertSeverity('PERMADEATH_EXECUTED'), 'critical');
    assert.equal(alertSeverity('IMMUNE_SYSTEM_ROLLBACK'), 'critical');
    assert.equal(alertSeverity('TICK_FAILED'), 'critical');
    assert.equal(alertSeverity('REPLAY_ATTACK_PREVENTED'), 'warning');
    assert.equal(alertSeverity('DAEMON_STOPPED'), 'warning');
    assert.equal(alertSeverity('TICK_EVALUATED'), 'info');
  });

  it('C12 tierTransitions: a downgrade is warning, an upgrade is info', () => {
    const transitions = tierTransitions([
      { id: 1, tier: 'VERDE', timestamp: NOW - 3000 },
      { id: 2, tier: 'AMARELO', timestamp: NOW - 2000 },
      { id: 3, tier: 'VERDE', timestamp: NOW - 1000 },
    ]);

    assert.equal(transitions.length, 2);
    assert.equal(transitions[0].from, 'VERDE');
    assert.equal(transitions[0].to, 'AMARELO');
    assert.equal(transitions[0].direction, 'down');
    assert.equal(transitions[0].severity, 'warning');
    assert.equal(transitions[1].direction, 'up');
    assert.equal(transitions[1].severity, 'info');
  });

  it('C13 buildAlerts cap: at most 20 alerts, newest first', () => {
    const actions = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      component: 'heartbeat',
      actionType: 'TICK_EVALUATED',
      timestamp: NOW - index * 1000,
    }));

    const alerts = buildAlerts(actions);

    assert.equal(alerts.length, 20);
    assert.equal(alerts[0].id, 1);
    for (let i = 1; i < alerts.length; i++) {
      assert.ok(alerts[i - 1].timestamp >= alerts[i].timestamp);
    }
  });

  // --------------------------------------------------------------- financial

  it('C22 ledger totals: revenue, expense and net from ledger rows', async () => {
    const { dir, dbPath } = createDb((db) => {
      recordTick(db, 25);
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 10,
        entryType: 'INCOME_X402',
        timestamp: NOW - 3000,
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5,
        entryType: 'INCOME_BOUNTY',
        timestamp: NOW - 2000,
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 3,
        entryType: 'EXPENSE_GAS',
        timestamp: NOW - 1000,
      });
    });

    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: makeConfig(),
        now: () => NOW,
      }
    );

    const revenue = snapshot.revenue as Record<string, number>;
    assert.equal(revenue.totalUsd, 15);
    assert.equal(revenue.expenseUsd, 3);
    assert.equal(revenue.netUsd, 12);
    assert.equal((snapshot.balance as Record<string, number>).totalUsd, 25);
  });

  it('C23 revenueByType: groups by entry type with value and count', () => {
    const groups = revenueByType([
      { entryType: 'INCOME_X402', amount: 2 },
      { entryType: 'INCOME_X402', amount: 3 },
      { entryType: 'INCOME_BOUNTY', amount: 7 },
    ]);

    const x402 = groups.find((group) => group.entryType === 'INCOME_X402');
    const bounty = groups.find((group) => group.entryType === 'INCOME_BOUNTY');
    assert.equal(x402?.amountUsd, 5);
    assert.equal(x402?.count, 2);
    assert.equal(bounty?.amountUsd, 7);
    assert.equal(bounty?.count, 1);
  });

  it('C25 empty ledger: netUsd 0 and runwayDays null', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db, 25));
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: makeConfig(),
        now: () => NOW,
      }
    );
    const revenue = snapshot.revenue as Record<string, number | null>;
    assert.equal(revenue.netUsd, 0);
    assert.equal(revenue.runwayDays, null);
  });

  it('C26 zero burn: no expenses in the last 7 days means runwayDays null', async () => {
    const { dir, dbPath } = createDb((db) => {
      recordTick(db, 25);
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 4,
        entryType: 'INCOME_X402',
        timestamp: NOW - 1000,
      });
    });
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: makeConfig(),
        now: () => NOW,
      }
    );
    const revenue = snapshot.revenue as Record<string, number | null>;
    assert.equal(revenue.burn7dUsd, 0);
    assert.equal(revenue.runwayDays, null);
  });

  it('C27 positionsSummary: open exposure and counts per status', () => {
    const summary = positionsSummary([
      { status: 'OPEN', stakeUsd: 10 },
      { status: 'OPEN', stakeUsd: 5 },
      { status: 'WON', stakeUsd: 3 },
      { status: 'LOST', stakeUsd: 2 },
      { status: 'CANCELLED', stakeUsd: 1 },
    ]);

    assert.equal(summary.openExposureUsd, 15);
    assert.deepEqual(summary.counts, { OPEN: 2, WON: 1, LOST: 1, CANCELLED: 1 });
    assert.equal(summary.winRate, 0.5);
  });

  it('C28 winRate null: zero wins and zero losses', () => {
    assert.equal(winRate(0, 0), null);
    assert.equal(winRate(3, 1), 0.75);
  });

  // ------------------------------------------------------------------ config

  it('C30 sanitizeConfig: sensitive fields become *** and privateKey is omitted', () => {
    const sanitized = sanitizeConfig(makeConfig()) as Record<string, unknown>;

    assert.equal('privateKey' in sanitized, false);
    assert.equal((sanitized.polymarket as Record<string, unknown>).apiSecret, '***');
    assert.equal((sanitized.polymarket as Record<string, unknown>).apiPassphrase, '***');
    assert.equal((sanitized.polymarket as Record<string, unknown>).apiKey, '***');
    assert.equal((sanitized.bounties as Record<string, unknown>).githubToken, '***');
    assert.equal(sanitized.networkMode, 'mock');
    assert.equal((sanitized.kelly as Record<string, unknown>).fraction, 0.25);
  });

  it('C32 modelClass by tier: VERDE advanced, AMARELO economic, LARANJA and VERMELHO survival', async () => {
    const cases = [
      { balance: 100, tier: 'VERDE', modelClass: 'advanced' },
      { balance: 20, tier: 'AMARELO', modelClass: 'economic' },
      { balance: 5, tier: 'LARANJA', modelClass: 'survival' },
      { balance: 0, tier: 'VERMELHO', modelClass: 'survival' },
    ];

    for (const expected of cases) {
      const { dir, dbPath } = createDb((db) => recordTick(db, expected.balance));
      const snapshot = await buildSnapshot(
        { seq: 0 },
        {
          dbPath,
          tombstonePath: path.join(dir, 'none.json'),
          x402HealthUrl: null,
          config: makeConfig(),
          now: () => NOW,
        }
      );
      const tier = snapshot.tier as Record<string, unknown>;
      assert.equal(tier.tier, expected.tier);
      assert.equal(tier.modelClass, expected.modelClass);
    }
  });

  it('C27 snapshot shows inference mode free with provider', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db, 100));
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: makeConfig(),
        now: () => NOW,
      }
    );

    assert.equal(inferenceView(snapshot).mode, 'free');
    assert.equal(inferenceView(snapshot).providerId, 'ollama');
    assert.equal(inferenceView(snapshot).providerModel, 'llama3');
    assert.equal(inferenceView(snapshot).source, 'provider');
  });

  it('C30 snapshot shows inference call counter', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db, 100));
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: makeConfig(),
        now: () => NOW,
        inference: { callsUsed: 2, capPerTick: 5 },
      }
    );

    assert.equal(inferenceView(snapshot).callsUsed, 2);
    assert.equal(inferenceView(snapshot).capPerTick, 5);
  });

  it('C31 snapshot shows inference mode paid', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db, 100));
    const paidConfig: AppConfig = {
      ...makeConfig(),
      inference: { mode: 'paid', capPerTick: 5, providers: [] },
    };
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: paidConfig,
        now: () => NOW,
      }
    );

    assert.equal(inferenceView(snapshot).mode, 'paid');
    assert.equal(inferenceView(snapshot).source, 'deterministic');
  });

  it('C33 snapshot shows effective mode not intended', async () => {
    const { dir, dbPath } = createDb((db) => recordTick(db, 100));
    const paidConfig: AppConfig = {
      ...makeConfig(),
      inference: { mode: 'paid', capPerTick: 5, providers: [] },
    };
    const snapshot = await buildSnapshot(
      { seq: 0 },
      {
        dbPath,
        tombstonePath: path.join(dir, 'none.json'),
        x402HealthUrl: null,
        config: paidConfig,
        now: () => NOW,
      }
    );

    // The effective mode stays `paid` even when the queue holds no usable provider;
    // the degradation to deterministic is carried by `source` and `fallbackReason`.
    const inference = inferenceView(snapshot);
    assert.equal(inference.mode, 'paid');
    assert.equal(inference.providerId, null);
    assert.equal(inference.source, 'deterministic');
  });

  it('C34 allowedOperations: derived from research and self-modification flags', () => {
    const full = allowedOperations({
      allowSpeculativeResearch: true,
      allowSelfModification: true,
    });
    const survival = allowedOperations({
      allowSpeculativeResearch: false,
      allowSelfModification: false,
    });

    assert.ok(full.includes('pesquisa especulativa'));
    assert.ok(full.includes('automodificação'));
    assert.ok(!survival.includes('pesquisa especulativa'));
    assert.ok(!survival.includes('automodificação'));
    assert.ok(survival.includes('operações de sobrevivência'));
  });

  // --------------------------------------------------------------- tombstone

  it('C36 readTombstone present: cause, death, cycles, revenue and expenses', () => {
    const tombstone = readTombstone('tombstone.json');

    assert.equal(tombstone.present, true);
    assert.equal(tombstone.invalid, undefined);
    assert.equal(typeof tombstone.reason, 'string');
    assert.equal(typeof tombstone.deathTimestamp, 'string');
    assert.equal(typeof tombstone.totalCyclesExecuted, 'number');
    assert.equal(typeof tombstone.totalRevenueGenerated, 'number');
    assert.equal(typeof tombstone.totalExpensesIncurred, 'number');
  });

  it('C37 readTombstone absent: {present:false}', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp_tombstone_absent_'));
    temporaryDirs.push(dir);
    assert.deepEqual(readTombstone(path.join(dir, 'nope.json')), { present: false });
  });

  it('C38 readTombstone invalid: {present:true, invalid:true, path}', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp_tombstone_invalid_'));
    temporaryDirs.push(dir);
    const filePath = path.join(dir, 'tombstone.json');
    fs.writeFileSync(filePath, '{ this is not json', 'utf8');

    assert.deepEqual(readTombstone(filePath), {
      present: true,
      invalid: true,
      path: filePath,
    });
  });
});
