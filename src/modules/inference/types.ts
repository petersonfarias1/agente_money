/**
 * ==============================================================================
 * APEX AEA — Inference Layer: shared contracts
 * ==============================================================================
 * Types shared by the LLM provider adapters and the inference engine. The
 * engine owns mode/queue/cap/fallback policy; providers own the wire protocol.
 */

import type { InferenceProviderConfig, InferenceMode, InferenceProviderType } from '../../types.ts';
import type { BountyTask, PolymarketMarket } from '../../types.ts';

/**
 * A single estimation request: one candidate market the estimator should score.
 */
export interface InferenceRequest {
  market: PolymarketMarket;
}

export interface BountyInferenceRequest {
  task: BountyTask;
}

export interface InferenceScoreEstimate {
  score: number;
  origin: 'provider';
  providerId?: string;
  model?: string;
  tokensUsed?: number;
  costUsd?: number;
}

export interface InferenceScoreOutcome {
  source: 'provider' | 'deterministic';
  score: number;
  providerId?: string;
  fallbackReason?: string;
}

/**
 * A resolved probability estimate. `origin` distinguishes a provider answer
 * (`provider`) from the deterministic last-degrau fallback (`deterministic`).
 */
export interface InferenceEstimate {
  pYes: number;
  pNo: number;
  origin: 'provider' | 'deterministic';
  providerId?: string;
  model?: string;
  tokensUsed?: number;
  costUsd?: number;
}

/**
 * Result of walking the provider queue for one estimation.
 */
export interface InferenceOutcome {
  source: 'provider' | 'deterministic';
  estimate: InferenceEstimate | null;
  providerId?: string;
  fallbackReason?: string;
}

export interface InferenceFallbackEvent {
  reason: string;
  providerId?: string;
  marketId?: string;
  taskId?: string;
}

export interface InferenceInvalidProbabilityEvent {
  value: { pYes?: number; pNo?: number };
  providerId?: string;
  marketId?: string;
}

export interface InferenceInvalidScoreEvent {
  value: unknown;
  providerId?: string;
  taskId: string;
}

export interface InferenceExpenseEvent {
  costUsd: number;
  providerId: string;
}

export interface InferenceStatusEvent {
  /** Effective mode for the current tick. */
  mode: InferenceMode;
  /** Operator-configured ceiling (AD-003). */
  ceilingMode: InferenceMode;
  providerId: string | null;
  providerModel: string | null;
  callsUsed: number;
  capPerTick: number;
  source: 'provider' | 'deterministic';
  fallbackReason: string | null;
}

export interface InferenceProvider {
  readonly id: string;
  readonly type: InferenceProviderType;
  readonly free: boolean;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  estimate(request: InferenceRequest): Promise<InferenceEstimate>;
  evaluateBounty?(request: BountyInferenceRequest): Promise<InferenceScoreEstimate>;
  /** Minimal liveness call used by the startup preflight; throws when unavailable. */
  ping?(timeoutMs: number): Promise<void>;
}

export interface InferenceEngineOptions {
  mode: InferenceMode;
  capPerTick: number;
  providers: InferenceProvider[];
  fallback: (
    market: PolymarketMarket
  ) => Promise<{ pYes: number; pNo: number } | null> | { pYes: number; pNo: number } | null;
  fetchImpl?: typeof fetch;
  onFallback?: (event: InferenceFallbackEvent) => void;
  onInvalidProbability?: (event: InferenceInvalidProbabilityEvent) => void;
  onInvalidScore?: (event: InferenceInvalidScoreEvent) => void;
  onExpense?: (event: InferenceExpenseEvent) => void;
  onStatus?: (event: InferenceStatusEvent) => void;
}
