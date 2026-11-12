/**
 * AD-003: the configured inference mode is a ceiling and the metabolic tier
 * can only step it down. A paid ceiling stays paid in VERDE and walks the free
 * queue in every other tier; a free ceiling is never raised.
 * Hermetic per TEST_INFRA.md §1.2: in-memory database, stub providers, mock wallet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InferenceEngine, modeForTier } from '../../src/modules/inference/engine.ts';
import type { InferenceProvider, InferenceStatusEvent } from '../../src/modules/inference/types.ts';
import { loadConfig } from '../../src/config.ts';
import { bootstrapAgent, HeartbeatDaemon, type HeartbeatDaemonOptions } from '../../src/index.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet } from '../../src/core/wallet.ts';
import { alertSeverity } from '../../src/modules/dashboard/snapshot.ts';
import { getStandardMockMarkets } from '../../src/modules/polymarket/scanner.ts';

const market = getStandardMockMarkets()[0];

function stubProvider(overrides: Partial<InferenceProvider> & { id: string; free: boolean }): InferenceProvider {
  return {
    type: 'openai',
    model: `${overrides.id}-model`,
    baseUrl: 'http://localhost',
    ...(overrides.free ? {} : { apiKey: 'sk-real-key' }),
    ping: async () => {},
    estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider', costUsd: overrides.free ? undefined : 0.002 }),
    ...overrides,
  };
}

function paidCeilingEngine(statuses: InferenceStatusEvent[] = [], expenses: string[] = []): InferenceEngine {
  return new InferenceEngine({
    mode: 'paid',
    capPerTick: 5,
    providers: [stubProvider({ id: 'anthropic', free: false }), stubProvider({ id: 'groq', free: true })],
    fallback: () => ({ pYes: 0.5, pNo: 0.5 }),
    onStatus: (event) => statuses.push(event),
    onExpense: (event) => expenses.push(event.providerId),
  });
}

describe('AD-003 — inference mode ceiling by tier', () => {
  it('C58 modeForTier: a paid ceiling is paid only in VERDE; a free ceiling is never raised', () => {
    assert.equal(modeForTier('paid', 'VERDE'), 'paid');
    assert.equal(modeForTier('paid', 'AMARELO'), 'free');
    assert.equal(modeForTier('paid', 'LARANJA'), 'free');
    assert.equal(modeForTier('paid', 'VERMELHO'), 'free');
    for (const tier of ['VERDE', 'AMARELO', 'LARANJA', 'VERMELHO'] as const) {
      assert.equal(modeForTier('free', tier), 'free');
    }
  });

  it('C58 paid ceiling in AMARELO walks the free queue and records no expense', async () => {
    const statuses: InferenceStatusEvent[] = [];
    const expenses: string[] = [];
    const engine = paidCeilingEngine(statuses, expenses);

    assert.deepEqual(engine.applyTier('AMARELO'), { from: 'paid', to: 'free' });
    const outcome = await engine.estimate(market);

    assert.equal(outcome.providerId, 'groq');
    assert.deepEqual(expenses, []);
    assert.equal(engine.status.mode, 'free');
    assert.equal(engine.status.ceilingMode, 'paid');
    assert.equal(statuses.at(-1)?.ceilingMode, 'paid');
  });

  it('C58 back in VERDE the paid ceiling is restored and the expense is recorded', async () => {
    const expenses: string[] = [];
    const engine = paidCeilingEngine([], expenses);
    engine.applyTier('AMARELO');

    assert.deepEqual(engine.applyTier('VERDE'), { from: 'free', to: 'paid' });
    assert.equal(engine.applyTier('VERDE'), null);
    const outcome = await engine.estimate(market);

    assert.equal(outcome.providerId, 'anthropic');
    assert.deepEqual(expenses, ['anthropic']);
  });

  it('C58 a free ceiling never calls a paid provider in VERDE', async () => {
    let paidCalls = 0;
    const engine = new InferenceEngine({
      mode: 'free',
      capPerTick: 5,
      providers: [
        stubProvider({ id: 'anthropic', free: false, estimate: async () => { paidCalls += 1; return { pYes: 0.6, pNo: 0.4, origin: 'provider' }; } }),
        stubProvider({ id: 'groq', free: true }),
      ],
      fallback: () => ({ pYes: 0.5, pNo: 0.5 }),
    });

    assert.equal(engine.applyTier('VERDE'), null);
    const outcome = await engine.estimate(market);
    assert.equal(outcome.providerId, 'groq');
    assert.equal(paidCalls, 0);
  });

  it('C59 a paid ceiling config carries the free preset queue after the paid one', () => {
    const config = loadConfig({
      INFERENCE_MODE: 'paid',
      ANTHROPIC_API_KEY: 'sk-ant-real-key',
      GROQ_API_KEY: 'gsk_real_key',
    });
    assert.deepEqual(config.inference.providers.map((p) => [p.id, p.free]), [['anthropic', false], ['groq', true]]);

    const freeOnly = loadConfig({ INFERENCE_MODE: 'free', ANTHROPIC_API_KEY: 'sk-ant-real-key', GROQ_API_KEY: 'gsk_real_key' });
    assert.deepEqual(freeOnly.inference.providers.map((p) => p.id), ['groq']);
  });

  it('C60 the daemon records INFERENCE_MODE_DOWNGRADED when a paid ceiling ticks in AMARELO', async () => {
    const config = loadConfig({ NETWORK_MODE: 'mock', INFERENCE_MODE: 'paid', INFERENCE_PROVIDERS: '[]' });
    const database = new DatabaseService(':memory:');
    database.initialize();
    try {
      const wallet = new ApexWallet(config);
      wallet.setMockBalances({ base: 10.0, polygon: 10.0 }); // $20.00 -> AMARELO
      const daemon = new HeartbeatDaemon({ config, database, wallet, inference: paidCeilingEngine() });

      const result = await daemon.tick();
      assert.equal(result.tier, 'AMARELO');

      const downgrade = database.getActions(50, 'inference').find((a) => a.actionType === 'INFERENCE_MODE_DOWNGRADED');
      assert.ok(downgrade, 'INFERENCE_MODE_DOWNGRADED must be recorded');
      assert.deepEqual(JSON.parse(downgrade.details), { from: 'paid', to: 'free', ceilingMode: 'paid', tier: 'AMARELO' });
      assert.equal(alertSeverity('INFERENCE_MODE_DOWNGRADED'), 'warning');
    } finally {
      database.close();
    }
  });

  it('C61 a paid start whose free queue fails still starts and records INFERENCE_FREE_PREFLIGHT_FAILED', async () => {
    const database = new DatabaseService(':memory:');
    database.initialize();
    let exitCode: number | null = null;
    let captured: HeartbeatDaemonOptions | undefined;
    try {
      const daemon = await bootstrapAgent({
        config: loadConfig({ INFERENCE_MODE: 'paid', INFERENCE_PROVIDERS: '[]' }),
        database,
        providers: [
          stubProvider({ id: 'anthropic', free: false }),
          stubProvider({ id: 'groq', free: true, ping: async () => { throw new Error('429 Too Many Requests'); } }),
        ],
        exit: (code) => { exitCode = code; },
        log: () => {},
        createDaemon: (options) => {
          captured = options;
          return {} as HeartbeatDaemon;
        },
      });

      assert.notEqual(daemon, null);
      assert.equal(exitCode, null);
      assert.deepEqual(captured?.inferenceProviders?.map((p) => p.id), ['anthropic']);
      const recorded = database.getActions(10, 'inference').map((a) => a.actionType);
      assert.ok(recorded.includes('INFERENCE_PREFLIGHT_OK'));
      assert.ok(recorded.includes('INFERENCE_FREE_PREFLIGHT_FAILED'));
      assert.equal(alertSeverity('INFERENCE_FREE_PREFLIGHT_FAILED'), 'warning');
    } finally {
      database.close();
    }
  });

  it('C61 a paid start with a healthy free queue hands both queues to the daemon', async () => {
    const database = new DatabaseService(':memory:');
    database.initialize();
    let captured: HeartbeatDaemonOptions | undefined;
    try {
      await bootstrapAgent({
        config: loadConfig({ INFERENCE_MODE: 'paid', INFERENCE_PROVIDERS: '[]' }),
        database,
        providers: [stubProvider({ id: 'anthropic', free: false }), stubProvider({ id: 'groq', free: true })],
        exit: () => { throw new Error('must not exit'); },
        log: () => {},
        createDaemon: (options) => {
          captured = options;
          return {} as HeartbeatDaemon;
        },
      });
      assert.deepEqual(captured?.inferenceProviders?.map((p) => p.id), ['anthropic', 'groq']);
      const recorded = database.getActions(10, 'inference').map((a) => a.actionType);
      assert.ok(recorded.includes('INFERENCE_FREE_PREFLIGHT_OK'));
    } finally {
      database.close();
    }
  });
});
