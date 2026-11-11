/**
 * ==============================================================================
 * Unit Test Suite: Inference Mode — LLM providers (free/local via Ollama) & policy
 * ==============================================================================
 * Proofs for C27-C35 of `.checks/dashboard-control-and-free-mode.md` (S4).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigValidationError } from '../../src/config.ts';
import { InferenceEngine } from '../../src/modules/inference/engine.ts';
import { OllamaProvider, createInferenceProvider, type InferenceProvider } from '../../src/modules/inference/provider.ts';
import type { InferenceEngineOptions, InferenceOutcome } from '../../src/modules/inference/types.ts';
import type { InferenceProviderConfig } from '../../src/types.ts';
import { getStandardMockMarkets } from '../../src/modules/polymarket/scanner.ts';

const NOW = 1_800_000_000_000;
const market = getStandardMockMarkets()[0];

const ollamaProviderConfig: InferenceProviderConfig = {
  id: 'ollama',
  type: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
  free: true,
};

function chatFetch(content: string, tokensUsed = 12, ok = true): typeof fetch {
  const fn = (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'Internal Server Error',
      json: async () =>
        ok
          ? { choices: [{ message: { content } }], usage: { total_tokens: tokensUsed } }
          : {},
    })) as unknown as typeof fetch;
  return fn;
}

function makeEngine(overrides: Partial<InferenceEngineOptions> = {}): {
  engine: InferenceEngine;
  fallbackEvents: Array<{ reason: string; providerId?: string; marketId?: string }>;
  invalidEvents: Array<{ value: { pYes?: number; pNo?: number }; providerId?: string; marketId?: string }>;
  expenseEvents: Array<{ costUsd: number; providerId: string }>;
  options: InferenceEngineOptions;
} {
  const fallbackEvents: Array<{ reason: string; providerId?: string; marketId?: string }> = [];
  const invalidEvents: Array<{ value: { pYes?: number; pNo?: number }; providerId?: string; marketId?: string }> = [];
  const expenseEvents: Array<{ costUsd: number; providerId: string }> = [];
  const options: InferenceEngineOptions = {
    mode: 'free',
    capPerTick: 5,
    providers: [],
    fallback: async () => ({ pYes: 0.65, pNo: 0.35 }),
    onFallback: (event) => fallbackEvents.push(event),
    onInvalidProbability: (event) => invalidEvents.push(event),
    onExpense: (event) => expenseEvents.push(event),
    ...overrides,
  };
  const engine = new InferenceEngine(options);
  return { engine, options, fallbackEvents, invalidEvents, expenseEvents };
}

describe('Inference mode (S4 — free/local LLM via Ollama)', () => {
  // ==========================================================================
  // C35 — configuration validation
  // ==========================================================================

  it('C35 invalid INFERENCE_MODE or cap fails startup with Invalid message', () => {
    assert.throws(
      () => loadConfig({ NETWORK_MODE: 'mock', INFERENCE_MODE: 'sometimes' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.message.includes("Invalid INFERENCE_MODE: 'sometimes'")
    );

    assert.throws(
      () => loadConfig({ NETWORK_MODE: 'mock', INFERENCE_CAP_PER_TICK: '0' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.message.includes(`Invalid INFERENCE_CAP_PER_TICK: '0'`)
    );

    const defaults = loadConfig({ NETWORK_MODE: 'mock' });
    assert.equal(defaults.inference.mode, 'free');
    assert.equal(defaults.inference.capPerTick, 5);
    assert.deepEqual(defaults.inference.providers, []);
  });

  // ==========================================================================
  // C27 — free mode with provider answering
  // ==========================================================================

  it('C27 free mode uses provider and records no EXPENSE_LLM', async () => {
    const ollama: InferenceProvider = new OllamaProvider(
      { baseUrl: 'http://localhost:11434', model: 'llama3' },
      chatFetch(JSON.stringify({ pYes: 0.62, pNo: 0.38 }), 42)
    );
    const { engine, expenseEvents } = makeEngine({
      mode: 'free',
      providers: [ollama],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.62, pNo: 0.38 }), 42),
    });

    const outcome: InferenceOutcome = await engine.estimate(market);

    assert.equal(outcome.source, 'provider');
    assert.ok(outcome.estimate);
    assert.equal(outcome.estimate?.pYes, 0.62);
    assert.equal(outcome.estimate?.pNo, 0.38);
    assert.equal(outcome.estimate?.origin, 'provider');
    assert.equal(outcome.estimate?.tokensUsed, 42);
    assert.deepEqual(expenseEvents, []);
  });

  // ==========================================================================
  // C28 — provider failure advances the queue in configured order
  // ==========================================================================

  it('C28 provider failure advances the queue in configured order', async () => {
    const downProvider: InferenceProvider = {
      id: 'ollama-down',
      type: 'ollama',
      free: true,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      estimate: async () => {
        throw new Error('connection refused');
      },
    };
    const upProvider: InferenceProvider = {
      id: 'ollama-up',
      type: 'ollama',
      free: true,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider' }),
    };
    const { engine, fallbackEvents } = makeEngine({
      mode: 'free',
      providers: [downProvider, upProvider],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.6, pNo: 0.4 })),
    });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'provider');
    assert.equal(outcome.providerId, 'ollama-up');
    assert.equal(fallbackEvents.length, 1);
  });

  // ==========================================================================
  // C29 — empty free queue falls back to deterministic with alert
  // ==========================================================================

  it('C29 empty free queue falls back to deterministic with alert', async () => {
    const { engine, fallbackEvents } = makeEngine({ mode: 'free', providers: [] });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'deterministic');
    assert.equal(outcome.fallbackReason, 'no-provider-for-mode');
    assert.equal(fallbackEvents.length, 1);
  });

  // ==========================================================================
  // C30 — per-tick cap stops further calls, rest uses deterministic
  // ==========================================================================

  it('C30 cap of five stops further calls', async () => {
    const provider: InferenceProvider = {
      id: 'ollama',
      type: 'ollama',
      free: true,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider' }),
    };
    const { engine } = makeEngine({
      mode: 'free',
      providers: [provider],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.6, pNo: 0.4 })),
    });

    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await engine.estimate(market));
    }

    assert.equal(outcomes[4].source, 'provider');
    assert.equal(outcomes[5].source, 'deterministic');
    assert.match(outcomes[5].fallbackReason ?? '', /^cap-reached:/);
    assert.equal(engine.callCount, 5);
  });

  // ==========================================================================
  // C31 — paid mode records expense only when provider reports cost
  // ==========================================================================

  it('C31 paid mode records expense only when provider reports cost', async () => {
    const paidProvider: InferenceProvider = {
      id: 'groq',
      type: 'openai',
      free: false,
      model: 'llama-3.1-8b-instant',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk-test-key',
      estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider', costUsd: 0.01 }),
    };
    const { engine, expenseEvents } = makeEngine({
      mode: 'paid',
      providers: [paidProvider],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.6, pNo: 0.4 })),
    });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'provider');
    assert.equal(expenseEvents.length, 1);
    assert.equal(expenseEvents[0].costUsd, 0.01);
    assert.equal(expenseEvents[0].providerId, 'groq');
  });

  it('C31 paid mode without provider cost reports no expense', async () => {
    const paidProvider: InferenceProvider = {
      id: 'groq',
      type: 'openai',
      free: false,
      model: 'llama-3.1-8b-instant',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk-test-key',
      estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider' }),
    };
    const { engine, expenseEvents } = makeEngine({
      mode: 'paid',
      providers: [paidProvider],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.6, pNo: 0.4 })),
    });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'provider');
    assert.deepEqual(expenseEvents, []);
  });

  // ==========================================================================
  // C32 — paid without key degrades to deterministic and never stops
  // ==========================================================================

  it('C32 paid without key degrades to deterministic and never stops', async () => {
    const { engine, fallbackEvents } = makeEngine({
      mode: 'paid',
      providers: [
        {
          id: 'ollama',
          type: 'ollama',
          free: true,
          model: 'llama3',
          baseUrl: 'http://localhost:11434',
        },
      ],
    });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'deterministic');
    assert.equal(fallbackEvents.length, 1);
  });

  // ==========================================================================
  // C34 — invalid probability discarded to next step with value recorded
  // ==========================================================================

  it('C34 invalid probability discarded to next step with value recorded', async () => {
    const badProvider: InferenceProvider = {
      id: 'bad',
      type: 'ollama',
      free: true,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      estimate: async () => ({ pYes: 1.5, pNo: 0.5, origin: 'provider' }),
    };
    const goodProvider: InferenceProvider = {
      id: 'good',
      type: 'ollama',
      free: true,
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      estimate: async () => ({ pYes: 0.6, pNo: 0.4, origin: 'provider' }),
    };
    const { engine, invalidEvents } = makeEngine({
      mode: 'free',
      providers: [badProvider, goodProvider],
      fetchImpl: chatFetch(JSON.stringify({ pYes: 0.6, pNo: 0.4 })),
    });

    const outcome = await engine.estimate(market);

    assert.equal(outcome.source, 'provider');
    assert.equal(outcome.providerId, 'good');
    assert.equal(invalidEvents.length, 1);
  });
});

describe('Ollama provider — free/local inference backend', () => {
  it('estimates through the Ollama OpenAI-compatible endpoint and parses JSON', async () => {
    const provider = new OllamaProvider(
      { baseUrl: 'http://localhost:11434', model: 'llama3' },
      chatFetch(JSON.stringify({ pYes: 0.62, pNo: 0.38 }), 42)
    );

    const estimate = await provider.estimate({ market });

    assert.equal(estimate.pYes, 0.62);
    assert.equal(estimate.pNo, 0.38);
    assert.equal(estimate.tokensUsed, 42);
    assert.equal(estimate.origin, 'provider');
  });

  it('throws on non-ok response', async () => {
    const provider = new OllamaProvider(
      { baseUrl: 'http://localhost:11434', model: 'llama3' },
      chatFetch('x', 1, false)
    );

    await assert.rejects(() => provider.estimate({ market }), /LLM provider HTTP 500/);
  });

  it('throws on non-JSON content', async () => {
    const provider = new OllamaProvider(
      { baseUrl: 'http://localhost:11434', model: 'llama3' },
      chatFetch('not json', 1)
    );

    await assert.rejects(() => provider.estimate({ market }), /non-JSON/);
  });

  it('creates the ollama provider from its config entry', () => {
    const provider = createInferenceProvider(ollamaProviderConfig);
    assert.equal(provider.id, 'ollama');
    assert.equal(provider.free, true);
    assert.equal(provider.model, 'llama3');
  });
});
