/**
 * ==============================================================================
 * APEX AEA — Inference Layer: engine (mode, provider queue, cap, fallback)
 * ==============================================================================
 * Owns the inference policy for one estimation:
 * - mode `free` walks the free providers, mode `paid` walks the paid ones;
 * - the queue is walked in configured order until one provider answers;
 * - the per-tick call cap is enforced before any provider call;
 * - probabilities outside (0, 1) or non-numeric are discarded to the next step;
 * - the deterministic estimator is always the last degrau;
 * - the configured mode is a ceiling: below VERDE a paid ceiling steps down to
 *   free (AD-003), and the tier can never raise a free ceiling to paid.
 */

import type {
  BountyTask,
  InferenceMode,
  MetabolicTier,
  PolymarketMarket,
} from '../../types.ts';
import type {
  InferenceEngineOptions,
  InferenceEstimate,
  InferenceOutcome,
  InferenceProvider,
  InferenceScoreOutcome,
} from './types.ts';

export class InferenceEngine {
  private callsUsed = 0;
  private lastProviderId: string | null = null;
  private lastModel: string | null = null;
  private lastSource: 'provider' | 'deterministic' = 'deterministic';
  private lastFallbackReason: string | null = null;
  private readonly options: InferenceEngineOptions;
  private effectiveMode: InferenceMode;

  constructor(options: InferenceEngineOptions) {
    this.options = options;
    this.effectiveMode = options.mode;
  }

  /** Mode used for the current tick (may be below the ceiling). */
  public get mode(): InferenceMode {
    return this.effectiveMode;
  }

  /** Mode the operator configured; the tier can only step down from it. */
  public get ceilingMode(): InferenceMode {
    return this.options.mode;
  }

  /**
   * Applies the metabolic tier to the mode for this tick (AD-003): a paid
   * ceiling stays paid only in VERDE; every other tier walks the free queue.
   * Returns the transition when the effective mode changed, otherwise null.
   */
  public applyTier(tier: MetabolicTier): { from: InferenceMode; to: InferenceMode } | null {
    const next = modeForTier(this.options.mode, tier);
    if (next === this.effectiveMode) return null;
    const transition = { from: this.effectiveMode, to: next };
    this.effectiveMode = next;
    this.options.onStatus?.(this.status);
    return transition;
  }

  public get capPerTick(): number {
    return this.options.capPerTick;
  }

  public get callCount(): number {
    return this.callsUsed;
  }

  public get status() {
    return {
      mode: this.mode,
      ceilingMode: this.ceilingMode,
      providerId: this.lastProviderId,
      providerModel: this.lastModel,
      callsUsed: this.callsUsed,
      capPerTick: this.capPerTick,
      source: this.lastSource,
      fallbackReason: this.lastFallbackReason,
    } as const;
  }

  /**
   * Resets the per-tick inference call counter. Called at the start of every tick.
   */
  public resetTick(): void {
    this.callsUsed = 0;
    this.lastProviderId = null;
    this.lastModel = null;
    this.lastSource = 'deterministic';
    this.lastFallbackReason = null;
    this.options.onStatus?.(this.status);
  }

