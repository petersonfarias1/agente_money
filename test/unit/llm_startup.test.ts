/**
 * LLM startup: provider presets, startup preflight and refused start.
 * Hermetic per TEST_INFRA.md §1.2: in-memory database, temp control dir,
 * no network and no timer-based waits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { buildPresetProviders, isUsableApiKey, loadConfig } from '../../src/config.ts';
import { runInferencePreflight, NoLLMAvailableError } from '../../src/modules/inference/preflight.ts';
import { computeCostUsd, extractJsonObject } from '../../src/modules/inference/provider.ts';
import type { InferenceProvider } from '../../src/modules/inference/types.ts';
import { bootstrapAgent, START_REFUSED_EXIT_CODE } from '../../src/index.ts';
import { AgentControl } from '../../src/modules/dashboard/agent_control.ts';
import { DatabaseService } from '../../src/core/database.ts';

function stubProvider(overrides: Partial<InferenceProvider> & { id: string }): InferenceProvider {
  return {
    type: 'openai',
    free: true,
    model: 'stub-model',
    baseUrl: 'http://localhost',
    ping: async () => {},
    estimate: async () => ({ pYes: 0.5, pNo: 0.5, origin: 'provider' }),
    ...overrides,
  };
}

describe('LLM startup — provider presets', () => {
  it('isUsableApiKey rejects absent and placeholder keys', () => {
    assert.equal(isUsableApiKey(undefined), false);
    assert.equal(isUsableApiKey(''), false);
    assert.equal(isUsableApiKey('   '), false);
    assert.equal(isUsableApiKey('mock-key'), false);
    assert.equal(isUsableApiKey('change-me'), false);
    assert.equal(isUsableApiKey('YOUR_API_KEY_HERE'), false);
    assert.equal(isUsableApiKey('sk-real-secret-key-12345'), true);
  });

  it('free mode assembles keyed providers in the configured order and skips placeholders', () => {
    const providers = buildPresetProviders({
      OPENROUTER_API_KEY: 'sk-or-real-key',
      GROQ_API_KEY: 'gsk_real_key',
      GEMINI_API_KEY: 'mock-gemini-ignored',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      INFERENCE_FREE_ORDER: 'groq,openrouter,gemini,ollama',
    }, 'free');

    assert.deepEqual(providers.map((p) => p.id), ['groq', 'openrouter', 'ollama']);
    assert.equal(providers[0].model, 'llama-3.3-70b-versatile');
    assert.equal(providers[1].model, 'openrouter/free');
    assert.equal(providers[2].type, 'ollama');
    assert.equal(providers[2].apiKey, undefined);
    assert.ok(providers.every((p) => p.free && p.priceInPerMTok === undefined));
  });

  it('free mode leaves Ollama out when OLLAMA_BASE_URL is unset', () => {
    assert.deepEqual(buildPresetProviders({ INFERENCE_FREE_ORDER: 'ollama' }, 'free'), []);
  });

  it('paid mode includes per-token pricing and env overrides', () => {
    const providers = buildPresetProviders({
      ANTHROPIC_API_KEY: 'sk-ant-real-key',
      ANTHROPIC_PRICE_IN_PER_MTOK: '1.25',
      ANTHROPIC_PRICE_OUT_PER_MTOK: '6.00',
      GEMINI_API_KEY: 'AIzaSyRealGeminiKey',
      INFERENCE_PAID_ORDER: 'gemini,anthropic',
    }, 'paid');

    assert.deepEqual(providers.map((p) => p.id), ['gemini-paid', 'anthropic']);
    assert.equal(providers[0].free, false);
    assert.equal(providers[0].priceInPerMTok, 0.3);
    assert.equal(providers[1].priceInPerMTok, 1.25);
    assert.equal(providers[1].priceOutPerMTok, 6.0);
  });
});

describe('LLM startup — completion parsing and cost', () => {
  it('extractJsonObject parses clean JSON, markdown code fences, and wrapped text', () => {
    assert.deepEqual(extractJsonObject('{"pYes":0.6,"pNo":0.4}'), { pYes: 0.6, pNo: 0.4 });
    assert.deepEqual(
      extractJsonObject('Sure! Here is the answer:\n```json\n{"pYes":0.8,"pNo":0.2}\n```\nHope it helps.'),
      { pYes: 0.8, pNo: 0.2 }
    );
    assert.deepEqual(extractJsonObject('Output: {"score":0.75} finished.'), { score: 0.75 });
  });

  it('computeCostUsd converts the reported token split and never invents an amount', () => {
    // (1000 * 1.0 + 500 * 5.0) / 1_000_000 = 0.0035 USD
    assert.equal(
      computeCostUsd({ promptTokens: 1_000, completionTokens: 500 }, { priceInPerMTok: 1.0, priceOutPerMTok: 5.0 }),
      0.0035
    );
    assert.equal(computeCostUsd({ promptTokens: 1000, completionTokens: 500 }, {}), undefined);
    assert.equal(computeCostUsd({}, { priceInPerMTok: 1.0, priceOutPerMTok: 5.0 }), undefined);
  });
});

describe('LLM startup — preflight', () => {
  it('keeps providers that answer and drops the ones that fail', async () => {
    const result = await runInferencePreflight([
      stubProvider({ id: 'groq' }),
      stubProvider({ id: 'openrouter', ping: async () => { throw new Error('401 Unauthorized: invalid key'); } }),
    ], 'free');

    assert.deepEqual(result.healthy.map((p) => p.id), ['groq']);
    assert.equal(result.passed.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, 'openrouter');
    assert.match(result.failed[0].reason, /401 Unauthorized/);
  });

  it('throws NoLLMAvailableError when every provider fails', async () => {
    await assert.rejects(
      runInferencePreflight(
        [stubProvider({ id: 'openrouter', ping: async () => { throw new Error('503 Service Unavailable'); } })],
        'free'
      ),
      (err: Error) => {
        assert.ok(err instanceof NoLLMAvailableError);
        assert.equal(err.mode, 'free');
        assert.match(err.message, /NoLLMAvailable: free/);
        assert.match(err.message, /503 Service Unavailable/);
        return true;
      }
    );
  });

  it('throws NoLLMAvailableError with a config hint when the mode has no provider', async () => {
    await assert.rejects(runInferencePreflight([], 'paid'), /no paid provider configured/);
  });
});

describe('LLM startup — refused start', () => {
  it('bootstrapAgent exits 78, records the failure and reports it over IPC when no LLM answers', async () => {
    const database = new DatabaseService(':memory:');
    database.initialize();
    let exitCode: number | null = null;
    let sentMessage: unknown = null;
    try {
      const result = await bootstrapAgent({
        config: loadConfig({ INFERENCE_MODE: 'free', INFERENCE_PROVIDERS: '[]' }),
        database,
        providers: [stubProvider({ id: 'broken', ping: async () => { throw new Error('Connection refused'); } })],
        send: (message, ack) => {
          sentMessage = message;
          ack?.();
        },
        exit: (code) => { exitCode = code; },
        log: () => {},
      });

      assert.equal(result, null);
      assert.equal(exitCode, START_REFUSED_EXIT_CODE);
      assert.deepEqual(sentMessage, {
        type: 'agent-start-failed',
        reason: 'NoLLMAvailable: free — broken: Connection refused',
      });
      const recorded = database.getActions(10, 'inference').map((action) => action.actionType);
      assert.deepEqual(recorded, ['INFERENCE_PREFLIGHT_FAILED']);
    } finally {
      database.close();
    }
  });

  it('AgentControl.start forwards the mode to the child env and surfaces agent-start-failed', async () => {
    class RefusingChild extends EventEmitter {
      pid = 4321;
      unref(): void {}
    }
    const rootDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp_llm_startup_'));
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    try {
      const control = new AgentControl({
        rootDir,
        isAlive: () => false,
        spawnAgent: (options) => {
          capturedEnv = options.env;
          const child = new RefusingChild();
          // Delivered once the control has attached its listeners.
          queueMicrotask(() => {
            child.emit('message', {
              type: 'agent-start-failed',
              reason: 'NoLLMAvailable: paid — no paid provider configured',
            });
            child.emit('exit', START_REFUSED_EXIT_CODE);
          });
          return child as never;
        },
      });

      const snapshot = await control.start({ mode: 'paid' });
      assert.equal(capturedEnv?.INFERENCE_MODE, 'paid');
      assert.equal(snapshot.state, 'stopped');
      assert.match(snapshot.error ?? '', /NoLLMAvailable: paid/);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
