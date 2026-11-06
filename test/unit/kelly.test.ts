/**
 * ==============================================================================
 * Unit Test Suite: Kelly Criterion Risk Management Engine
 * ==============================================================================
 * Target: src/modules/polymarket/kelly.ts
 * Tests:
 * 1. Net odds and expected value mathematical formulas
 * 2. Fractional Quarter-Kelly formula (f* = 0.25 * (bp - q) / b)
 * 3. Inviolable strict Expected Value hurdle (Constitution Article II.3)
 * 4. Inviolable 5.0% bankroll ceiling clamping (Constitution Article II.2)
 * 5. Minimum dust order threshold of $1.00 USD (Constitution Article II.4)
 * 6. Bankroll boundaries and input error handling
 * 7. Custom options overrides
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNetOdds,
  calculateExpectedValue,
  calculateKellyStake,
} from '../../src/modules/polymarket/kelly.ts';
import { KellyRiskError } from '../../src/types.ts';

describe('Kelly Criterion Risk Engine', () => {
  describe('1. Net Odds & Expected Value Calculations', () => {
    it('should calculate net decimal odds b correctly', () => {
      // At Pm = 0.50, b = (1 - 0.5)/0.5 = 1.0
      assert.strictEqual(calculateNetOdds(0.50), 1.0);
      // At Pm = 0.40, b = (1 - 0.4)/0.4 = 1.5
      assert.strictEqual(calculateNetOdds(0.40), 1.5);
      // At Pm = 0.80, b = (1 - 0.8)/0.8 = 0.25
      assert.strictEqual(calculateNetOdds(0.80), 0.25);
      // At Pm = 0.20, b = (1 - 0.2)/0.2 = 4.0
      assert.strictEqual(calculateNetOdds(0.20), 4.0);
    });

    it('should throw KellyRiskError on invalid market price for calculateNetOdds', () => {
      assert.throws(() => calculateNetOdds(0), KellyRiskError);
      assert.throws(() => calculateNetOdds(1), KellyRiskError);
      assert.throws(() => calculateNetOdds(-0.5), KellyRiskError);
      assert.throws(() => calculateNetOdds(1.5), KellyRiskError);
      assert.throws(() => calculateNetOdds(NaN), KellyRiskError);
      assert.throws(() => calculateNetOdds(Infinity), KellyRiskError);
    });

    it('should calculate Expected Value (EV = b * p - q) correctly', () => {
      // b = 1.5, p = 0.60, q = 0.40 => EV = 1.5 * 0.60 - 0.40 = 0.50
      const ev1 = calculateExpectedValue(1.5, 0.60, 0.40);
      assert.ok(Math.abs(ev1 - 0.50) < 1e-9);

      // b = 1.0, p = 0.40, q = 0.60 => EV = 1.0 * 0.40 - 0.60 = -0.20
      const ev2 = calculateExpectedValue(1.0, 0.40, 0.60);
      assert.ok(Math.abs(ev2 - (-0.20)) < 1e-9);
    });

    it('should throw KellyRiskError on invalid arguments in calculateExpectedValue', () => {
      assert.throws(() => calculateExpectedValue(0, 0.5, 0.5), KellyRiskError);
      assert.throws(() => calculateExpectedValue(-1, 0.5, 0.5), KellyRiskError);
      assert.throws(() => calculateExpectedValue(1, 0, 1), KellyRiskError);
      assert.throws(() => calculateExpectedValue(1, 1, 0), KellyRiskError);
      assert.throws(() => calculateExpectedValue(1, NaN, 0.5), KellyRiskError);
    });
  });

  describe('2. Quarter-Kelly Mathematical Sizing', () => {
    it('should compute exact Quarter-Kelly stake on standard edge', () => {
      // Market: Pm = 0.50, Model: p = 0.55, Bankroll = $100.00
      // b = 1.0, q = 0.45, EV = 0.10
      // f_raw = 0.10 / 1.0 = 0.10
      // f* = 0.25 * 0.10 = 0.025 (2.5%)
      // stake = 0.025 * 100 = $2.50
      const calc = calculateKellyStake(0.50, 0.55, 100.0);

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.b, 1.0);
      assert.strictEqual(calc.p, 0.55);
      assert.strictEqual(calc.q, 0.45);
      assert.ok(Math.abs(calc.expectedValue - 0.10) < 1e-9);
      assert.ok(Math.abs(calc.rawKellyFraction - 0.10) < 1e-9);
      assert.ok(Math.abs(calc.quarterKellyFraction - 0.025) < 1e-9);
      assert.strictEqual(calc.allocatedFraction, 0.025);
      assert.strictEqual(calc.stakeAmountUsd, 2.50);
      assert.strictEqual(calc.rejectionReason, undefined);
    });

    it('should compute stake for asymmetric odds', () => {
      // Market: Pm = 0.40, Model: p = 0.45, Bankroll = $1000.00
      // b = 1.5, q = 0.55, EV = 1.5 * 0.45 - 0.55 = 0.125
      // f_raw = 0.125 / 1.5 = 0.083333...
      // f* = 0.25 * 0.083333 = 0.020833...
      // stake = 0.020833... * 1000 = $20.833333
      const calc = calculateKellyStake(0.40, 0.45, 1000.0);

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.b, 1.5);
      assert.ok(Math.abs(calc.allocatedFraction - 0.020833) < 0.0001);
      assert.ok(Math.abs(calc.stakeAmountUsd - 20.833333) < 0.001);
    });
  });

  describe('3. Inviolable Strict EV Hurdle (Article II.3)', () => {
    it('should reject when estimated probability is lower than market price (Negative EV)', () => {
      // Market: Pm = 0.60, Model: p = 0.50, Bankroll = $500.00
      const calc = calculateKellyStake(0.60, 0.50, 500.0);

      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
      assert.strictEqual(calc.allocatedFraction, 0);
      assert.strictEqual(calc.stakeAmountUsd, 0);
      assert.ok(calc.expectedValue < 0);
    });

    it('should reject when estimated probability equals market price (Zero EV / Fair Odds)', () => {
      // Market: Pm = 0.50, Model: p = 0.50, Bankroll = $500.00
      const calc = calculateKellyStake(0.50, 0.50, 500.0);

      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
      assert.strictEqual(calc.allocatedFraction, 0);
      assert.strictEqual(calc.stakeAmountUsd, 0);
      assert.strictEqual(calc.expectedValue, 0);
    });
  });

  describe('4. Inviolable 5.0% Bankroll Ceiling (Article II.2)', () => {
    it('should clamp allocation to exactly 5.0% when Kelly fraction exceeds 0.05', () => {
      // Huge conviction edge: Pm = 0.20, p = 0.80, Bankroll = $1,000.00
      // b = 4.0, q = 0.20, EV = 4.0 * 0.8 - 0.2 = 3.0
      // f_raw = 3.0 / 4.0 = 0.75
      // f* = 0.25 * 0.75 = 0.1875 (18.75%)
      // Clamped to 0.05 (5.0%)
      // stake = 0.05 * 1000 = $50.00
      const calc = calculateKellyStake(0.20, 0.80, 1000.0);

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.quarterKellyFraction, 0.1875);
      assert.strictEqual(calc.allocatedFraction, 0.05);
      assert.strictEqual(calc.stakeAmountUsd, 50.00);
    });

    it('should respect custom maxBankrollCap override if configured', () => {
      // Cap set to 0.03 (3.0%)
      const calc = calculateKellyStake(0.20, 0.80, 1000.0, { maxBankrollCap: 0.03 });

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.allocatedFraction, 0.03);
      assert.strictEqual(calc.stakeAmountUsd, 30.00);
    });
  });

  describe('5. Inviolable Dust Order Floor ($1.00 USD) (Article II.4)', () => {
    it('should reject when stake falls below $1.00 USD due to small bankroll', () => {
      // Bankroll = $15.00, f* = 0.025 => raw stake = 0.375 < 1.00
      const calc = calculateKellyStake(0.50, 0.55, 15.0);

      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_DUST_THRESHOLD');
      assert.strictEqual(calc.stakeAmountUsd, 0);
    });

    it('should authorize when stake is exactly or above $1.00 USD', () => {
      // Bankroll = $40.00, f* = 0.025 => raw stake = $1.00
      const calc = calculateKellyStake(0.50, 0.55, 40.0);

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.stakeAmountUsd, 1.00);
    });

    it('should respect custom minOrderSizeUsd override', () => {
      // minOrderSize = $5.00, stake = $2.50 => rejected
      const calc = calculateKellyStake(0.50, 0.55, 100.0, { minOrderSizeUsd: 5.00 });

      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_DUST_THRESHOLD');
      assert.strictEqual(calc.stakeAmountUsd, 0);
    });
  });

  describe('6. Bankroll & Input Boundary Validation', () => {
    it('should reject on zero bankroll', () => {
      const calc = calculateKellyStake(0.50, 0.60, 0);
      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_INSUFFICIENT_BANKROLL');
      assert.strictEqual(calc.stakeAmountUsd, 0);
    });

    it('should reject on negative bankroll', () => {
      const calc = calculateKellyStake(0.50, 0.60, -50.0);
      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_INSUFFICIENT_BANKROLL');
      assert.strictEqual(calc.stakeAmountUsd, 0);
    });

    it('should reject on NaN bankroll', () => {
      const calc = calculateKellyStake(0.50, 0.60, NaN);
      assert.strictEqual(calc.authorized, false);
      assert.strictEqual(calc.rejectionReason, 'REJECTED_INSUFFICIENT_BANKROLL');
    });

    it('should throw KellyRiskError on invalid marketPrice in calculateKellyStake', () => {
      assert.throws(() => calculateKellyStake(0, 0.5, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(1, 0.5, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(-0.1, 0.5, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(1.1, 0.5, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(NaN, 0.5, 100), KellyRiskError);
    });

    it('should throw KellyRiskError on invalid estimatedProb in calculateKellyStake', () => {
      assert.throws(() => calculateKellyStake(0.5, 0, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(0.5, 1, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(0.5, -0.2, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(0.5, 1.2, 100), KellyRiskError);
      assert.throws(() => calculateKellyStake(0.5, NaN, 100), KellyRiskError);
    });
  });

  describe('7. Custom Fraction Multiplier Override', () => {
    it('should support half-Kelly (0.50) multiplier when specified', () => {
      // Market: Pm = 0.50, p = 0.55, f_raw = 0.10
      // fractionMultiplier = 0.50 => f* = 0.05
      // Bankroll = $100 => stake = $5.00
      const calc = calculateKellyStake(0.50, 0.55, 100.0, { fractionMultiplier: 0.50 });

      assert.strictEqual(calc.authorized, true);
      assert.strictEqual(calc.quarterKellyFraction, 0.05);
      assert.strictEqual(calc.allocatedFraction, 0.05);
      assert.strictEqual(calc.stakeAmountUsd, 5.00);
    });
  });
});
