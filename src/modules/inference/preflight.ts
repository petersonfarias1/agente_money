/**
 * ==============================================================================
 * APEX AEA — Inference Layer: startup preflight
 * ==============================================================================
 * The agent must not start without a working LLM for its inference mode.
 * Every provider of the mode is pinged in parallel; providers that fail are
 * removed from the queue for this run, and if none answers the start is
 * refused with `NoLLMAvailableError`. After a successful start, transient
 * provider failures still degrade to the deterministic estimator per tick.
 */

import type { InferenceMode } from '../../types.ts';
import type { InferenceProvider } from './types.ts';

export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 10_000;

export interface PreflightProviderPass {
  id: string;
  model: string;
  latencyMs: number;
}

export interface PreflightProviderFailure {
  id: string;
  model: string;
  reason: string;
}

export interface PreflightResult {
  mode: InferenceMode;
  healthy: InferenceProvider[];
  passed: PreflightProviderPass[];
  failed: PreflightProviderFailure[];
}

const CONFIG_HINT: Record<InferenceMode, string> = {
  free: 'set OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY or OLLAMA_BASE_URL in .env',
  paid: 'set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env',
};

export class NoLLMAvailableError extends Error {
  public readonly mode: InferenceMode;
  public readonly failed: PreflightProviderFailure[];

  constructor(mode: InferenceMode, failed: PreflightProviderFailure[]) {
    const detail = failed.length === 0
      ? `no ${mode} provider configured (${CONFIG_HINT[mode]})`
      : failed.map((failure) => `${failure.id}: ${failure.reason}`).join('; ');
    super(`NoLLMAvailable: ${mode} — ${detail}`);
    this.name = 'NoLLMAvailableError';
    this.mode = mode;
    this.failed = failed;
  }
}

/**
 * Same eligibility rule the engine applies: paid mode walks keyed paid
 * providers only, free mode walks free providers only. A failing paid provider
 * never falls back to free; the only step down is tier-driven (AD-003).
 */
export function providersForMode(providers: InferenceProvider[], mode: InferenceMode): InferenceProvider[] {
  return providers.filter((provider) =>
    mode === 'paid' ? !provider.free && Boolean(provider.apiKey) : provider.free
  );
}

export async function runInferencePreflight(
  providers: InferenceProvider[],
  mode: InferenceMode,
  options: { timeoutMs?: number; now?: () => number } = {}
): Promise<PreflightResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const candidates = providersForMode(providers, mode);
  if (candidates.length === 0) {
    throw new NoLLMAvailableError(mode, []);
  }

  const results = await Promise.all(
    candidates.map(async (provider) => {
      const startedAt = now();
      try {
        if (provider.ping) {
          await withTimeout(provider.ping(timeoutMs), timeoutMs);
        }
        return { ok: true as const, provider, latencyMs: Math.max(0, now() - startedAt) };
      } catch (error) {
        return { ok: false as const, provider, reason: (error as Error)?.message ?? String(error) };
      }
    })
  );

  const healthy: InferenceProvider[] = [];
  const passed: PreflightProviderPass[] = [];
  const failed: PreflightProviderFailure[] = [];
  for (const result of results) {
    if (result.ok) {
      healthy.push(result.provider);
      passed.push({ id: result.provider.id, model: result.provider.model, latencyMs: result.latencyMs });
    } else {
      failed.push({ id: result.provider.id, model: result.provider.model, reason: result.reason });
    }
  }

  if (healthy.length === 0) {
    throw new NoLLMAvailableError(mode, failed);
  }
  return { mode, healthy, passed, failed };
}

/** Guards against adapters that ignore their own timeout. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`preflight timed out after ${timeoutMs}ms`)), timeoutMs + 500);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
