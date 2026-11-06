/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Adaptive Metabolism Engine
 * ==============================================================================
 * Evaluates liquid wallet balances against Constitutional thresholds
 * and dynamically transitions between four metabolic states:
 * - VERDE (> $50.00): Full capability, advanced model class, 60s tick.
 * - AMARELO ($10.00 - $50.00): Economic conservation, economic model, 300s tick.
 * - LARANJA ($2.00 - $10.00): Emergency survival, survival model, 60s tick.
 *   - Critical sub-tier ($0.00 < B < $2.00): Gas spending frozen, liquidity harvest only.
 * - VERMELHO (<= $0.00): Terminal insolvency, Permadeath protocol trigger.
 */

import type { TierStatus, MetabolicTier, ModelClass } from '../types.ts';
import { getConfig } from '../config.ts';

export interface EvaluateTierOptions {
  thresholds?: {
    green: number;
    yellow: number;
    orange: number;
    red: number;
  };
  intervals?: {
    greenMs: number;
    yellowMs: number;
    orangeMs: number;
  };
}

/**
 * Evaluates the current metabolic tier based on verified USD balance.
 *
 * @param balanceUsd Liquid balance in USD equivalent.
 * @param options Optional threshold and interval overrides.
 * @returns Fully populated TierStatus object.
 */
export function evaluateTier(
  balanceUsd: number,
  options?: EvaluateTierOptions
): TierStatus {
  // 1. Strict Input Validation
  if (typeof balanceUsd !== 'number' || Number.isNaN(balanceUsd)) {
    throw new TypeError(
      `balanceUsd must be a valid number. Received: ${String(balanceUsd)}`
    );
  }

  // 2. Resolve Thresholds & Intervals (Options -> Config Defaults)
  let greenThreshold = 50.0;
  let yellowThreshold = 10.0;
  let orangeThreshold = 2.0;
  let redThreshold = 0.0;

  let greenIntervalMs = 60000;
  let yellowIntervalMs = 300000;
  let orangeIntervalMs = 60000;

  try {
    const config = getConfig();
    greenThreshold = config.tierThresholds.green;
    yellowThreshold = config.tierThresholds.yellow;
    orangeThreshold = config.tierThresholds.orange;
    redThreshold = config.tierThresholds.red;

    greenIntervalMs = config.heartbeatIntervals.greenMs;
    yellowIntervalMs = config.heartbeatIntervals.yellowMs;
    orangeIntervalMs = config.heartbeatIntervals.orangeMs;
  } catch {
    // If config fails to load, use constitutional hardcoded defaults above
  }

  if (options?.thresholds) {
    if (options.thresholds.green !== undefined) greenThreshold = options.thresholds.green;
    if (options.thresholds.yellow !== undefined) yellowThreshold = options.thresholds.yellow;
    if (options.thresholds.orange !== undefined) orangeThreshold = options.thresholds.orange;
    if (options.thresholds.red !== undefined) redThreshold = options.thresholds.red;
  }

  if (options?.intervals) {
    if (options.intervals.greenMs !== undefined) greenIntervalMs = options.intervals.greenMs;
    if (options.intervals.yellowMs !== undefined) yellowIntervalMs = options.intervals.yellowMs;
    if (options.intervals.orangeMs !== undefined) orangeIntervalMs = options.intervals.orangeMs;
  }

  // 3. Metabolic Tier Partition Logic
  // Article III & Article IV Partitioning:
  // - Balance > greenThreshold => VERDE
  // - yellowThreshold <= Balance <= greenThreshold => AMARELO
  // - redThreshold < Balance < yellowThreshold => LARANJA
  //   - redThreshold < Balance < orangeThreshold => Critical survival sub-tier
  // - Balance <= redThreshold => VERMELHO

  if (balanceUsd > greenThreshold) {
    return {
      tier: 'VERDE',
      balanceUsd,
      heartbeatIntervalMs: greenIntervalMs,
      allowSpeculativeResearch: true,
      allowSelfModification: true,
      modelClass: 'advanced',
      reason: 'Full Capability Mode (Constitution Article III)',
    };
  }

  if (balanceUsd >= yellowThreshold) {
    return {
      tier: 'AMARELO',
      balanceUsd,
      heartbeatIntervalMs: yellowIntervalMs,
      allowSpeculativeResearch: false,
      allowSelfModification: false,
      modelClass: 'economic',
      reason: 'Economic Conservation Mode (Constitution Article III)',
    };
  }

  if (balanceUsd > redThreshold) {
    const isCritical = balanceUsd < orangeThreshold;
    return {
      tier: 'LARANJA',
      balanceUsd,
      heartbeatIntervalMs: orangeIntervalMs,
      allowSpeculativeResearch: false,
      allowSelfModification: false,
      modelClass: 'survival',
      reason: isCritical
        ? 'CRITICAL_SURVIVAL_SUB_TIER'
        : 'Emergency Survival Mode (Constitution Article III)',
    };
  }

  // Terminal Insolvency (balanceUsd <= redThreshold)
  return {
    tier: 'VERMELHO',
    balanceUsd,
    heartbeatIntervalMs: 0,
    allowSpeculativeResearch: false,
    allowSelfModification: false,
    modelClass: 'survival',
    reason: 'Terminal Insolvency (Constitution Article IV)',
  };
}

/**
 * Helper to check if a balance triggers terminal insolvency.
 */
export function isTerminalInsolvency(
  balanceUsd: number,
  redThreshold: number = 0.0
): boolean {
  if (typeof balanceUsd !== 'number' || Number.isNaN(balanceUsd)) {
    throw new TypeError(`balanceUsd must be a valid number. Received: ${String(balanceUsd)}`);
  }
  return balanceUsd <= redThreshold;
}

/**
 * Helper to check if a balance is in the critical survival sub-tier ($0 < B < $2).
 */
export function isCriticalSurvival(
  balanceUsd: number,
  orangeThreshold: number = 2.0,
  redThreshold: number = 0.0
): boolean {
  if (typeof balanceUsd !== 'number' || Number.isNaN(balanceUsd)) {
    throw new TypeError(`balanceUsd must be a valid number. Received: ${String(balanceUsd)}`);
  }
  return balanceUsd > redThreshold && balanceUsd < orangeThreshold;
}
