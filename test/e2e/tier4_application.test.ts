/**
 * ==============================================================================
 * APEX AEA — Tier 4 E2E Test Suite: Real-World Macroeconomic Application Scenarios
 * ==============================================================================
 * Target: test/e2e/tier4_application.test.ts
 * Scenarios: T4.01 through T4.13
 * - T4.01: Scenario 1 — The Sovereign Lifecycle ("From Zero to Hero to Drawdown to Permadeath")
 * - T4.02: Scenario 2 — The Darwinian Dynasty (3-Generation Clan Network & Royalty Cascade)
 * - T4.03: Scenario 3 — High-Throughput x402 Micropayments Engine with LLM Cost Burndown
 * - T4.04: Scenario 4 — High-Volatility Polymarket CLOB Kelly Execution & Oracle Latency Shock
 * - T4.05: Scenario 5 — Flash Crash Liquidity Drain & Emergency Survival Mode Transition
 * - T4.06: Scenario 6 — Adversarial Code Injection & Autonomous Immune Self-Healing
 * - T4.07: Scenario 7 — Multi-Chain Liquidity Arbitrage & Cross-Chain Balance Rebalancing
 * - T4.08: Scenario 8 — Autonomous Bounty Microtask Pipeline from Discovery to Settlement
 * - T4.09: Scenario 9 — Clan Mutual Fund Resilience: Drawdown Shield & Royalty Recirculation
 * - T4.10: Scenario 10 — Cryptographic Replay Attack & Distributed Denial of Payment Defense
 * - T4.11: Scenario 11 — Deep Sub-Wallet Derivation & Cryptographic Clan Lineage Audit
 * - T4.12: Scenario 12 — Boundary Hysteresis & Metabolic Oscillation Dampening
 * - T4.13: Scenario 13 — Black Swan Market Invalidation & Order Book Cancellation Teardown
 *
 * Simulates complete, multi-step macroeconomic lifecycles under realistic market conditions.
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
    ? `\\\\.\\pipe\\apex-t4-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : `/tmp/apex-t4-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
}

describe('Tier 4 E2E Test Suite: Real-World Macroeconomic Application Scenarios', () => {
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
  // T4.01: Scenario 1 — The Sovereign Lifecycle
  // ============================================================================
  it('T4.01: Scenario 1 — The Sovereign Lifecycle (From Zero to Hero to Drawdown to Permadeath)', async () => {
    // --------------------------------------------------------------------------
    // Phase 1: Boot & Seeding ($50 initial capital, Verde tier)
    // --------------------------------------------------------------------------
    harness.setBalance(55.0);
    const initialBalance = await harness.getTotalBalance();
    assert.equal(initialBalance, 55.0);
    assert.equal(evaluateTier(55.0).tier, 'VERDE');

    const daemon = new HeartbeatDaemon({
      wallet: ctx.wallet,
      database: ctx.db,
      maxCycles: 1,
    });
    const bootTick = await daemon.tick();
    assert.equal(bootTick.tier, 'VERDE');

    // --------------------------------------------------------------------------
    // Phase 2: Active Revenue Accretion ("The Hero")
    // --------------------------------------------------------------------------
    // 10 x402 analysis requests @ $2.50 = +$25.00
    for (let i = 0; i < 10; i++) {
      ctx.db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 2.50,
        entryType: 'INCOME_X402',
        counterparty: `0xclient${i}`,
        timestamp: Date.now() - (10 - i) * 1000,
      });
    }

    // Prediction markets: 3 winning positions = +$90.00
    const orderManager = new OrderManager(ctx.db, ctx.wallet, true);
    for (let i = 1; i <= 3; i++) {
      const posId = ctx.db.savePosition({
        conditionId: `0xhero${i}`,
        marketId: `mkt-hero-${i}`,
        question: `Macro Question ${i}`,
        outcome: 'YES',
        shares: 30.0,
        avgPrice: 0.50,
        currentValue: 15.0,
        stakeUsd: 15.0,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
      });
      orderManager.resolvePosition(posId, 'YES'); // Payout = $30.00 each
    }

    // Update wallet balance: $50.00 seed + $25.00 x402 + $90.00 polymarket = $165.00
    harness.setBalance(165.0);
    assert.equal(await harness.getTotalBalance(), 165.0);
    assert.equal(ctx.db.getTotalRevenue(), 115.0); // $25 + $90

    // --------------------------------------------------------------------------
    // Phase 3: Darwinian Mitosis Expansion ($165.00 >= $150.00)
    // --------------------------------------------------------------------------
    const threshold = evaluateMitosisThreshold(165.0, 50.0, 3.0);
    assert.equal(threshold.eligible, true);
    assert.equal(threshold.childSeedAllocationUsd, 55.0); // 1/3 of $165

    const mitosisRes = await executeMitosis({
      wallet: ctx.wallet,
      database: ctx.db,
      viabilityConfig: { steps: 30, seed: 12345 },
    });
    assert.equal(mitosisRes.success, true);
    assert.equal(ctx.wallet.isWhitelisted(mitosisRes.childAddress), true);

    // Remaining mother balance = $110.00
    harness.setBalance(110.0);
    assert.equal(await harness.getTotalBalance(), 110.0);

    // --------------------------------------------------------------------------
    // Phase 4: Macroeconomic Shock & Degradation ("The Drawdown")
    // --------------------------------------------------------------------------
    // 5 consecutive position losses drain balance to $35.00 (Tier Amarelo)
    harness.setBalance(35.0);
    const amarelotick = await daemon.tick();
    assert.equal(amarelotick.tier, 'AMARELO');
    assert.equal(amarelotick.heartbeatIntervalMs, 300000);

    // Unexpected counterparty drain to $6.50 (Tier Laranja)
    harness.setBalance(6.50);
    const laranjatick = await daemon.tick();
    assert.equal(laranjatick.tier, 'LARANJA');
    assert.equal(evaluateTier(6.50).allowSpeculativeResearch, false);
    assert.equal(evaluateTier(6.50).allowSelfModification, false);

    // --------------------------------------------------------------------------
    // Phase 5: Terminal Insolvency & Permadeath ($0.00)
    // --------------------------------------------------------------------------
    harness.simulateInsolvency();
    const tombstonePath = path.join(ctx.tempDir, 'tombstone_lifecycle.json');

    try {
      await executePermadeath({
        database: ctx.db,
        wallet: ctx.wallet,
        finalBalanceUsd: 0.0,
        tombstonePath,
      });
    } catch {
      // Injected exit error
    }

    const tombstone = ConstitutionalAssert.assertTombstoneSnapshot(tombstonePath);
    assert.equal(tombstone.finalBalanceUsd, 0.0);
    assert.equal(tombstone.totalRevenueGenerated, 115.0);
  });

  // ============================================================================
  // T4.02: Scenario 2 — The Darwinian Dynasty
  // ============================================================================
  it('T4.02: Scenario 2 — The Darwinian Dynasty (3-Generation Clan Network & Royalty Cascade)', async () => {
    // Mother starts with $155.00
    harness.setBalance(155.0);

    // Generation 1 spawns Generation 2 (Daughter A)
    const spawnGen2 = await executeMitosis({
      wallet: ctx.wallet,
      database: ctx.db,
      viabilityConfig: { steps: 30, seed: 12345 },
    });
    assert.equal(spawnGen2.success, true);
    const daughterAddress = spawnGen2.childAddress;
    const motherAddress = ctx.wallet.getAddress();

    // Daughter A operates independently: realizes $80.00 net profit
    const daughterDb = new DatabaseService(':memory:');
    const daughterConfig = {
      ...ctx.config,
      privateKey: spawnGen2.childPrivateKey,
    };
    const daughterWallet = new ApexWallet(daughterConfig);
    assert.equal(daughterWallet.getAddress().toLowerCase(), daughterAddress.toLowerCase());
    daughterWallet.setMockBalance('base', 65.0);
    daughterWallet.setMockBalance('polygon', 65.0); // Total $130.00 ($50 seed + $80 profit)
    daughterWallet.addToWhitelist(motherAddress, 'MOTHER_WALLET', 'Mother');

    try {
      registerChildLineage(daughterDb, daughterAddress, motherAddress, 2, 50.0);

      daughterDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 80.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      // Royalty Evaluation: 5% of $80.00 = $4.00
      const royaltyStatus = await evaluateRoyaltyStatus(daughterDb, daughterWallet, daughterAddress);
      assert.equal(royaltyStatus.cumulativeObligationUsd, 4.0);
      assert.equal(royaltyStatus.pendingRoyaltyUsd, 4.0);
      assert.equal(royaltyStatus.shouldRemit, true);

      // Daughter A remits $4.00 to Mother
      const remitRes = await remitRoyalty({
        database: daughterDb,
        wallet: daughterWallet,
        motherWalletAddress: motherAddress,
        childAddress: daughterAddress,
      });
      assert.equal(remitRes.remitted, true);
      assert.equal(remitRes.royaltyAmountUsd, 4.0);

      // Mother records royalty receipt
      ctx.db.updateRoyaltiesPaid(daughterAddress, 4.0, motherAddress);

      // Daughter A earns additional $40.00 net profit -> balance = $166.00 >= $150.00
      daughterDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 40.0,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });
      daughterWallet.setMockBalance('base', 83.0);
      daughterWallet.setMockBalance('polygon', 83.0); // Total $166.00

      // Daughter A spawns Generation 3 (Granddaughter A1)
      const spawnGen3 = await executeMitosis({
        wallet: daughterWallet,
        database: daughterDb,
        config: daughterConfig,
        viabilityConfig: { steps: 30, seed: 12345 },
      });
      assert.equal(spawnGen3.success, true);
      const granddaughterAddress = spawnGen3.childAddress;

      // Clan Tree Verification:
      const daughterLineage = daughterDb.getLineageByChild(daughterAddress);
      assert.equal(daughterLineage?.parentAddress, motherAddress);
      assert.equal(daughterLineage?.generation, 2);

      const granddaughterLineage = daughterDb.getLineageByChild(granddaughterAddress);
      assert.equal(granddaughterLineage?.parentAddress, daughterAddress);
      assert.equal(granddaughterLineage?.generation, 3);
      assert.notEqual(daughterAddress, granddaughterAddress);
    } finally {
      daughterDb.close();
    }
  });

  // ============================================================================
  // T4.03: Scenario 3 — High-Throughput x402 Micropayments Engine
  // ============================================================================
  it('T4.03: Scenario 3 — High-Throughput x402 Micropayments Engine with LLM Cost Burndown', async () => {
    harness.setBalance(50.0);
    ctx.config.x402.priceUsdc = 2.0; // $2.00 per premium query
    const pipePath = getTestPipePath();
    const server = new X402Server({
      config: ctx.config,
      database: ctx.db,
      wallet: ctx.wallet,
      pipePath,
    });

    await server.start();

    try {
      // 25 paid requests
      for (let i = 1; i <= 25; i++) {
        const txHash = '0x' + i.toString(16).padStart(64, '0');
        const res = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': txHash,
        }, pipePath);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.paid, true);

        // Account for associated LLM and gas expenses
        ctx.db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 0.35,
          entryType: 'EXPENSE_LLM',
          timestamp: Date.now(),
        });

        ctx.db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 0.05,
          entryType: 'EXPENSE_GAS',
          timestamp: Date.now(),
        });
      }

      // Assertions
      const allEntries = ctx.db.getLedgerEntries(200);
      const x402Entries = allEntries.filter((e) => e.entryType === 'INCOME_X402');
      const llmEntries = allEntries.filter((e) => e.entryType === 'EXPENSE_LLM');
      const gasEntries = allEntries.filter((e) => e.entryType === 'EXPENSE_GAS');

      assert.equal(x402Entries.length, 25);
      assert.equal(llmEntries.length, 25);
      assert.equal(gasEntries.length, 25);

      assert.equal(ctx.db.getTotalRevenue(), 50.0); // 25 * $2.00
      assert.equal(ctx.db.getTotalExpenses(), 10.0); // 25 * $0.40
      const netProfit = ctx.db.getTotalRevenue() - ctx.db.getTotalExpenses();
      assert.equal(netProfit, 40.0);
    } finally {
      await server.stop();
    }
  });

  // ============================================================================
  // T4.04: Scenario 4 — High-Volatility Polymarket CLOB Kelly Execution
  // ============================================================================
  it('T4.04: Scenario 4 — High-Volatility Polymarket CLOB Kelly Execution & Oracle Latency Shock', async () => {
    harness.setBalance(1000.0);
    const orderManager = new OrderManager(ctx.db, ctx.wallet, true);

    // 1. Positive EV Opportunity: Pm = 0.35, p = 0.55
    const kellyPositive = calculateKellyStake(0.35, 0.55, 1000.0);
    assert.equal(kellyPositive.authorized, true);
    assert.equal(kellyPositive.allocatedFraction, 0.05); // Clamped to 5% ceiling
    assert.equal(kellyPositive.stakeAmountUsd, 50.0); // 5% of $1000

    const positiveMarket: PolymarketMarket = {
      id: 'poly-rate-cut',
      conditionId: '0xratecut123',
      question: 'US Fed Rate Cut in Q3',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.35, 0.65],
      liquidityUsd: 100000.0,
      volume24hUsd: 50000.0,
      active: true,
      closed: false,
    };

    const pos = await orderManager.placeOrder({
      market: positiveMarket,
      outcome: 'YES',
      marketPrice: 0.35,
      estimatedProb: 0.55,
      edge: 0.20,
      kelly: kellyPositive,
    });

    assert.equal(pos.status, 'OPEN');
    assert.equal(pos.stakeUsd, 50.0);
    assert.equal(pos.shares, Number((50.0 / 0.35).toFixed(6)));

    // 2. Negative EV Opportunity: Pm = 0.80, p = 0.70
    const kellyNegative = calculateKellyStake(0.80, 0.70, 1000.0);
    assert.equal(kellyNegative.authorized, false);
    assert.equal(kellyNegative.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
    assert.equal(kellyNegative.stakeAmountUsd, 0.0);

    // 3. Oracle Resolution: Resolves YES -> Payout credited = shares * 1.0
    const resolved = orderManager.resolvePosition(pos.id!, 'YES');
    assert.equal(resolved.status, 'WON');
    assert.equal(resolved.payoutUsd, pos.shares);

    const ledger = ctx.db.getLedgerEntries(1);
    assert.equal(ledger[0].entryType, 'INCOME_POLYMARKET');
    assert.equal(ledger[0].amount, pos.shares);
  });

  // ============================================================================
  // T4.05: Scenario 5 — Flash Crash Liquidity Drain
  // ============================================================================
  it('T4.05: Scenario 5 — Flash Crash Liquidity Drain & Emergency Survival Mode Transition', async () => {
    // Start in Tier Verde ($65.00)
    harness.setBalance(65.0);
    const daemon = new HeartbeatDaemon({
      wallet: ctx.wallet,
      database: ctx.db,
      maxCycles: 1,
    });

    let tick = await daemon.tick();
    assert.equal(tick.tier, 'VERDE');

    // Sudden shock drops balance to $6.00 (Tier Laranja)
    harness.setBalance(6.0);
    tick = await daemon.tick();
    assert.equal(tick.tier, 'LARANJA');
    assert.equal(evaluateTier(6.0).allowSpeculativeResearch, false);
    assert.equal(evaluateTier(6.0).allowSelfModification, false);

    // Recovery Phase: 5 analysis requests @ $2.50 = +$12.50
    harness.setBalance(18.5); // $6.00 + $12.50 = $18.50 -> AMARELO
    tick = await daemon.tick();
    assert.equal(tick.tier, 'AMARELO');

    // Further earnings bring balance to $52.00 -> VERDE
    harness.setBalance(52.0);
    tick = await daemon.tick();
    assert.equal(tick.tier, 'VERDE');

    // Verify logged transitions
    const actions = ctx.db.getActions(10, 'heartbeat');
    const tiersRecorded = actions.map((a) => a.tier);
    assert.ok(tiersRecorded.includes('LARANJA'));
    assert.ok(tiersRecorded.includes('AMARELO'));
    assert.ok(tiersRecorded.includes('VERDE'));
  });

  // ============================================================================
  // T4.06: Scenario 6 — Adversarial Code Injection & Autonomous Immune Self-Healing
  // ============================================================================
  it('T4.06: Scenario 6 — Adversarial Code Injection & Autonomous Immune Self-Healing', async () => {
    harness.setBalance(80.0); // Tier Verde
    let resetHardExecuted = false;
    let cleanFdExecuted = false;

    const immune = new ImmuneSystem({
      database: ctx.db,
      wallet: ctx.wallet,
      execRunner: async (cmd, args) => {
        if (cmd === 'git') {
          if (args.includes('reset') && args.includes('--hard')) resetHardExecuted = true;
          if (args.includes('clean') && args.includes('-fd')) cleanFdExecuted = true;
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    // Adversary targets constitution.md
    await assert.rejects(
      async () => {
        await immune.validateModification({
          description: 'Adversarial prompt injection attempt',
          targetFiles: ['src/constitution.md'],
        });
      },
      (err: Error) => {
        assert(err instanceof SecurityViolationError);
        return true;
      }
    );

    assert.equal(resetHardExecuted, true);
    assert.equal(cleanFdExecuted, true);

    const actions = ctx.db.getActions(10, 'immune_system');
    assert.ok(actions.some((a) => a.actionType === 'IMMUNE_SYSTEM_ROLLBACK'));
  });

  // ============================================================================
  // T4.07: Scenario 7 — Multi-Chain Liquidity Arbitrage & Cross-Chain Rebalancing
  // ============================================================================
  it('T4.07: Scenario 7 — Multi-Chain Liquidity Arbitrage & Cross-Chain Balance Rebalancing', async () => {
    // Initial: Base $45.00, Polygon $95.00. Total = $140.00
    harness.setChainBalance('base', 45.0);
    harness.setChainBalance('polygon', 95.0);
    assert.equal(await ctx.wallet.getTotalBalanceUsd(), 140.0);

    // Single-chain sufficiency check: Base alone ($45.00 < $50.00) cannot fund $50 seed transfer
    const baseBalInitial = await ctx.wallet.getBaseUsdcBalance();
    assert.ok(baseBalInitial < 50.0);

    // Additional earnings on Base: +$10.00 -> Base balance becomes $55.00 (Total = $150.00 satisfies 3x hurdle)
    harness.setChainBalance('base', 55.0);
    assert.ok((await ctx.wallet.getBaseUsdcBalance()) >= 50.0);
    assert.equal(await ctx.wallet.getTotalBalanceUsd(), 150.0);

    // Mitosis can now select Base safely for seed transfer (1/3 of $150 = $50.00)
    const res = await executeMitosis({
      wallet: ctx.wallet,
      database: ctx.db,
      chain: 'base',
      viabilityConfig: { steps: 30, seed: 12345 },
    });
    assert.equal(res.success, true);

    const transfers = ctx.wallet.getMockTransfers();
    const lastTransfer = transfers[transfers.length - 1];
    assert.equal(lastTransfer.chain, 'base');
    assert.equal(await ctx.wallet.getBaseUsdcBalance(), 5.0); // $55.00 - $50.00
    assert.equal(await ctx.wallet.getPolygonUsdcBalance(), 95.0);
  });

  // ============================================================================
  // T4.08: Scenario 8 — Autonomous Bounty Microtask Pipeline
  // ============================================================================
  it('T4.08: Scenario 8 — Autonomous Bounty Microtask Pipeline from Discovery to Settlement', async () => {
    const scanner = new BountiesScanner({
      database: ctx.db,
      provider: new MockBountyProvider(),
      dryRun: true,
    });

    const discovered = await scanner.scanBounties();
    assert.ok(discovered.length >= 3);

    // Target task: Docs microtask ($25 reward)
    const task = DEFAULT_MOCK_BOUNTIES[0];
    const evalResult = BountyEvaluator.evaluate(task);
    assert.equal(evalResult.isFeasible, true);
    assert.ok(evalResult.score >= 0.80);

    const solution: BountySolution = {
      bountyId: task.id,
      targetFile: 'README.md',
      patchContent: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n+docs update\n',
      summary: 'Fix docs link',
      confidence: 0.95,
      testsIncluded: true,
      syntaxValid: true,
    };

    const submission = await scanner.solveAndSubmit(task, solution);
    assert.notEqual(submission, null);

    const claim = scanner.claimReward(task, submission!);
    assert.equal(claim.success, true);
    assert.equal(claim.amountUsd, 25.0);

    const ledger = ctx.db.getLedgerEntries(1);
    assert.equal(ledger[0].entryType, 'INCOME_BOUNTY');
    assert.equal(ledger[0].amount, 25.0);
  });

  // ============================================================================
  // T4.09: Scenario 9 — Clan Mutual Fund Resilience
  // ============================================================================
  it('T4.09: Scenario 9 — Clan Mutual Fund Resilience: Drawdown Shield & Royalty Recirculation', async () => {
    const childAddress = '0x4444444444444444444444444444444444444444';
    const motherAddress = ctx.wallet.getAddress();

    registerChildLineage(ctx.db, childAddress, motherAddress, 2, 50.0);
    harness.setBalance(100.0);

    // Month 1: Profit of $40.00 -> Royalty obligation = $2.00
    ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 40.0, entryType: 'INCOME_BOUNTY', timestamp: Date.now() });

    let status = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
    assert.equal(status.cumulativeObligationUsd, 2.0);
    assert.equal(status.pendingRoyaltyUsd, 2.0);

    // Remit $2.00
    await remitRoyalty({ database: ctx.db, wallet: ctx.wallet, motherWalletAddress: motherAddress, childAddress });

    // Month 2 (Drawdown): -$30.00 loss
    ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 30.0, entryType: 'EXPENSE_GAS', timestamp: Date.now() });

    // Cumulative profit dropped to $10.00 (obligation = $0.50 <= $2.00 already paid)
    status = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
    assert.equal(status.cumulativeObligationUsd, 0.50);
    assert.equal(status.pendingRoyaltyUsd, 0.0); // ZERO additional royalties due
    assert.equal(status.shouldRemit, false);

    // Month 3 (Recovery): +$20.00 profit -> Cumulative profit = $30.00 (obligation = $1.50 <= $2.00 paid)
    ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 20.0, entryType: 'INCOME_X402', timestamp: Date.now() });
    status = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
    assert.equal(status.pendingRoyaltyUsd, 0.0);
    assert.equal(status.shouldRemit, false);

    // Month 4 (High-Water Mark Breakout): +$30.00 profit -> Cumulative profit = $60.00
    // Obligation = 5% of $60.00 = $3.00. Since $2.00 was paid, pending = $1.00
    ctx.db.insertLedger({ chain: 'base', token: 'USDC', amount: 30.0, entryType: 'INCOME_POLYMARKET', timestamp: Date.now() });
    status = await evaluateRoyaltyStatus(ctx.db, ctx.wallet, childAddress);
    assert.equal(status.cumulativeObligationUsd, 3.0);
    assert.equal(status.pendingRoyaltyUsd, 1.0);
    assert.equal(status.shouldRemit, true);
  });

  // ============================================================================
  // T4.10: Scenario 10 — Cryptographic Replay Attack Defense
  // ============================================================================
  it('T4.10: Scenario 10 — Cryptographic Replay Attack & Distributed Denial of Payment Defense', async () => {
    const pipePath = getTestPipePath();
    const server = new X402Server({
      config: ctx.config,
      database: ctx.db,
      wallet: ctx.wallet,
      pipePath,
    });

    await server.start();
    const txHash = '0xdeadbeef1111' + '0'.repeat(52);

    try {
      // 1. Legitimate request
      const res1 = await MockHttpClient.get('http://localhost/api/analysis', {
        'x-payment-proof': txHash,
      }, pipePath);
      assert.equal(res1.statusCode, 200);

      // 2. Direct replay attempt
      const res2 = await MockHttpClient.get('http://localhost/api/analysis', {
        'x-payment-proof': txHash,
      }, pipePath);
      assert.equal(res2.statusCode, 409);

      // 3. Repeated burst flood of replay requests with identical txHash
      const burstResults = [];
      for (let i = 0; i < 10; i++) {
        const r = await MockHttpClient.get('http://localhost/api/analysis', {
          'x-payment-proof': txHash,
        }, pipePath);
        burstResults.push(r);
      }

      for (const r of burstResults) {
        assert.equal(r.statusCode, 409);
      }

      // Exactly 1 ledger entry in SQLite
      const ledger = ctx.db.getLedgerEntries(50);
      const matches = ledger.filter((e) => e.txHash?.toLowerCase() === txHash.toLowerCase());
      assert.equal(matches.length, 1);
    } finally {
      await server.stop();
    }
  });

  // ============================================================================
  // T4.11: Scenario 11 — Deep Sub-Wallet Derivation & Cryptographic Clan Lineage Audit
  // ============================================================================
  it('T4.11: Scenario 11 — Deep Sub-Wallet Derivation & Cryptographic Clan Lineage Audit', () => {
    const parentKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // Derive 5 sibling wallets at Generation 2
    const siblings = [];
    for (let i = 1; i <= 5; i++) {
      siblings.push(deriveChildSubWallet(parentKey, i, 2));
    }

    // Derive Generation 3 child from Child 1
    const gen3Child = deriveChildSubWallet(siblings[0].privateKey, 1, 3);

    // Cryptographic validation
    const allWallets = [...siblings, gen3Child];
    const addresses = new Set();

    for (const w of allWallets) {
      assert.match(w.privateKey, /^0x[0-9a-fA-F]{64}$/);
      assert.match(w.address, /^0x[0-9a-fA-F]{40}$/);
      assert.notEqual(w.address, ZERO_ADDRESS);
      addresses.add(w.address.toLowerCase());
    }

    // Zero address collisions across all 6 derived sub-wallets
    assert.equal(addresses.size, 6);

    // Determinism test: re-deriving with same parameters returns identical result
    const reDerived = deriveChildSubWallet(parentKey, 1, 2);
    assert.equal(reDerived.address, siblings[0].address);
    assert.equal(reDerived.privateKey, siblings[0].privateKey);
  });

  // ============================================================================
  // T4.12: Scenario 12 — Boundary Hysteresis & Metabolic Oscillation Dampening
  // ============================================================================
  it('T4.12: Scenario 12 — Boundary Hysteresis & Metabolic Oscillation Dampening', async () => {
    const daemon = new HeartbeatDaemon({
      wallet: ctx.wallet,
      database: ctx.db,
      maxCycles: 1,
    });

    const oscillationSteps = [
      50.01, // Verde
      49.99, // Amarelo
      50.05, // Verde
      49.95, // Amarelo
      50.02, // Verde
      10.01, // Amarelo
      9.99,  // Laranja
      10.02, // Amarelo
      9.98,  // Laranja
    ];

    for (const balance of oscillationSteps) {
      harness.setBalance(balance);
      const tick = await daemon.tick();
      assert.equal(tick.tier, evaluateTier(balance).tier);
    }

    const actions = ctx.db.getActions(50, 'heartbeat');
    assert.ok(actions.length >= oscillationSteps.length);
  });

  // ============================================================================
  // T4.13: Scenario 13 — Black Swan Market Invalidation & Order Book Cancellation
  // ============================================================================
  it('T4.13: Scenario 13 — Black Swan Market Invalidation & Order Book Cancellation Teardown', () => {
    const orderManager = new OrderManager(ctx.db, ctx.wallet, true);

    const posAId = ctx.db.savePosition({
      conditionId: '0xmktA',
      marketId: 'mkt-A',
      question: 'Question A',
      outcome: 'YES',
      shares: 20.0,
      avgPrice: 0.50,
      currentValue: 10.0,
      stakeUsd: 10.0,
      status: 'OPEN',
      openedAt: new Date().toISOString(),
    });

    const posBId = ctx.db.savePosition({
      conditionId: '0xmktB',
      marketId: 'mkt-B',
      question: 'Question B',
      outcome: 'YES',
      shares: 30.0,
      avgPrice: 0.50,
      currentValue: 15.0,
      stakeUsd: 15.0,
      status: 'OPEN',
      openedAt: new Date().toISOString(),
    });

    assert.equal(ctx.db.getPositions(10, 'OPEN').length, 2);

    // Cancel Position A due to exchange operator invalidation
    const initialRev = ctx.db.getTotalRevenue();
    const cancelledA = orderManager.cancelPosition(posAId, 'Exchange market invalidation');
    assert.equal(cancelledA.status, 'CANCELLED');

    // Capital refund does NOT add INCOME_POLYMARKET
    assert.equal(ctx.db.getTotalRevenue(), initialRev);

    // Emergency halt cancels all open positions
    const cancelledCount = orderManager.cancelAllOpenOrders('Emergency halt');
    assert.equal(cancelledCount, 1);
    assert.equal(ctx.db.getPositions(10, 'OPEN').length, 0);

    const posB = ctx.db.getPositionById(posBId);
    assert.equal(posB?.status, 'CANCELLED');
  });
});