  /**
   * Estimates the YES/NO probability for a candidate market, walking the
   * provider queue in order and degrading to the deterministic estimator.
   */
  public async estimate(market: PolymarketMarket): Promise<InferenceOutcome> {
    const mode = this.mode;
    const candidates = this.options.providers.filter(
      (provider: InferenceProvider) =>
        mode === 'paid' ? !provider.free && Boolean(provider.apiKey) : provider.free
    );

    const runFallback = async (fallbackReason: string): Promise<InferenceOutcome> => {
      const fallbackEstimate = await this.options.fallback(market);
      const estimate: InferenceEstimate | null = fallbackEstimate
        ? { pYes: fallbackEstimate.pYes, pNo: fallbackEstimate.pNo, origin: 'deterministic' }
        : null;
      this.lastSource = 'deterministic';
      this.lastProviderId = null;
      this.lastModel = null;
      this.lastFallbackReason = fallbackReason;
      this.options.onStatus?.(this.status);
      return { source: 'deterministic', estimate, fallbackReason };
    };

    if (candidates.length === 0) {
      const outcome = await runFallback('no-provider-for-mode');
      this.options.onFallback?.({ reason: 'no-provider-for-mode', marketId: market.id });
      return outcome;
    }

    for (const provider of candidates) {
      if (this.callsUsed >= this.options.capPerTick) {
        // Cap reached: deterministic fallback, no error, no extra call.
        const outcome = await runFallback(`cap-reached:${this.options.capPerTick}`);
        return { ...outcome, fallbackReason: `cap-reached:${this.options.capPerTick}` };
      }

      let estimate: InferenceEstimate;
      this.callsUsed += 1;
      try {
        estimate = await provider.estimate({ market });
      } catch (error) {
        this.options.onFallback?.({ reason: (error as Error).message, providerId: provider.id, marketId: market.id });
        continue;
      }

      const valid =
        Number.isFinite(estimate.pYes) &&
        Number.isFinite(estimate.pNo) &&
        estimate.pYes > 0 &&
        estimate.pYes < 1 &&
        estimate.pNo > 0 &&
        estimate.pNo < 1;
      if (!valid) {
        this.options.onInvalidProbability?.({
          value: { pYes: estimate.pYes, pNo: estimate.pNo },
          providerId: provider.id,
          marketId: market.id,
        });
        continue;
      }

      if (mode === 'paid' && typeof estimate.costUsd === 'number' && Number.isFinite(estimate.costUsd)) {
        this.options.onExpense?.({ costUsd: estimate.costUsd, providerId: provider.id });
      }

      this.lastProviderId = provider.id;
      this.lastModel = provider.model;
      this.lastSource = 'provider';
      this.lastFallbackReason = null;
      this.options.onStatus?.(this.status);

      return { source: 'provider', estimate, providerId: provider.id };
    }

    const outcome = await runFallback('provider-queue-exhausted');
    this.options.onFallback?.({ reason: 'provider-queue-exhausted', marketId: market.id });
    return outcome;
  }

  public async evaluateBounty(
    task: BountyTask,
    deterministicScore: () => number
  ): Promise<InferenceScoreOutcome> {
    const candidates = this.options.providers.filter((provider) =>
      this.mode === 'paid' ? !provider.free && Boolean(provider.apiKey) : provider.free
    );
    const fallback = (reason: string): InferenceScoreOutcome => {
      const score = deterministicScore();
      this.lastProviderId = null;
      this.lastModel = null;
      this.lastSource = 'deterministic';
      this.lastFallbackReason = reason;
      this.options.onStatus?.(this.status);
      this.options.onFallback?.({ reason, taskId: task.id });
      return { source: 'deterministic', score, fallbackReason: reason };
    };

    if (candidates.length === 0) return fallback('no-provider-for-mode');
    for (const provider of candidates) {
      if (!provider.evaluateBounty) continue;
      if (this.callsUsed >= this.capPerTick) return fallback(`cap-reached:${this.capPerTick}`);
      this.callsUsed += 1;
      let result;
      try {
        result = await provider.evaluateBounty({ task });
      } catch (error) {
        this.options.onFallback?.({ reason: (error as Error).message, providerId: provider.id, taskId: task.id });
        continue;
      }
      if (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
        this.options.onInvalidScore?.({ value: result.score, providerId: provider.id, taskId: task.id });
        continue;
      }
      if (this.mode === 'paid' && typeof result.costUsd === 'number' && Number.isFinite(result.costUsd)) {
        this.options.onExpense?.({ costUsd: result.costUsd, providerId: provider.id });
      }
      this.lastProviderId = provider.id;
      this.lastModel = provider.model;
      this.lastSource = 'provider';
      this.lastFallbackReason = null;
      this.options.onStatus?.(this.status);
      return { source: 'provider', score: result.score, providerId: provider.id };
    }
    return fallback('provider-queue-exhausted');
  }
}

/** Effective inference mode for a tier under the operator's ceiling (AD-003). */
export function modeForTier(ceiling: InferenceMode, tier: MetabolicTier): InferenceMode {
  return ceiling === 'paid' && tier === 'VERDE' ? 'paid' : 'free';
}
