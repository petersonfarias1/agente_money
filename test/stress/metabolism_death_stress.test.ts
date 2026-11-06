/**
 * ==============================================================================
 * ADVERSARIAL STRESS TEST SUITE: Metabolism & Permadeath
 * ==============================================================================
 * Tests the empirical resilience, boundary correctness, and edge-case behavior of:
 * 1. `src/core/metabolism.ts` (Adaptive dynamic degradation & boundary math)
 * 2. `src/core/death.ts` (Permadeath protocol, tombstone schema, hook fault isolation)
 * 3. `src/index.ts` (HeartbeatDaemon lifecycle, zombie prevention, rapid transitions)
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
import { ApexWallet } from '../../src/core/wallet.ts';
import { loadConfig } from '../../src/config.ts';
import type { Tombstone } from '../../src/types.ts';

export class StressMockExitError extends Error {
  public exitCode: number;
  constructor(exitCode: number) {
    super(`[StressMockExit] process.exit(${exitCode}) called`);
    this.name = 'StressMockExitError';
    this.exitCode = exitCode;
  }
}

describe('Adversarial Stress Suite: Metabolism & Permadeath', () => {
  const stressTmpDir = path.resolve('./tmp_stress_tests');
  const stressTombstonePath = path.join(stressTmpDir, 'stress_tombstone.json');

  beforeEach(() => {
    clearTeardownHooks();
    resetExitHandler();
    if (!fs.existsSync(stressTmpDir)) {
      fs.mkdirSync(stressTmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearTeardownHooks();
    resetExitHandler();
    if (fs.existsSync(stressTmpDir)) {
      fs.rmSync(stressTmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. METABOLISM ENGINE ADVERSARIAL BOUNDARY & FUZZING TESTS
  // ============================================================================
  describe('1. Metabolism Engine: Extreme Boundary & Fuzzing', () => {
    it('S1.1: Extreme boundary precision around $50.00 threshold', () => {
      // Just above 50: strictly VERDE
      const above50 = evaluateTier(50.0000001);
      assert.equal(above50.tier, 'VERDE');
      assert.equal(above50.modelClass, 'advanced');
      assert.equal(above50.allowSpeculativeResearch, true);

      // Exactly 50.0000000: strictly AMARELO (Constitution Article III: $10 <= B <= $50)
      const exact50 = evaluateTier(50.0);
      assert.equal(exact50.tier, 'AMARELO');
      assert.equal(exact50.modelClass, 'economic');
      assert.equal(exact50.allowSpeculativeResearch, false);

      // Just below 50: strictly AMARELO
      const below50 = evaluateTier(49.9999999);
      assert.equal(below50.tier, 'AMARELO');
      assert.equal(below50.modelClass, 'economic');
      assert.equal(below50.allowSpeculativeResearch, false);

      // IEEE 754 precision insight: Number.EPSILON is around 1.0 (2.22e-16).
      // For 50.0, 50.0 + Number.EPSILON is identical to 50.0, evaluating to AMARELO.
      assert.equal(evaluateTier(50.0 + Number.EPSILON).tier, 'AMARELO');

      // The next representable floating-point number above 50.0 (50 + 64 * EPSILON) evaluates strictly to VERDE.
      const nextFloatAbove50 = 50.0 + (64 * Number.EPSILON);
      assert.ok(nextFloatAbove50 > 50.0);
      assert.equal(evaluateTier(nextFloatAbove50).tier, 'VERDE');
    });

    it('S1.2: Extreme boundary precision around $10.00 threshold', () => {
      // Just above 10: strictly AMARELO
      const above10 = evaluateTier(10.0000001);
      assert.equal(above10.tier, 'AMARELO');
      assert.equal(above10.modelClass, 'economic');

      // Exactly 10.0000000: strictly AMARELO ($10.00 <= B <= $50.00)
      const exact10 = evaluateTier(10.0);
      assert.equal(exact10.tier, 'AMARELO');
      assert.equal(exact10.modelClass, 'economic');

      // Just below 10: strictly LARANJA ($2.00 <= B < $10.00)
      const below10 = evaluateTier(9.9999999);
      assert.equal(below10.tier, 'LARANJA');
      assert.equal(below10.modelClass, 'survival');
      assert.notEqual(below10.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
    });

    it('S1.3: Extreme boundary precision around $2.00 critical sub-tier threshold', () => {
      // Just above 2: strictly LARANJA standard emergency
      const above2 = evaluateTier(2.0000001);
      assert.equal(above2.tier, 'LARANJA');
      assert.notEqual(above2.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      // Exactly 2.0000000: strictly LARANJA standard emergency
      const exact2 = evaluateTier(2.0);
      assert.equal(exact2.tier, 'LARANJA');
      assert.notEqual(exact2.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      // Just below 2: strictly LARANJA Critical Sub-tier ($0.00 < B < $2.00)
      const below2 = evaluateTier(1.9999999);
      assert.equal(below2.tier, 'LARANJA');
      assert.equal(below2.reason, 'CRITICAL_SURVIVAL_SUB_TIER');

      // Micro-value above 0: still critical sub-tier
      const microBalance = evaluateTier(0.0000001);
      assert.equal(microBalance.tier, 'LARANJA');
      assert.equal(microBalance.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
    });

    it('S1.4: Extreme boundary precision around $0.00 insolvency threshold', () => {
      // Exactly 0.0000000: strictly VERMELHO terminal insolvency
      const exactZero = evaluateTier(0.0);
      assert.equal(exactZero.tier, 'VERMELHO');
      assert.equal(exactZero.heartbeatIntervalMs, 0);

      // Negative zero (-0.0): strictly VERMELHO
      const negZero = evaluateTier(-0.0);
      assert.equal(negZero.tier, 'VERMELHO');
      assert.equal(negZero.heartbeatIntervalMs, 0);

      // Just below zero (-0.0000001): strictly VERMELHO
      const subZero = evaluateTier(-0.0000001);
      assert.equal(subZero.tier, 'VERMELHO');

      // Massive deficit balance (-$1,000,000.00): strictly VERMELHO
      const massiveDeficit = evaluateTier(-1000000.0);
      assert.equal(massiveDeficit.tier, 'VERMELHO');
      assert.equal(massiveDeficit.balanceUsd, -1000000.0);

      // Smallest positive non-zero JS float (Number.MIN_VALUE): strictly LARANJA critical
      const minPositive = evaluateTier(Number.MIN_VALUE);
      assert.equal(minPositive.tier, 'LARANJA');
      assert.equal(minPositive.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
    });

    it('S1.5: Strict type rejection on non-numbers and NaN', () => {
      assert.throws(() => evaluateTier(NaN), TypeError);
      assert.throws(() => evaluateTier('50.0' as any), TypeError);
      assert.throws(() => evaluateTier('0' as any), TypeError);
      assert.throws(() => evaluateTier('abc' as any), TypeError);
      assert.throws(() => evaluateTier(null as any), TypeError);
      assert.throws(() => evaluateTier(undefined as any), TypeError);
      assert.throws(() => evaluateTier(true as any), TypeError);
      assert.throws(() => evaluateTier(false as any), TypeError);
      assert.throws(() => evaluateTier({} as any), TypeError);
      assert.throws(() => evaluateTier([] as any), TypeError);
      assert.throws(() => evaluateTier(100n as any), TypeError);
    });

    it('S1.6: Boundary stress for helper functions isTerminalInsolvency and isCriticalSurvival', () => {
      // isTerminalInsolvency
      assert.equal(isTerminalInsolvency(0.0), true);
      assert.equal(isTerminalInsolvency(-0.0), true);
      assert.equal(isTerminalInsolvency(-0.0000001), true);
      assert.equal(isTerminalInsolvency(-1e12), true);
      assert.equal(isTerminalInsolvency(0.0000001), false);
      assert.equal(isTerminalInsolvency(Number.MIN_VALUE), false);
      assert.equal(isTerminalInsolvency(2.0), false);
      assert.equal(isTerminalInsolvency(50.0), false);
      assert.throws(() => isTerminalInsolvency(NaN), TypeError);
      assert.throws(() => isTerminalInsolvency('0' as any), TypeError);

      // isCriticalSurvival ($0.00 < B < $2.00)
      assert.equal(isCriticalSurvival(2.0), false);
      assert.equal(isCriticalSurvival(2.0000001), false);
      assert.equal(isCriticalSurvival(1.9999999), true);
      assert.equal(isCriticalSurvival(1.0), true);
      assert.equal(isCriticalSurvival(0.0000001), true);
      assert.equal(isCriticalSurvival(Number.MIN_VALUE), true);
      assert.equal(isCriticalSurvival(0.0), false);
      assert.equal(isCriticalSurvival(-0.0000001), false);
      assert.equal(isCriticalSurvival(-10.0), false);
      assert.throws(() => isCriticalSurvival(NaN), TypeError);
      assert.throws(() => isCriticalSurvival('1.5' as any), TypeError);
    });
  });

  // ============================================================================
  // 2. PERMADEATH PROTOCOL ADVERSARIAL STRESS & FAULT ISOLATION TESTS
  // ============================================================================
  describe('2. Permadeath Protocol: Teardown Fault Isolation & Schema Stress', () => {
    it('S2.1: Teardown Hook Fault Isolation — multiple failing hooks do not block remaining hooks', async () => {
      let exitCodeReceived: number | null = null;
      setExitHandler(((code: number) => {
        exitCodeReceived = code;
        throw new StressMockExitError(code);
      }) as ExitHandler);

      const executionLog: string[] = [];

      // Hook 1: Throws synchronous fatal error
      registerTeardownHook(() => {
        executionLog.push('hook_1_throwing_sync');
        throw new Error('Fatal synchronous crash in hook 1');
      });

      // Hook 2: Returns a rejecting Promise
      registerTeardownHook(async () => {
        executionLog.push('hook_2_throwing_async');
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('Async promise rejection in hook 2');
      });

      // Hook 3: Legitimate hook that MUST execute
      registerTeardownHook(() => {
        executionLog.push('hook_3_success_sync');
      });

      // Hook 4: Legitimate async hook that MUST execute
      registerTeardownHook(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        executionLog.push('hook_4_success_async');
      });

      // Hook 5: Final sync hook
      registerTeardownHook(() => {
        executionLog.push('hook_5_success_final');
      });

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: stressTombstonePath,
            agentAddress: '0x9999999999999999999999999999999999999999',
          }),
        StressMockExitError
      );

      // Verify exit handler received 0
      assert.equal(exitCodeReceived, 0);

      // Verify all hooks were visited, and failing hooks did not abort the chain
      assert.deepEqual(executionLog, [
        'hook_1_throwing_sync',
        'hook_2_throwing_async',
        'hook_3_success_sync',
        'hook_4_success_async',
        'hook_5_success_final',
      ]);

      // Verify tombstone.json was still written
      assert.equal(fs.existsSync(stressTombstonePath), true);
    });

    it('S2.2: Tombstone Schema Rigorous Validation — validates all 16 fields, JSON validity & deficit balance', async () => {
      setExitHandler(((code: number) => {
        throw new StressMockExitError(code);
      }) as ExitHandler);

      const birthTimestamp = Date.now() - 7200000; // 2 hours ago
      const customAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: stressTombstonePath,
            agentAddress: customAddress,
            agentName: 'Apex-Stress-Agent',
            generation: 3,
            parentId: '0x0000000000000000000000000000000000000002',
            finalBalanceUsd: -15.50, // Negative balance deficit
            peakBalanceUsd: 150.00,
            birthTimestampMs: birthTimestamp,
            totalCyclesExecuted: 120,
            reason: 'Insolvency: Terminal liquid balance deficit (-$15.50)',
            operationalSummary: {
              polymarketBetsCount: 15,
              polymarketWinRate: 0.60,
              x402RequestsServed: 25,
              bountiesCompleted: 2,
            },
            postMortemInsights: ['Exhausted capital in high-volatility event.'],
          }),
        StressMockExitError
      );

      const rawContent = fs.readFileSync(stressTombstonePath, 'utf8');
      
      // 1. JSON Parse validation
      let tombstone: Tombstone;
      assert.doesNotThrow(() => {
        tombstone = JSON.parse(rawContent);
      });

      // 2. Strict field existence & type assertions
      assert.equal(tombstone!.agentAddress, customAddress);
      assert.equal(tombstone!.agentName, 'Apex-Stress-Agent');
      assert.equal(tombstone!.generation, 3);
      assert.equal(tombstone!.parentId, '0x0000000000000000000000000000000000000002');
      assert.equal(typeof tombstone!.deathTimestamp, 'string');
      assert.ok(!Number.isNaN(Date.parse(tombstone!.deathTimestamp)));
      assert.equal(typeof tombstone!.birthTimestamp, 'string');
      assert.ok(!Number.isNaN(Date.parse(tombstone!.birthTimestamp)));
      assert.equal(tombstone!.finalBalanceUsd, -15.50);
      assert.equal(tombstone!.peakBalanceUsd, 150.00);
      assert.ok(tombstone!.totalLifespanMs >= 7200000);
      assert.equal(tombstone!.totalCyclesExecuted, 120);
      assert.equal(typeof tombstone!.totalRevenueGenerated, 'number');
      assert.equal(typeof tombstone!.totalExpensesIncurred, 'number');
      assert.ok(Array.isArray(tombstone!.finalLedgerSnapshot));
      assert.equal(typeof tombstone!.reason, 'string');
      assert.equal(tombstone!.operationalSummary.polymarketBetsCount, 15);
      assert.equal(tombstone!.operationalSummary.polymarketWinRate, 0.60);
      assert.equal(tombstone!.operationalSummary.x402RequestsServed, 25);
      assert.equal(tombstone!.operationalSummary.bountiesCompleted, 2);
      assert.deepEqual(tombstone!.postMortemInsights, ['Exhausted capital in high-volatility event.']);
    });

    it('S2.3: Database Resilience — permadeath survives pre-closed database without unhandled exceptions', async () => {
      setExitHandler(((code: number) => {
        throw new StressMockExitError(code);
      }) as ExitHandler);

      const db = new DatabaseService(':memory:');
      // Intentionally close database before executing permadeath
      db.close();
      assert.equal(db.isOpen(), false);

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: stressTombstonePath,
            database: db,
            finalBalanceUsd: 0.0,
          }),
        StressMockExitError
      );

      // Verify tombstone is created cleanly despite closed database
      assert.equal(fs.existsSync(stressTombstonePath), true);
      const tombstone = JSON.parse(fs.readFileSync(stressTombstonePath, 'utf8'));
      assert.equal(tombstone.totalRevenueGenerated, 0);
      assert.equal(tombstone.finalLedgerSnapshot.length, 0);
    });

    it('S2.4: Consecutive Permadeath Executions — cleanly isolates runs and overwrites target paths', async () => {
      setExitHandler(((code: number) => {
        throw new StressMockExitError(code);
      }) as ExitHandler);

      const path1 = path.join(stressTmpDir, 'tombstone_run1.json');
      const path2 = path.join(stressTmpDir, 'tombstone_run2.json');

      await assert.rejects(
        () => executePermadeath({ tombstonePath: path1, agentName: 'Run1' }),
        StressMockExitError
      );
      await assert.rejects(
        () => executePermadeath({ tombstonePath: path2, agentName: 'Run2' }),
        StressMockExitError
      );

      assert.equal(fs.existsSync(path1), true);
      assert.equal(fs.existsSync(path2), true);
      assert.equal(JSON.parse(fs.readFileSync(path1, 'utf8')).agentName, 'Run1');
      assert.equal(JSON.parse(fs.readFileSync(path2, 'utf8')).agentName, 'Run2');
    });
  });

  // ============================================================================
  // 3. HEARTBEAT DAEMON LIFECYCLE & ZOMBIE PROCESS PREVENTION TESTS
  // ============================================================================
  describe('3. HeartbeatDaemon Lifecycle & Zombie Prevention', () => {
    it('S3.1: Zombie Prevention — when balance reaches 0, daemon terminates timer and stops immediately', async () => {
      const config = loadConfig({
        NETWORK_MODE: 'mock',
        MOCK_WALLET_BALANCE_USD: '50.00',
      });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      let exitCalled = false;
      let exitCodeReceived: number | null = null;
      setExitHandler(((code: number) => {
        exitCalled = true;
        exitCodeReceived = code;
        throw new StressMockExitError(code);
      }) as any);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        intervalOverrideMs: 10,
      });

      // Cycle 1: balance $50.00 -> AMARELO
      const res1 = await daemon.tick();
      assert.equal(res1.success, true);
      assert.equal(res1.tier, 'AMARELO');

      // Now drop balance to 0 -> VERMELHO
      wallet.setMockBalances({ base: 0.0, polygon: 0.0 });

      // Cycle 2: should trigger permadeath and throw MockExitError
      await assert.rejects(
        () => daemon.tick(),
        StressMockExitError
      );

      assert.equal(exitCalled, true);
      assert.equal(exitCodeReceived, 0);

      // Verify zombie prevention: daemon is NOT running and timer is cleared
      const status = daemon.getStatus();
      assert.equal(status.isRunning, false);
      assert.equal(status.currentTier, 'VERMELHO');

      db.close();
    });

    it('S3.2: Negative Balance Deficit Detection in Daemon — triggers immediate permadeath', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      // 1. Verify ApexWallet strictly prohibits setting negative mock balances
      assert.throws(
        () => wallet.setMockBalances({ base: -25.0, polygon: 0.0 }),
        /Balance cannot be negative/
      );

      // 2. Verify that if a WalletClient query returns a deficit/negative balance (-$25.00),
      // the daemon immediately classifies it as VERMELHO and executes permadeath
      const deficitWallet = {
        getAddress: () => wallet.getAddress(),
        getBalance: async () => ({ baseUsdc: -25.0, polygonUsdc: 0.0 }),
        getTotalBalanceUsd: async () => -25.0,
        transfer: async () => '0xmock',
        isWhitelisted: () => true,
        addToWhitelist: () => {},
        removeFromWhitelist: () => {},
        getWhitelist: () => [],
      };

      let exitCalled = false;
      let exitCodeReceived: number | null = null;
      setExitHandler(((code: number) => {
        exitCalled = true;
        exitCodeReceived = code;
        throw new StressMockExitError(code);
      }) as any);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet: deficitWallet as any,
      });

      await assert.rejects(
        () => daemon.tick(),
        StressMockExitError
      );

      assert.equal(exitCalled, true);
      assert.equal(exitCodeReceived, 0);
      assert.equal(daemon.isRunning, false);
      assert.equal(daemon.getStatus().currentTier, 'VERMELHO');

      db.close();
    });

    it('S3.3: Rapid Multi-Tier Oscillation Fuzzing — handles cascading balance changes cleanly', async () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      const observedTiers: string[] = [];
      const balanceSequence = [
        { base: 60.0, polygon: 40.0 }, // $100.00 -> VERDE
        { base: 20.0, polygon: 15.0 }, // $35.00  -> AMARELO
        { base: 3.0, polygon: 4.0 },   // $7.00   -> LARANJA
        { base: 0.5, polygon: 0.5 },   // $1.00   -> LARANJA (Critical)
      ];

      let seqIndex = 0;
      wallet.setMockBalances(balanceSequence[0]);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        maxCycles: 4,
        intervalOverrideMs: 5,
        onTickExecuted: (res) => {
          observedTiers.push(res.tier);
          seqIndex++;
          if (seqIndex < balanceSequence.length) {
            wallet.setMockBalances(balanceSequence[seqIndex]);
          }
        },
      });

      await daemon.start();
      await new Promise((resolve) => setTimeout(resolve, 80));

      assert.equal(daemon.cycleCount, 4);
      assert.deepEqual(observedTiers, [
        'VERDE',
        'AMARELO',
        'LARANJA',
        'LARANJA',
      ]);

      // Verify all actions were logged in database
      const actions = db.getActions(10, 'heartbeat');
      assert.equal(actions.length, 4);

      db.close();
    });

    it('S3.4: Error Recovery & Idempotency — wallet failure followed by recovery maintains daemon stability', async () => {
      const config = loadConfig({
        NETWORK_MODE: 'mock',
        MOCK_WALLET_BALANCE_USD: '60.00',
      });
      const db = new DatabaseService(':memory:');
      const wallet = new ApexWallet(config);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        maxCycles: 3,
        intervalOverrideMs: 5,
      });

      // Tick 1: normal success
      const res1 = await daemon.tick();
      assert.equal(res1.success, true);
      assert.equal(res1.tier, 'VERDE');

      // Tick 2: simulated wallet RPC error
      wallet.setSimulateError(true);
      const res2 = await daemon.tick();
      assert.equal(res2.success, false);
      assert.ok(res2.error);

      // Tick 3: wallet recovers
      wallet.setSimulateError(false);
      const res3 = await daemon.tick();
      assert.equal(res3.success, true);
      assert.equal(res3.tier, 'VERDE');

      // Verify database recorded TICK_FAILED for tick 2
      const actions = db.getActions(10, 'heartbeat');
      const failedAction = actions.find((a) => a.actionType === 'TICK_FAILED');
      assert.ok(failedAction);

      db.close();
    });
  });
});
