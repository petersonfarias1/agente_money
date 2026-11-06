/**
 * ==============================================================================
 * EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE
 * Milestone 2 Iteration 2: Metabolism, Permadeath & Deficit Balance Verification
 * ==============================================================================
 * Independent verification test suite authored by Challenger Agent
 * to empirically challenge:
 * 1. ApexWallet deficit mocking & options overload resilience
 * 2. End-to-end HeartbeatDaemon insolvency with native ApexWallet deficit
 * 3. Extreme boundary fuzzing around floating-point & micro-USDC edges
 * 4. Concurrent / re-entrant Permadeath execution safety
 * 5. Tombstone integrity when dying from deficit
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateTier,
  isTerminalInsolvency,
  isCriticalSurvival,
} from '../../src/core/metabolism.ts';
import {
  executePermadeath,
  registerTeardownHook,
  clearTeardownHooks,
  setExitHandler,
  resetExitHandler,
  type ExitHandler,
} from '../../src/core/death.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { HeartbeatDaemon } from '../../src/index.ts';
import { ApexWallet, DEFAULT_WHITELISTED_EXCHANGES } from '../../src/core/wallet.ts';
import { loadConfig } from '../../src/config.ts';
import type { Tombstone } from '../../src/types.ts';

class ChallengerMockExitError extends Error {
  public exitCode: number;
  constructor(exitCode: number) {
    super(`[ChallengerMockExit] code=${exitCode}`);
    this.name = 'ChallengerMockExitError';
    this.exitCode = exitCode;
  }
}

describe('Challenger Empirical Verification: Metabolism & Deficit Permadeath', () => {
  const challengerTmpDir = path.resolve('./tmp_challenger_tests');
  const challengerTombstonePath = path.join(challengerTmpDir, 'challenger_tombstone.json');

  beforeEach(() => {
    clearTeardownHooks();
    resetExitHandler();
    if (!fs.existsSync(challengerTmpDir)) {
      fs.mkdirSync(challengerTmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearTeardownHooks();
    resetExitHandler();
    if (fs.existsSync(challengerTmpDir)) {
      fs.rmSync(challengerTmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Vector 1: ApexWallet Deficit Balance Mocking Resiliency
  // --------------------------------------------------------------------------
  describe('Vector 1: ApexWallet Deficit Balance Mocking API & Invariants', () => {
    it('C1.1: should enforce default non-negative balance invariant unless explicitly allowed', () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const wallet = new ApexWallet(config);

      // Default call without options throws
      assert.throws(
        () => wallet.setMockBalance('base', -10.0),
        /Balance cannot be negative/
      );
      assert.throws(
        () => wallet.setMockBalance('polygon', -0.000001),
        /Balance cannot be negative/
      );

      // Explicit allowDeficit: false throws
      assert.throws(
        () => wallet.setMockBalance('base', -5.0, false),
        /Balance cannot be negative/
      );
      assert.throws(
        () => wallet.setMockBalance('base', -5.0, { allowDeficit: false }),
        /Balance cannot be negative/
      );

      // setMockBalances without options throws
      assert.throws(
        () => wallet.setMockBalances({ base: -20.0, polygon: 10.0 }),
        /Balance cannot be negative/
      );
      assert.throws(
        () => wallet.setMockBalances({ base: 10.0, polygon: -5.0 }, { allowDeficit: false }),
        /Balance cannot be negative/
      );
    });

    it('C1.2: should allow negative balances with boolean flag or options object', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const wallet = new ApexWallet(config);

      // Boolean true flag
      wallet.setMockBalance('base', -12.345678, true);
      assert.equal(await wallet.getBaseUsdcBalance(), -12.345678);

      // Options object { allowDeficit: true }
      wallet.setMockBalance('polygon', -87.654322, { allowDeficit: true });
      assert.equal(await wallet.getPolygonUsdcBalance(), -87.654322);

      // Combined total balance (-12.345678 + -87.654322 = -100.0)
      const total = await wallet.getTotalBalanceUsd();
      assert.equal(total, -100.0);

      // Breakdown check
      const breakdown = await wallet.getBalanceBreakdown();
      assert.equal(breakdown.baseUsdc, -12.345678);
      assert.equal(breakdown.polygonUsdc, -87.654322);
      assert.equal(breakdown.totalUsd, -100.0);
    });

    it('C1.3: should support setMockDeficit on both chains and correctly format negative amounts', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const wallet = new ApexWallet(config);

      // Positive parameter converted to negative
      wallet.setMockDeficit('base', 50.25);
      assert.equal(await wallet.getBaseUsdcBalance(), -50.25);

      // Negative parameter remains negative (via -Math.abs)
      wallet.setMockDeficit('polygon', -30.75);
      assert.equal(await wallet.getPolygonUsdcBalance(), -30.75);

      const total = await wallet.getTotalBalanceUsd();
      assert.equal(total, -81.0);
    });

    it('C1.4: should reject transfers when wallet is in deficit with InsufficientBalanceError', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const wallet = new ApexWallet(config);
      wallet.setMockDeficit('base', 20.0);

      // Recipient must be authorized on Sovereign Whitelist to reach Stage 4 solvency check
      const recipient = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      assert.equal(wallet.isWhitelisted(recipient), true);

      await assert.rejects(
        () => wallet.transferUsdc('base', recipient, 1.0),
        (err: any) => {
          assert.equal(err.name, 'InsufficientBalanceError');
          assert.equal(err.chain, 'base');
          assert.equal(err.requested, 1.0);
          assert.equal(err.available, -20.0);
          return true;
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // Vector 2: End-to-End HeartbeatDaemon Insolvency with Native ApexWallet Deficit
  // --------------------------------------------------------------------------
  describe('Vector 2: End-to-End HeartbeatDaemon Insolvency with Native ApexWallet Deficit', () => {
    it('C2.1: should trigger immediate permadeath on native ApexWallet deficit balance', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      // Set native deficit using new API
      wallet.setMockDeficit('base', 33.33);
      wallet.setMockBalance('polygon', 0.0);

      let exitCalled = false;
      let exitCode: number | null = null;
      setExitHandler(((code: number) => {
        exitCalled = true;
        exitCode = code;
        throw new ChallengerMockExitError(code);
      }) as ExitHandler);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        config,
      });

      // Tick execution must throw ChallengerMockExitError
      await assert.rejects(
        () => daemon.tick(),
        ChallengerMockExitError
      );

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 0);

      // Verify zombie prevention: daemon state
      const status = daemon.getStatus();
      assert.equal(status.isRunning, false);
      assert.equal(status.currentTier, 'VERMELHO');
      assert.equal(status.lastBalanceUsd, -33.33);

      // Verify tombstone was written at default or specified path
      const defaultTombstone = path.resolve(process.cwd(), 'tombstone.json');
      assert.equal(fs.existsSync(defaultTombstone), true);
      const tombstoneData: Tombstone = JSON.parse(fs.readFileSync(defaultTombstone, 'utf8'));
      assert.equal(tombstoneData.finalBalanceUsd, -33.33);
      assert.equal(tombstoneData.reason, 'Terminal Insolvency (Constitution Article IV)');

      // Clean up generated default tombstone
      try {
        fs.unlinkSync(defaultTombstone);
      } catch {}

      db.close();
    });

    it('C2.2: should survive abrupt plunge from Verde ($100.00) directly to Deficit (-$50.00)', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      wallet.setMockBalances({ base: 50.0, polygon: 50.0 }); // $100.00 -> VERDE

      let exitCount = 0;
      setExitHandler(((code: number) => {
        exitCount++;
        throw new ChallengerMockExitError(code);
      }) as ExitHandler);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
      });

      // Cycle 1: healthy VERDE tick
      const tick1 = await daemon.tick();
      assert.equal(tick1.success, true);
      assert.equal(tick1.tier, 'VERDE');
      assert.equal(tick1.balanceUsd, 100.0);

      // Abrupt market catastrophe: plunge into -$50.00 deficit
      wallet.setMockBalances({ base: -25.0, polygon: -25.0 }, true);

      // Cycle 2: instant Permadeath
      await assert.rejects(
        () => daemon.tick(),
        ChallengerMockExitError
      );

      assert.equal(exitCount, 1);
      assert.equal(daemon.isRunning, false);
      assert.equal(daemon.getStatus().currentTier, 'VERMELHO');

      db.close();
    });
  });

  // --------------------------------------------------------------------------
  // Vector 3: Micro-USDC & Floating-Point Threshold Verification
  // --------------------------------------------------------------------------
  describe('Vector 3: Micro-USDC & Floating-Point Threshold Verification', () => {
    it('C3.1: verifies all critical threshold boundaries with micro-USDC (10^-6) precision', () => {
      // Vermelho: 0.000000 and below
      assert.equal(evaluateTier(0.0).tier, 'VERMELHO');
      assert.equal(evaluateTier(-0.000001).tier, 'VERMELHO');
      assert.equal(evaluateTier(-1000.0).tier, 'VERMELHO');

      // Critical Survival Sub-Tier: (0.0, 2.0)
      const smallestUsdc = 0.000001; // 1 micro-USDC
      const tierSmallest = evaluateTier(smallestUsdc);
      assert.equal(tierSmallest.tier, 'LARANJA');
      assert.equal(tierSmallest.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      const belowTwo = 1.999999;
      const tierBelowTwo = evaluateTier(belowTwo);
      assert.equal(tierBelowTwo.tier, 'LARANJA');
      assert.equal(tierBelowTwo.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      // Standard Emergency Survival: [2.0, 10.0)
      const exactTwo = evaluateTier(2.0);
      assert.equal(exactTwo.tier, 'LARANJA');
      assert.notEqual(exactTwo.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      const belowTen = evaluateTier(9.999999);
      assert.equal(belowTen.tier, 'LARANJA');
      assert.notEqual(belowTen.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      // Economic Conservation: [10.0, 50.0]
      const exactTen = evaluateTier(10.0);
      assert.equal(exactTen.tier, 'AMARELO');

      const exactFifty = evaluateTier(50.0);
      assert.equal(exactFifty.tier, 'AMARELO');

      // Full Capability: > 50.0
      const aboveFifty = evaluateTier(50.000001);
      assert.equal(aboveFifty.tier, 'VERDE');
    });
  });

  // --------------------------------------------------------------------------
  // Vector 4: Concurrent Permadeath Execution & Teardown Hook Robustness
  // --------------------------------------------------------------------------
  describe('Vector 4: Concurrent Permadeath Execution & Teardown Hook Robustness', () => {
    it('C4.1: should handle concurrent executePermadeath invocations without unhandled rejections', async () => {
      let exitCalls = 0;
      setExitHandler(((code: number) => {
        exitCalls++;
        throw new ChallengerMockExitError(code);
      }) as ExitHandler);

      const hookOrder: number[] = [];
      registerTeardownHook(async () => {
        await new Promise((res) => setTimeout(res, 5));
        hookOrder.push(1);
      });
      registerTeardownHook(async () => {
        hookOrder.push(2);
      });

      const p1 = executePermadeath({
        tombstonePath: path.join(challengerTmpDir, 'tomb_conc_1.json'),
        finalBalanceUsd: -5.0,
      });
      const p2 = executePermadeath({
        tombstonePath: path.join(challengerTmpDir, 'tomb_conc_2.json'),
        finalBalanceUsd: -10.0,
      });

      const results = await Promise.allSettled([p1, p2]);
      assert.equal(results.length, 2);
      assert.ok(results.every((r) => r.status === 'rejected'));
      assert.ok(exitCalls >= 1);
    });
  });
});
