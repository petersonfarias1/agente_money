/**
 * ==============================================================================
 * Unit Tests: Adaptive Metabolism Engine (`src/core/metabolism.ts`)
 * ==============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTier,
  isTerminalInsolvency,
  isCriticalSurvival,
} from '../../src/core/metabolism.ts';

describe('Core Metabolism Engine Unit Tests', () => {
  describe('1. Standard Partitioning & Boundaries', () => {
    it('T1.1 (Verde Nominal): should evaluate $100.00 as VERDE full capability', () => {
      const status = evaluateTier(100.0);
      assert.equal(status.tier, 'VERDE');
      assert.equal(status.modelClass, 'advanced');
      assert.equal(status.heartbeatIntervalMs, 60000);
      assert.equal(status.allowSpeculativeResearch, true);
      assert.equal(status.allowSelfModification, true);
    });

    it('T1.2 (Verde Lower Bound): should evaluate $50.01 as VERDE', () => {
      const status = evaluateTier(50.01);
      assert.equal(status.tier, 'VERDE');
      assert.equal(status.modelClass, 'advanced');
      assert.equal(status.allowSpeculativeResearch, true);
    });

    it('T1.3 (Green/Yellow Threshold): should evaluate $50.00 as AMARELO (boundary check)', () => {
      const status = evaluateTier(50.0);
      assert.equal(status.tier, 'AMARELO');
      assert.equal(status.modelClass, 'economic');
      assert.equal(status.heartbeatIntervalMs, 300000);
      assert.equal(status.allowSpeculativeResearch, false);
      assert.equal(status.allowSelfModification, false);
    });

    it('T1.4 (Amarelo Nominal): should evaluate $25.00 as AMARELO', () => {
      const status = evaluateTier(25.0);
      assert.equal(status.tier, 'AMARELO');
      assert.equal(status.modelClass, 'economic');
      assert.equal(status.heartbeatIntervalMs, 300000);
    });

    it('T1.5 (Yellow/Orange Threshold): should evaluate $10.00 as AMARELO (boundary check)', () => {
      const status = evaluateTier(10.0);
      assert.equal(status.tier, 'AMARELO');
      assert.equal(status.modelClass, 'economic');
      assert.equal(status.heartbeatIntervalMs, 300000);
    });

    it('T1.6 (Laranja Upper Bound): should evaluate $9.99 as LARANJA emergency survival', () => {
      const status = evaluateTier(9.99);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.modelClass, 'survival');
      assert.equal(status.heartbeatIntervalMs, 60000);
      assert.equal(status.allowSpeculativeResearch, false);
      assert.equal(status.allowSelfModification, false);
    });

    it('T1.7 (Laranja Nominal): should evaluate $5.00 as LARANJA', () => {
      const status = evaluateTier(5.0);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.modelClass, 'survival');
    });

    it('T1.8 (Orange Critical Boundary): should evaluate $2.00 as LARANJA standard emergency mode', () => {
      const status = evaluateTier(2.0);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.modelClass, 'survival');
      assert.notEqual(status.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
    });

    it('T1.9 (Critical Survival Sub-tier): should evaluate $1.50 as LARANJA critical sub-tier', () => {
      const status = evaluateTier(1.5);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.modelClass, 'survival');
      assert.equal(status.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
      assert.equal(status.allowSpeculativeResearch, false);
      assert.equal(status.allowSelfModification, false);
    });

    it('T1.10 (Critical Survival Sub-tier Lower Bound): should evaluate $0.01 as LARANJA critical sub-tier', () => {
      const status = evaluateTier(0.01);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
    });

    it('T1.11 (Vermelho Threshold): should evaluate $0.00 as VERMELHO terminal insolvency', () => {
      const status = evaluateTier(0.0);
      assert.equal(status.tier, 'VERMELHO');
      assert.equal(status.modelClass, 'survival');
      assert.equal(status.heartbeatIntervalMs, 0);
      assert.equal(status.allowSpeculativeResearch, false);
      assert.equal(status.allowSelfModification, false);
    });

    it('T1.12 (Negative Balance Deficit): should evaluate -$10.00 as VERMELHO terminal insolvency', () => {
      const status = evaluateTier(-10.0);
      assert.equal(status.tier, 'VERMELHO');
      assert.equal(status.heartbeatIntervalMs, 0);
    });
  });

  describe('2. Custom Options & Dynamic Overrides', () => {
    it('T1.13: should honor custom threshold and interval overrides', () => {
      const status = evaluateTier(80.0, {
        thresholds: { green: 100.0, yellow: 50.0, orange: 10.0, red: 0.0 },
        intervals: { greenMs: 30000, yellowMs: 120000, orangeMs: 45000 },
      });
      // 80 is between 50 and 100 => AMARELO
      assert.equal(status.tier, 'AMARELO');
      assert.equal(status.heartbeatIntervalMs, 120000);
    });
  });

  describe('3. Strict Input Validation', () => {
    it('T1.14: should throw TypeError on non-numeric or NaN input', () => {
      assert.throws(() => evaluateTier(NaN), TypeError);
      assert.throws(() => evaluateTier('50' as any), TypeError);
      assert.throws(() => evaluateTier(null as any), TypeError);
      assert.throws(() => evaluateTier(undefined as any), TypeError);
    });
  });

  describe('4. Helper Functions', () => {
    it('T1.15: should correctly identify terminal insolvency and critical survival', () => {
      assert.equal(isTerminalInsolvency(0.0), true);
      assert.equal(isTerminalInsolvency(-5.0), true);
      assert.equal(isTerminalInsolvency(0.01), false);
      assert.equal(isTerminalInsolvency(50.0), false);

      assert.equal(isCriticalSurvival(1.5), true);
      assert.equal(isCriticalSurvival(0.01), true);
      assert.equal(isCriticalSurvival(2.0), false);
      assert.equal(isCriticalSurvival(0.0), false);
      assert.equal(isCriticalSurvival(-1.0), false);
    });
  });
});
