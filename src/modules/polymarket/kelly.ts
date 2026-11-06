/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Kelly Criterion Risk Engine
 * ==============================================================================
 * Mathematical risk sizing engine for prediction market positions:
 * - Fractional Quarter-Kelly formula: f* = 0.25 * (b * p - q) / b
 * - Inviolable strict Expected Value (EV) hurdle: (b * p - q > 0)
 * - Maximum bankroll ceiling: min(f*, 0.05) [Article II.2]
 * - Minimum dust order threshold: $1.00 USD [Article II.4]
 * - 6-decimal USDC precision handling
 */

import { type KellyCalculation, KellyRiskError } from '../../types.ts';

export interface KellyOptions {
  fractionMultiplier?: number; // default: 0.25 (Quarter-Kelly)
  maxBankrollCap?: number;     // default: 0.05 (5.0% ceiling)
  minOrderSizeUsd?: number;    // default: 1.00 USD dust floor
}

/**
 * Calculates net decimal odds b for binary conditional token market:
 * b = (1 - marketPrice) / marketPrice = (Payout - Stake) / Stake
 *
 * @param marketPrice Share acquisition price in (0, 1)
 */
export function calculateNetOdds(marketPrice: number): number {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice >= 1) {
    throw new KellyRiskError(
      `Invalid market price: ${marketPrice}. Market price must be strictly between 0 and 1.`
    );
  }
  return Number(((1 - marketPrice) / marketPrice).toFixed(12));
}

/**
 * Calculates Expected Value per unit of stake:
 * EV = b * p - q = (p - marketPrice) / marketPrice
 *
 * @param b Net decimal odds
 * @param p Estimated true probability of outcome
 * @param q Probability of loss (1 - p)
 */
export function calculateExpectedValue(b: number, p: number, q: number): number {
  if (!Number.isFinite(b) || b <= 0) {
    throw new KellyRiskError(`Invalid net odds b: ${b}. Odds must be finite and positive.`);
  }
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new KellyRiskError(`Invalid probability p: ${p}. Probability must be strictly between 0 and 1.`);
  }
  return Number((b * p - q).toFixed(12));
}

/**
 * Calculates Quarter-Kelly capital allocation and stake amount with strict EV hurdle
 * and 5.0% bankroll ceiling.
 *
 * @param marketPrice Current market price Pm in (0, 1)
 * @param estimatedProb Model estimated true probability p in (0, 1)
 * @param totalBankroll Total available liquid bankroll in USD
 * @param options Risk management configuration overrides
 */
export function calculateKellyStake(
  marketPrice: number,
  estimatedProb: number,
  totalBankroll: number,
  options?: KellyOptions
): KellyCalculation {
  // 1. Validate Input Bounds
  if (!Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice >= 1) {
    throw new KellyRiskError(
      `Invalid market price: ${marketPrice}. Market price must be strictly between 0 and 1.`
    );
  }

  if (!Number.isFinite(estimatedProb) || estimatedProb <= 0 || estimatedProb >= 1) {
    throw new KellyRiskError(
      `Invalid estimated probability: ${estimatedProb}. Estimated probability must be strictly between 0 and 1.`
    );
  }

  const fractionMultiplier = options?.fractionMultiplier ?? 0.25;
  const maxBankrollCap = options?.maxBankrollCap ?? 0.05;
  const minOrderSizeUsd = options?.minOrderSizeUsd ?? 1.00;

  // 2. Compute Mathematical Factors
  const b = Number(((1 - marketPrice) / marketPrice).toFixed(12));
  const p = Number(estimatedProb.toFixed(12));
  const q = Number((1 - p).toFixed(12));
  const expectedValue = Number((b * p - q).toFixed(12));
  const rawKellyFraction = Number((expectedValue / b).toFixed(12));
  const quarterKellyFraction = Number((fractionMultiplier * rawKellyFraction).toFixed(12));

  // 3. Bankroll Verification
  if (!Number.isFinite(totalBankroll) || totalBankroll <= 0) {
    return {
      authorized: false,
      b,
      p,
      q,
      expectedValue,
      rawKellyFraction,
      quarterKellyFraction,
      allocatedFraction: 0,
      stakeAmountUsd: 0,
      rejectionReason: 'REJECTED_INSUFFICIENT_BANKROLL',
    };
  }

  // 4. Inviolable Strict EV Hurdle (Constitution Article II.3)
  // EV must be strictly positive: b * p - q > 0  <=>  p > Pm
  if (expectedValue <= 0) {
    return {
      authorized: false,
      b,
      p,
      q,
      expectedValue,
      rawKellyFraction: Math.max(0, rawKellyFraction),
      quarterKellyFraction: Math.max(0, quarterKellyFraction),
      allocatedFraction: 0,
      stakeAmountUsd: 0,
      rejectionReason: 'REJECTED_NON_POSITIVE_EV',
    };
  }

  // 5. Inviolable Bankroll Ceiling (Constitution Article II.2)
  // Under no circumstances may any single position exceed 5.0% of bankroll
  const allocatedFraction = Math.min(quarterKellyFraction, maxBankrollCap);

  if (allocatedFraction <= 0) {
    return {
      authorized: false,
      b,
      p,
      q,
      expectedValue,
      rawKellyFraction,
      quarterKellyFraction,
      allocatedFraction: 0,
      stakeAmountUsd: 0,
      rejectionReason: 'REJECTED_NON_POSITIVE_EV',
    };
  }

  // 6. Stake Calculation & USDC Precision
  const rawStake = allocatedFraction * totalBankroll;
  const stakeAmountUsd = Number(rawStake.toFixed(6));

  // 7. Inviolable Dust Order Floor (Constitution Article II.4)
  // Minimum order size on Polymarket is $1.00 USD
  if (stakeAmountUsd < minOrderSizeUsd) {
    return {
      authorized: false,
      b,
      p,
      q,
      expectedValue,
      rawKellyFraction,
      quarterKellyFraction,
      allocatedFraction,
      stakeAmountUsd: 0,
      rejectionReason: 'REJECTED_DUST_THRESHOLD',
    };
  }

  // 8. Order Sizing Authorized
  return {
    authorized: true,
    b,
    p,
    q,
    expectedValue,
    rawKellyFraction,
    quarterKellyFraction,
    allocatedFraction,
    stakeAmountUsd,
  };
}
