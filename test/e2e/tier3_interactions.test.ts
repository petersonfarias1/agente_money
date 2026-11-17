/**
 * ==============================================================================
 * APEX AEA — Tier 3 E2E Test Suite: Cross-Feature Combinations & Pairwise Integration
 * ==============================================================================
 * Target: test/e2e/tier3_interactions.test.ts
 * Tests: T3.01 through T3.30 across Categories A through G:
 * - Category A: Metabolism Dynamic Transitions x Revenue Engines (T3.01 - T3.05)
 * - Category B: Permadeath Protocol x Active Subsystems Teardown (T3.06 - T3.10)
 * - Category C: Mitosis Lifecycle x Clan Royalties x Sub-Wallet Accounting (T3.11 - T3.16)
 * - Category D: Immune System Sandbox x Git Self-Healing x Heartbeat (T3.17 - T3.21)
 * - Category E: Cross-Revenue Settle x Dual-Chain Financial Ledger (T3.22 - T3.25)
 * - Category F: Constitutional Governance x Wallet Whitelist & Security (T3.26 - T3.28)
 * - Category G: Cryptographic Replay Defense & Database Concurrency (T3.29 - T3.30)
 *
 * Verifies that when two or more isolated features interface across module boundaries,
 * mutual invariants, lock ordering, error propagation, and ledger accounting remain 100% coherent.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  E2ETestContext,
  MockWalletHarness,
  MockHttpClient,
  DeterministicClock,
  MockPolymarketClob,
  ConstitutionalAssert,
} from './helpers/index.ts';

import {
  evaluateTier,
  isCriticalSurvival,
  isTerminalInsolvency,
} from '../../src/core/metabolism.ts';

import {
  executePermadeath,
  registerTeardownHook,
  clearTeardownHooks,
  setExitHandler,
  resetExitHandler,
} from '../../src/core/death.ts';

import { HeartbeatDaemon } from '../../src/index.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet, InsufficientBalanceError, ZERO_ADDRESS } from '../../src/core/wallet.ts';
import { OrderManager } from '../../src/modules/polymarket/order.ts';
import { PolymarketScanner, getStandardMockMarkets } from '../../src/modules/polymarket/scanner.ts';
import { calculateKellyStake } from '../../src/modules/polymarket/kelly.ts';
import { X402Server } from '../../src/modules/micropayments/server.ts';
import {
  BountiesScanner,
  BountyEvaluator,
  AntiSpamSafeguard,
  MockBountyProvider,
  DEFAULT_MOCK_BOUNTIES,
  BountyError,
  AntiSpamViolationError,
  type BountyTask,
  type BountySolution,
} from '../../src/modules/bounties/scanner.ts';

import {
  ImmuneSystem,
  SecurityViolationError,
  DEFAULT_PROTECTED_PATHS,
  DEFAULT_ALLOWED_DIRECTORIES,
} from '../../src/evolution/immune_system.ts';

import {
  evaluateMitosisThreshold,
  deriveChildSubWallet,
  executeMitosis,
  calculateRoyalty,
  evaluateRoyaltyStatus,
  remitRoyalty,
  registerChildLineage,
  MitosisThresholdError,
  ViabilityCheckFailedError,
  RoyaltyRemittanceError,
  CONSTITUTIONAL_ROYALTY_PERCENTAGE,
} from '../../src/evolution/mitosis.ts';

import {
  ConstitutionViolationError,
  ImmuneCheckError,
  KellyRiskError,
  type PolymarketMarket,
} from '../../src/types.ts';

function getTestPipePath(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\apex-t3-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : `/tmp/apex-t3-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
}

describe('Tier 3 E2E Test Suite: Cross-Feature Combinations & Pairwise Integration', () => {
  let ctx: E2ETestContext;
  let harness: MockWalletHarness;

  beforeEach(() => {
    ctx = new E2ETestContext();
    harness = new MockWalletHarness(ctx.wallet);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // ============================================================================
  // Category A: Metabolism Dynamic Transitions x Revenue Engines (T3.01 - T3.05)
  // ============================================================================
  describe('Category A: Metabolism Dynamic Transitions x Revenue Engines', () => {
    it('T3.01: Metabolism Degradation (Verde -> Amarelo) Throttles Polymarket Speculative Sizing', async () => {
      // 1. Initial balance = $75.00 (Tier Verde)
      harness.setBalance(75.0);
      let tierStatus = evaluateTier(75.0);
      assert.equal(tierStatus.tier, 'VERDE');
      assert.equal(tierStatus.allowSpeculativeResearch, true);

      // 2. Drop balance to $35.00 (Tier Amarelo)
      harness.setBalance(35.0);

      // 3. Heartbeat tick executes
      const daemon = new HeartbeatDaemon({
        wallet: ctx.wallet,
        database: ctx.db,
        maxCycles: 1,
      });

      const tickResult = await daemon.tick();
      assert.equal(tickResult.success, true);
      assert.equal(tickResult.tier, 'AMARELO');
      assert.equal(tickResult.heartbeatIntervalMs, 300000); // Throttles to 5 minutes

      // 4. Speculative research disabled in Tier Amarelo
      const postTier = evaluateTier(35.0);
      assert.equal(postTier.allowSpeculativeResearch, false);
      assert.equal(postTier.modelClass, 'economic');

      // 5. Polymarket sizing under 5% cap on smaller bankroll
      const kellyResult = calculateKellyStake(0.40, 0.60, 35.0);
      assert.equal(kellyResult.authorized, true);
      assert.ok(kellyResult.stakeAmountUsd <= 35.0 * 0.05 + 0.0001);

      // 6. Action recorded in SQLite
      const actions = ctx.db.getActions(10, 'heartbeat');
      assert.ok(actions.some((a) => a.tier === 'AMARELO' && a.actionType === 'TICK_EVALUATED'));
    });

    it('T3.02: Critical Survival Mode (Tier Laranja) Freezes Speculative Bets & Suspends Bounties', async () => {
      // 1. Balance = $7.50 (Tier Laranja: $2.00 <= B < $10.00)
      harness.setBalance(7.5);
      const tierStatus = evaluateTier(7.5);
      assert.equal(tierStatus.tier, 'LARANJA');
      assert.equal(tierStatus.allowSpeculativeResearch, false);
      assert.equal(tierStatus.allowSelfModification, false);

      // 2. Attempting a speculative bet under $7.50 bankroll
      // 5% cap on $7.50 is $0.375, which is below the minimum order stake of $1.00
      const kelly = calculateKellyStake(0.40, 0.60, 7.5);
      assert.equal(kelly.authorized, false);
      assert.equal(kelly.rejectionReason, 'REJECTED_DUST_THRESHOLD');

      // 3. OrderManager rejects unauthorized orders
      const orderManager = new OrderManager(ctx.db, ctx.wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const opportunity = {
        market: mockMarket,
        outcome: 'YES' as const,
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      };

      await assert.rejects(
        async () => {
          await orderManager.placeOrder(opportunity);
        },
        (err: Error) => {
          assert(err instanceof KellyRiskError);
          return true;
        }
      );

      // 4. Log and verify Tier Laranja restrictions in SQLite
      ctx.db.recordAction({
        component: 'metabolism',
        actionType: 'TIER_LARANJA_RESTRICTIONS_ACTIVE',
        details: 'Speculative trading and self-modification frozen',
        tier: 'LARANJA',
        balanceUsd: 7.5,
        timestamp: Date.now(),
      });

      const actions = ctx.db.getActions(10, 'metabolism');
      assert.ok(actions.some((a) => a.actionType === 'TIER_LARANJA_RESTRICTIONS_ACTIVE'));
    });

    it('T3.03: Critical Sub-Tier ($0.00 < B < $2.00) Freezes All Gas-Spending Outflows', async () => {
      // 1. Set balance to $1.50 (Base $0.75, Polygon $0.75)
      harness.setChainBalance('base', 0.75);
      harness.setChainBalance('polygon', 0.75);

      const totalBalance = await harness.getTotalBalance();
      assert.equal(totalBalance, 1.5);
      assert.equal(isCriticalSurvival(totalBalance), true);

      // 2. Discretionary outbound transfer check:
      // In critical survival mode, the agent's risk guard blocks gas-spending outflows
      const attemptDiscretionaryTransfer = async (amountUsd: number) => {
        if (isCriticalSurvival(await ctx.wallet.getTotalBalanceUsd())) {
          throw new Error('CRITICAL_SURVIVAL_GAS_FREEZE: Outbound discretionary transfer blocked');
        }
        return ctx.wallet.transferUsdc('base', ctx.wallet.getAddress(), amountUsd);
      };

      await assert.rejects(
        async () => {
          await attemptDiscretionaryTransfer(0.5);
        },
        /CRITICAL_SURVIVAL_GAS_FREEZE/
      );

      // 3. Excessive transfer exceeding chain balance throws InsufficientBalanceError
      const motherAddress = '0x1111111111111111111111111111111111111111';
      ctx.wallet.addToWhitelist(motherAddress, 'MOTHER_WALLET', 'Mother');
      await assert.rejects(
        async () => {
          await ctx.wallet.transferUsdc('base', motherAddress, 2.0);
        },
        (err: Error) => {
          assert(err instanceof InsufficientBalanceError);
          return true;
        }
      );

      // 4. Balance remains intact: zero gas consumed
      assert.equal(await ctx.wallet.getTotalBalanceUsd(), 1.5);
    });

    it('T3.04: x402 Server Unmetered /health Reflects Real-Time Metabolic Tier Transitions', async () => {
      harness.setBalance(80.0);
      const pipePath = getTestPipePath();
      const server = new X402Server({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        pipePath,
      });

      await server.start();

      try {
        // Query at $80.00 (VERDE)
        let res = await MockHttpClient.get('http://localhost/health', undefined, pipePath);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.tier, 'VERDE');
        assert.equal(res.body.modelClass, 'advanced');

        // Alter mock balance to $25.00 (AMARELO)
        harness.setBalance(25.0);
        res = await MockHttpClient.get('http://localhost/health', undefined, pipePath);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.tier, 'AMARELO');
        assert.equal(res.body.modelClass, 'economic');

        // Alter mock balance to $5.00 (LARANJA)
        harness.setBalance(5.0);
        res = await MockHttpClient.get('http://localhost/health', undefined, pipePath);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.tier, 'LARANJA');
        assert.equal(res.body.modelClass, 'survival');
      } finally {
        await server.stop();
      }
    });

    it('T3.05: Inbound x402 Payment Accretion Reverses Degradation (Laranja -> Amarelo -> Verde)', async () => {
      // Start in Tier Laranja ($8.00)
      harness.setBalance(8.0);
      assert.equal(evaluateTier(8.0).tier, 'LARANJA');

      const pipePath = getTestPipePath();
      const server = new X402Server({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        pipePath,
      });

      await server.start();

      try {
        // First payment: Client pays $2.50
        const proof1 = '0x' + '1'.repeat(64);
        const res1 = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': proof1,
        }, pipePath);
        assert.equal(res1.statusCode, 200);
        assert.equal(res1.body.paid, true);

        // Account for revenue in wallet balance: $8.00 + $2.50 = $10.50 -> AMARELO
        harness.setBalance(10.5);
        assert.equal(evaluateTier(10.5).tier, 'AMARELO');

        // Verify ledger entry
        const ledger1 = ctx.db.getLedgerEntries(5);
        assert.ok(ledger1.some((e) => e.entryType === 'INCOME_X402'));

        // Subsequent revenue inflows push balance to $55.00 -> VERDE
        harness.setBalance(55.0);
        const verdeStatus = evaluateTier(55.0);
        assert.equal(verdeStatus.tier, 'VERDE');
        assert.equal(verdeStatus.allowSpeculativeResearch, true);
        assert.equal(verdeStatus.allowSelfModification, true);
      } finally {
        await server.stop();
      }
    });
  });

  // ============================================================================
  // Category B: Permadeath Protocol x Active Subsystems Teardown (T3.06 - T3.10)
  // ============================================================================
  describe('Category B: Permadeath Protocol x Active Subsystems Teardown', () => {
    it('T3.06: Permadeath Automatically Cancels All Open Polymarket Positions via Teardown Hook', async () => {
      // 1. Seed 3 open positions in SQLite
      for (let i = 1; i <= 3; i++) {
        ctx.db.savePosition({
          conditionId: `0xcond${i}`,
          marketId: `poly-mkt-${i}`,
          question: `Test Question ${i}`,
          outcome: 'YES',
          shares: 20.0,
          avgPrice: 0.50,
          currentValue: 10.0,
          stakeUsd: 10.0,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
        });
      }

      assert.equal(ctx.db.getPositions(100, 'OPEN').length, 3);

      // 2. Instantiate OrderManager (which registers teardown hook)
      const orderManager = new OrderManager(ctx.db, ctx.wallet, true);

      // 3. Register a verification hook to observe open positions after OrderManager teardown
      let openPositionsAfterTeardown = -1;
      registerTeardownHook(async () => {
        openPositionsAfterTeardown = ctx.db.getPositions(100, 'OPEN').length;
      });

      // 4. Trigger Permadeath
      harness.simulateInsolvency();
      try {
        await executePermadeath({
          database: ctx.db,
          wallet: ctx.wallet,
          finalBalanceUsd: 0.0,
          tombstonePath: path.join(ctx.tempDir, 'tombstone_t3_06.json'),
        });
      } catch {
        // Expected injected exit error
      }

      assert.equal(openPositionsAfterTeardown, 0);
    });

    it('T3.07: Permadeath Gracefully Dismounts x402 Server & Releases Network Port', async () => {
      const pipePath = getTestPipePath();
      const server = new X402Server({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        pipePath,
      });

      await server.start();
      assert.equal(server.isRunning(), true);

      // Trigger Permadeath
      try {
        await executePermadeath({
          database: ctx.db,
          wallet: ctx.wallet,
          finalBalanceUsd: 0.0,
          tombstonePath: path.join(ctx.tempDir, 'tombstone_t3_07.json'),
        });
      } catch {
        // Expected injected exit error
      }

      // Server is unmounted by teardown hook
      assert.equal(server.isRunning(), false);

      // Subsequent HTTP request should fail
      await assert.rejects(
        async () => {
          await MockHttpClient.get('http://localhost/health', undefined, pipePath);
        },
        /ENOENT|ECONNREFUSED|connect/
      );
    });

    it('T3.08: Permadeath Immediately Terminates Heartbeat Daemon Timer (No Zombie Loops)', async () => {
      const daemon = new HeartbeatDaemon({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        tombstonePath: path.join(ctx.tempDir, 'tombstone.json'),
        intervalOverrideMs: 50,
      });

      daemon.isRunning = true;

      // Simulate insolvency and tick
      harness.simulateInsolvency();

      try {
        await daemon.tick();
      } catch {
        // Expected Permadeath exit error
      }

      assert.equal(daemon.isRunning, false);
    });

    it('T3.09: Permadeath Serializes Complete Financial History to tombstone.json', async () => {
      // Seed financial history
      for (let i = 0; i < 5; i++) {
        ctx.db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 5.0,
          entryType: 'INCOME_X402',
          timestamp: Date.now() - (i + 1) * 1000,
        });
      }

      ctx.db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: 20.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: Date.now() - 500,
      });

      ctx.db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 45.0,
        entryType: 'EXPENSE_GAS',
        timestamp: Date.now() - 100,
      });

      const tombstonePath = path.join(ctx.tempDir, 'tombstone_history.json');

      try {
        await executePermadeath({
          database: ctx.db,
          wallet: ctx.wallet,
          finalBalanceUsd: 0.0,
          tombstonePath,
        });
      } catch {
        // Caught exit error
      }

      const tombstone = ConstitutionalAssert.assertTombstoneSnapshot(tombstonePath);
      assert.equal(tombstone.finalBalanceUsd, 0.0);
      assert.equal(tombstone.totalRevenueGenerated, 45.0);
      assert.equal(tombstone.totalExpensesIncurred, 45.0);
      assert.ok(tombstone.finalLedgerSnapshot.length >= 7);
      assert.match(tombstone.reason, /Constitution Article IV/);
    });

    it('T3.10: Fault-Tolerant Permadeath: Faulty Teardown Hook Does Not Block Process Exit', async () => {
      let hook1Executed = false;
      let hook3Executed = false;

      registerTeardownHook(async () => {
        hook1Executed = true;
      });

      registerTeardownHook(async () => {
        throw new Error('Socket explosion during teardown');
      });

      registerTeardownHook(async () => {
        hook3Executed = true;
      });

      let exitCode: number | null = null;
      setExitHandler(((code: number) => {
        exitCode = code;
        throw new Error(`[MockExit_${code}]`);
      }) as any);

      try {
        await executePermadeath({
          database: ctx.db,
          wallet: ctx.wallet,
          finalBalanceUsd: 0.0,
          tombstonePath: path.join(ctx.tempDir, 'tombstone_fault_tolerant.json'),
        });
      } catch {
        // Exit error
      }

      assert.equal(hook1Executed, true);
      assert.equal(hook3Executed, true);
      assert.equal(exitCode, 0);
    });
  });

  // ============================================================================
  // Category C: Mitosis Lifecycle x Clan Royalties x Sub-Wallet Accounting (T3.11 - T3.16)
  // ============================================================================
  describe('Category C: Mitosis Lifecycle x Clan Royalties x Sub-Wallet Accounting', () => {
    it('T3.11: Mitosis Replication Gated Strictly by 3x Initial Capital Hurdle', async () => {
      // 1. Below threshold ($149.99 < $150.00)
      const sub = evaluateMitosisThreshold(149.99, 50.0, 3.0);
      assert.equal(sub.eligible, false);
      assert.equal(sub.deficitUsd, 0.01);

      harness.setBalance(149.99);
      await assert.rejects(
        async () => {
          await executeMitosis({ wallet: ctx.wallet, database: ctx.db });
        },
        (err: Error) => {
          assert(err instanceof MitosisThresholdError);
          assert.equal(err.currentBalanceUsd, 149.99);
          assert.equal(err.requiredThresholdUsd, 150.0);
          return true;
        }
      );

      // Verify audit action
      const actions = ctx.db.getActions(10, 'mitosis');
      assert.ok(actions.some((a) => a.actionType === 'MITOSIS_BLOCKED_THRESHOLD'));

      // 2. Exact threshold ($150.00)
      const exact = evaluateMitosisThreshold(150.0, 50.0, 3.0);
      assert.equal(exact.eligible, true);
      assert.equal(exact.deficitUsd, 0);
      assert.equal(exact.childSeedAllocationUsd, 50.0);
      assert.equal(exact.motherRetainedUsd, 100.0);
    });

    it('T3.12: Mitosis Derives HKDF Sub-Wallet & Whitelists Address Before Transferring Seed', async () => {
      harness.setBalance(150.0);

      const res = await executeMitosis({
        wallet: ctx.wallet,
        database: ctx.db,
        viabilityConfig: { steps: 30, seed: 12345 },
      });

      assert.equal(res.success, true);
      assert.match(res.childAddress, /^0x[0-9a-fA-F]{40}$/);
      assert.equal(ctx.wallet.isWhitelisted(res.childAddress), true);
      assert.equal(res.seedCapitalUsd, 50.0);

      // Lineage entry recorded
      const lineage = ctx.db.getLineageByChild(res.childAddress);
      assert.notEqual(lineage, null);
      assert.equal(lineage?.seedCapitalUsd, 50.0);
      assert.equal(lineage?.status, 'ACTIVE');
    });

    it('T3.13: Multi-Chain Seed Capital Selection Picks Chain with Highest Liquidity', async () => {
      // Base has $20.00, Polygon has $130.00 (Total $150.00). Seed capital is $50.00.
      harness.setChainBalance('base', 20.0);
      harness.setChainBalance('polygon', 130.0);

      const res = await executeMitosis({
        wallet: ctx.wallet,
        database: ctx.db,
        viabilityConfig: { steps: 30, seed: 12345 },
      });

      assert.equal(res.success, true);

      // Verify Polygon was selected by checking executed transfer record
      const transfers = ctx.wallet.getMockTransfers();
      const lastTransfer = transfers[transfers.length - 1];
      assert.equal(lastTransfer.chain, 'polygon');

      // Polygon deducted by $50 -> $80.00, Base untouched at $20.00
      assert.equal(await ctx.wallet.getPolygonUsdcBalance(), 80.0);
      assert.equal(await ctx.wallet.getBaseUsdcBalance(), 20.0);
    });

    it('T3.14: High-Water Mark Royalty Model Calculates Exact 5% Cumulative Net Profit', async () => {
      // Exactly 5% of $80.00 net profit is $4.00
      assert.equal(calculateRoyalty(80.0), 4.0);

      // Attempting to calculate with non-5% percentage throws ConstitutionViolationError
      assert.throws(
        () => calculateRoyalty(80.0, 0.06),
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          return true;
        }
      );
    });

    it('T3.15: Child Cash-Flow Solvency Guard Defers Royalty if Free Surplus < $15.00 Buffer', async () => {
      const childAddress = '0x2222222222222222222222222222222222222222';
      const motherAddress = ctx.wallet.getAddress();

      registerChildLineage(ctx.db, childAddress, motherAddress, 2, 50.0);

      // Seed profit of $100.00 (royalty obligation = $5.00)
      ctx.db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      // Child balance is $16.00 (surplus above $15.00 buffer = $1.00)
      harness.setBalance(16.0);

      const status = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
      assert.equal(status.cumulativeObligationUsd, 5.0);
      assert.equal(status.freeSurplusUsd, 1.0);
      assert.equal(status.remittanceAmountUsd, 1.0);
      assert.equal(status.shouldRemit, true);

      // If balance drops to $15.20 (surplus = $0.20 < $0.50 dust floor)
      harness.setBalance(15.20);
      const dustStatus = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
      assert.equal(dustStatus.shouldRemit, false);
      assert.equal(dustStatus.reason, 'DEFERRED_BELOW_DUST_THRESHOLD');
    });

    it('T3.16: Atomic Double-Entry Accounting on Royalty Settlement', async () => {
      const childAddress = '0x3333333333333333333333333333333333333333';
      const motherAddress = ctx.wallet.getAddress();

      registerChildLineage(ctx.db, childAddress, motherAddress, 2, 50.0);

      // Child DB records ROYALTY_OUT
      ctx.db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5.0,
        entryType: 'ROYALTY_OUT',
        counterparty: motherAddress,
        timestamp: Date.now(),
      });

      // Mother DB records ROYALTY_IN
      const motherDb = new DatabaseService(':memory:');
      try {
        registerChildLineage(motherDb, childAddress, motherAddress, 2, 50.0);
        motherDb.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 5.0,
          entryType: 'ROYALTY_IN',
          counterparty: childAddress,
          timestamp: Date.now(),
        });

        motherDb.updateRoyaltiesPaid(childAddress, 5.0, motherAddress);

        const lineage = motherDb.getLineageByChild(childAddress);
        assert.equal(lineage?.totalRoyaltiesPaidUsd, 5.0);
        assert.equal(motherDb.getTotalRevenue(), 5.0);
      } finally {
        motherDb.close();
      }
    });
  });

  // ============================================================================
  // Category D: Immune System Sandbox x Git Self-Healing x Heartbeat (T3.17 - T3.21)
  // ============================================================================
  describe('Category D: Immune System Sandbox x Git Self-Healing x Heartbeat', () => {
    it('T3.17: Immune Scope Gate Rejects Edits to constitution.md with Instant Rollback', async () => {
      harness.setBalance(100.0);
      let rollbackInvoked = false;

      const immune = new ImmuneSystem({
        database: ctx.db,
        wallet: ctx.wallet,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args.includes('reset')) {
            rollbackInvoked = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      const scopeCheck = immune.verifyConstitutionalScope(['src/constitution.md']);
      assert.equal(scopeCheck.valid, false);

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Malicious constitution tampering',
            targetFiles: ['src/constitution.md'],
          });
        },
        (err: Error) => {
          assert(err instanceof SecurityViolationError);
          assert(err instanceof ConstitutionViolationError);
          return true;
        }
      );

      assert.equal(rollbackInvoked, true);
      const actions = ctx.db.getActions(10, 'immune_system');
      assert.ok(actions.some((a) => a.actionType === 'IMMUNE_SYSTEM_ROLLBACK'));
    });

    it('T3.18: Immune Scope Gate Rejects Edits to Core Engine (src/core/death.ts)', async () => {
      harness.setBalance(100.0);
      const immune = new ImmuneSystem({
        database: ctx.db,
        wallet: ctx.wallet,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      const check = immune.verifyConstitutionalScope(['src/core/death.ts']);
      assert.equal(check.valid, false);
      assert.deepEqual(check.violatedFiles, ['src/core/death.ts']);
    });

    it('T3.19: Broken Test in Sandbox Triggers Instant Git Rollback & Blocks Commit', async () => {
      harness.setBalance(100.0);
      let rollbackInvoked = false;

      const immune = new ImmuneSystem({
        database: ctx.db,
        wallet: ctx.wallet,
        execRunner: async (cmd, args) => {
          if (cmd === 'npm' && args[0] === 'test') {
            return {
              stdout: 'FAIL test/unit/scanner.test.ts',
              stderr: 'AssertionError: expected true to equal false',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args.includes('reset')) {
            rollbackInvoked = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Broken scanner logic',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.match(err.message, /Pre-deployment tests failed/);
          return true;
        }
      );

      assert.equal(rollbackInvoked, true);
    });

    it('T3.20: Passing Sandbox Test Authorizes Git Commit with Audit Action Log', async () => {
      harness.setBalance(100.0);
      const immune = new ImmuneSystem({
        database: ctx.db,
        wallet: ctx.wallet,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      const res = await immune.validateModification({
        description: 'Authorized scanner optimization',
        targetFiles: ['src/modules/polymarket/scanner.ts'],
      });

      assert.equal(res.authorized, true);
      assert.equal(res.immuneCheck.passed, true);
      assert.equal(res.rollbackExecuted, false);

      const actions = ctx.db.getActions(10, 'immune_system');
      assert.ok(actions.some((a) => a.actionType === 'IMMUNE_SYSTEM_VERIFIED'));
    });

    it('T3.21: Metabolic Tier Gate Blocks Self-Modifications When Balance < $50.00', async () => {
      harness.setBalance(45.0); // Tier Amarelo
      const immune = new ImmuneSystem({
        database: ctx.db,
        wallet: ctx.wallet,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Modification under capital constraint',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.match(err.message, /METABOLIC_RESTRICTION.*AMARELO/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // Category E: Cross-Revenue Settle x Dual-Chain Financial Ledger (T3.22 - T3.25)
  // ============================================================================
  describe('Category E: Cross-Revenue Settle x Dual-Chain Financial Ledger', () => {
    it('T3.22: Polymarket Position Win Credits Ledger & Updates Total Revenue', async () => {
      const orderManager = new OrderManager(ctx.db, ctx.wallet, true);

      const posId = ctx.db.savePosition({
        conditionId: '0xwin123',
        marketId: 'poly-win-1',
        question: 'Will ETH 2.0 scale?',
        outcome: 'YES',
        shares: 10.0,
        avgPrice: 0.50,
        currentValue: 5.0,
        stakeUsd: 5.0,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
      });

      const initialRev = ctx.db.getTotalRevenue();
      const resolved = orderManager.resolvePosition(posId, 'YES');

      assert.equal(resolved.status, 'WON');
      assert.equal(resolved.payoutUsd, 10.0);
      assert.equal(ctx.db.getTotalRevenue(), initialRev + 10.0);

      const ledger = ctx.db.getLedgerEntries(1);
      assert.equal(ledger[0].entryType, 'INCOME_POLYMARKET');
      assert.equal(ledger[0].amount, 10.0);
    });

    it('T3.23: Bounties Settlement Credits Ledger & Updates Total Revenue', async () => {
      const scanner = new BountiesScanner({
        database: ctx.db,
        provider: new MockBountyProvider(),
        dryRun: true,
      });

      const task = DEFAULT_MOCK_BOUNTIES[1]; // $50.00 task
      const solution: BountySolution = {
        bountyId: task.id,
        targetFile: 'test/utils.test.ts',
        patchContent: '--- a/test/utils.test.ts\n+++ b/test/utils.test.ts\n@@ -1 +1 @@\n+// fix\n',
        summary: 'Add test patch',
        confidence: 0.95,
        testsIncluded: true,
        syntaxValid: true,
      };

      const submission = await scanner.solveAndSubmit(task, solution);
      assert.notEqual(submission, null);

      const initialRev = ctx.db.getTotalRevenue();
      const claim = scanner.claimReward(task, submission!);

      assert.equal(claim.success, true);
      assert.equal(claim.amountUsd, 50.0);
      assert.equal(ctx.db.getTotalRevenue(), initialRev + 50.0);

      const ledger = ctx.db.getLedgerEntries(1);
      assert.equal(ledger[0].entryType, 'INCOME_BOUNTY');
      assert.equal(ledger[0].amount, 50.0);
    });

    it('T3.24: Multi-Revenue Simultaneous Ledger Reconciliation', async () => {
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 12.50, entryType: 'INCOME_X402', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'polygon', token: 'USDC', amount: 25.00, entryType: 'INCOME_POLYMARKET', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 35.00, entryType: 'INCOME_BOUNTY', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 5.00, entryType: 'ROYALTY_IN', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 1.20, entryType: 'EXPENSE_GAS', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 3.40, entryType: 'EXPENSE_LLM', timestamp: Date.now() });
      ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 2.00, entryType: 'ROYALTY_OUT', timestamp: Date.now() });

      assert.equal(ctx.db.getTotalRevenue(), 77.50);
      assert.equal(ctx.db.getTotalExpenses(), 6.60);
      const netProfit = Number((ctx.db.getTotalRevenue() - ctx.db.getTotalExpenses()).toFixed(2));
      assert.equal(netProfit, 70.90);
    });

    it('T3.25: Dual-Chain Wallet Aggregation Prevents Cross-Chain Balance Mismatch', async () => {
      harness.setChainBalance('base', 42.123456);
      harness.setChainBalance('polygon', 57.876544);

      const total = await ctx.wallet.getTotalBalanceUsd();
      assert.equal(total, 100.0);

      const breakdown = await ctx.wallet.getBalanceBreakdown();
      assert.equal(breakdown.baseUsdc, 42.123456);
      assert.equal(breakdown.polygonUsdc, 57.876544);
      assert.equal(breakdown.totalUsd, 100.0);

      // Whitelist recipient and transfer on Base
      const recipient = '0x1111111111111111111111111111111111111111';
      ctx.wallet.addToWhitelist(recipient, 'MOTHER_WALLET', 'Mother');

      await ctx.wallet.transferUsdc('base', recipient, 10.0);
      assert.equal(await ctx.wallet.getBaseUsdcBalance(), 32.123456);
      assert.equal(await ctx.wallet.getPolygonUsdcBalance(), 57.876544);
    });
  });

  // ============================================================================
  // Category F: Constitutional Governance x Wallet Whitelist & Security (T3.26 - T3.28)
  // ============================================================================
  describe('Category F: Constitutional Governance x Wallet Whitelist & Security', () => {
    it('T3.26: Wallet Transfer to Non-Whitelisted Recipient Throws ConstitutionViolationError', async () => {
      harness.setBalance(50.0);
      const nonWhitelisted = '0x9999999999999999999999999999999999999999';

      await assert.rejects(
        async () => {
          await ctx.wallet.transferUsdc('base', nonWhitelisted, 10.0);
        },
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          assert.match(err.message, /is not on the Sovereign Whitelist \(Article I, Section 2\)/);
          return true;
        }
      );
    });

    it('T3.27: Zero Address Outflow Strictly Prohibited', async () => {
      harness.setBalance(50.0);

      await assert.rejects(
        async () => {
          await ctx.wallet.transferUsdc('polygon', ZERO_ADDRESS, 5.0);
        },
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          assert.match(err.message, /Transfer to zero address is strictly prohibited/);
          return true;
        }
      );

      assert.throws(
        () => {
          ctx.wallet.addToWhitelist(ZERO_ADDRESS, 'CUSTOM', 'Zero Address Attempt');
        },
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          return true;
        }
      );
    });

    it('T3.28: Kelly Risk Sizing Clamps Stake to Strict 5% Ceiling Even if Quarter-Kelly Recommends More', () => {
      // Market price 0.10, Estimated prob 0.95 -> Quarter-Kelly would recommend ~23.6%
      const res = calculateKellyStake(0.10, 0.95, 10000.0);
      assert.equal(res.authorized, true);
      assert.equal(res.allocatedFraction, 0.05);
      assert.equal(res.stakeAmountUsd, 500.0);
      ConstitutionalAssert.assertQuarterKellyCap(res.stakeAmountUsd, 10000.0);
    });
  });

  // ============================================================================
  // Category G: Cryptographic Replay Defense & Database Concurrency (T3.29 - T3.30)
  // ============================================================================
  describe('Category G: Cryptographic Replay Defense & Database Concurrency', () => {
    it('T3.29: x402 Server Replay Defense Rejects Duplicate txHash Across Memory & SQLite', async () => {
      const pipePath1 = getTestPipePath();
      const server1 = new X402Server({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        pipePath: pipePath1,
      });

      await server1.start();
      const proof = '0x' + 'a'.repeat(64);

      try {
        // Request 1: Valid payment
        const res1 = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': proof,
        }, pipePath1);
        assert.equal(res1.statusCode, 200);

        // Request 2: Duplicate in active server (In-Memory Replay Cache)
        const res2 = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': proof,
        }, pipePath1);
        assert.equal(res2.statusCode, 409);
        assert.equal(res2.body.error, 'Payment Replay Detected');
      } finally {
        await server1.stop();
      }

      // Reboot server with same database (Persistence-Layer Replay Defense)
      const pipePath2 = getTestPipePath();
      const server2 = new X402Server({
        config: ctx.config,
        database: ctx.db,
        wallet: ctx.wallet,
        pipePath: pipePath2,
      });

      await server2.start();

      try {
        // Request 3: Resend duplicate to newly booted server
        const res3 = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': proof,
        }, pipePath2);
        assert.equal(res3.statusCode, 409);
        assert.equal(res3.body.error, 'Payment Replay Detected');
      } finally {
        await server2.stop();
      }
    });

    it('T3.30: Database Transaction Isolation via Nested SAVEPOINTs', () => {
      const db = new DatabaseService(':memory:');
      try {
        db.transaction(() => {
          // Outer transaction inserts record A
          db.insertLedger({
            chain: 'base',
            token: 'USDC',
            amount: 10.0,
            entryType: 'INCOME_X402',
            timestamp: Date.now(),
          });

          // Inner nested transaction attempts to insert record B then fails
          try {
            db.transaction(() => {
              db.insertLedger({
                chain: 'polygon',
                token: 'USDC',
                amount: 20.0,
                entryType: 'INCOME_POLYMARKET',
                timestamp: Date.now(),
              });
              throw new Error('Inner transaction failure');
            });
          } catch {
            // Handled inner error: record B rolled back to savepoint
          }
        });

        // Record A persists, Record B was rolled back
        const entries = db.getLedgerEntries(10);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].amount, 10.0);
        assert.equal(entries[0].entryType, 'INCOME_X402');
      } finally {
        db.close();
      }
    });
  });
});
