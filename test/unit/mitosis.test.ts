/**
 * ==============================================================================
 * Unit Tests: Darwinian Mitosis & Royalty Lifecycle (`src/evolution/mitosis.ts`)
 * ==============================================================================
 * Verifies:
 * 1. Capital Threshold Gating (3x initial capital / $150 hurdle, $149.99 rejected)
 * 2. Surplus Allocation & Solvency Invariant (1/3 child $50, 2/3 mother $100)
 * 3. Pre-Replication Proof of Viability (Sharpe > 0, Net Return > 0)
 * 4. Deterministic Sub-Wallet Derivation (RFC 5869 HKDF-SHA256 & secp256k1 EVM)
 * 5. Pre-Transfer Whitelist Invariant (Article I)
 * 6. High-Water Mark Cumulative 5% Royalty Accounting & Drawdown Immunity
 * 7. Cash-Flow Solvency Buffer ($15.00) & Dust Protection ($0.50)
 * 8. Atomic Double-Entry Persistence (Ledger, Lineage, Actions)
 * 9. Constitutional Hyperparameter Mutation Bounds (k <= 0.25, cap <= 0.05)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMitosisThreshold,
  runViabilitySimulation,
  deriveChildSubWallet,
  executeMitosis,
  calculateRoyalty,
  evaluateRoyaltyStatus,
  remitRoyalty,
  validateConstitutionalBounds,
  mutateHyperparameters,
  createChildSpawnConfig,
  registerChildLineage,
  executeMitosisLifecycleTick,
  MitosisThresholdError,
  ViabilityCheckFailedError,
  RoyaltyRemittanceError,
  HyperparameterMutationError,
  CONSTITUTIONAL_ROYALTY_PERCENTAGE,
  type ChildHyperparameters,
} from '../../src/evolution/mitosis.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet } from '../../src/core/wallet.ts';
import { loadConfig } from '../../src/config.ts';
import { ConstitutionViolationError, MitosisError } from '../../src/types.ts';

describe('Darwinian Mitosis & Royalty Lifecycle Unit Tests', () => {
  let db: DatabaseService;
  let wallet: ApexWallet;

  const validParentKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    wallet = new ApexWallet();
  });

  // ============================================================================
  // Suite 1: Capital Threshold Gating & Surplus Allocation
  // ============================================================================
  describe('1. Capital Threshold Gating & Surplus Allocation', () => {
    it('T-MIT-01: should reject sub-threshold balance ($149.99 < $150.00) with exact deficit ($0.01)', () => {
      const res = evaluateMitosisThreshold(149.99, 50.0, 3.0);
      assert.equal(res.eligible, false);
      assert.equal(res.currentBalanceUsd, 149.99);
      assert.equal(res.thresholdRequiredUsd, 150.0);
      assert.equal(res.deficitUsd, 0.01);
      assert.equal(res.surplusUsd, 0);
      assert.equal(res.childSeedAllocationUsd, 0);
      assert.equal(res.motherRetainedUsd, 149.99);
    });

    it('T-MIT-02: should approve exact threshold balance ($150.00) and allocate 1/3 ($50) child / 2/3 ($100) mother', () => {
      const res = evaluateMitosisThreshold(150.0, 50.0, 3.0);
      assert.equal(res.eligible, true);
      assert.equal(res.deficitUsd, 0);
      assert.equal(res.childSeedAllocationUsd, 50.0);
      assert.equal(res.motherRetainedUsd, 100.0);
    });

    it('T-MIT-03: should approve above-threshold balance ($180.00) allocating $60 child / $120 mother', () => {
      const res = evaluateMitosisThreshold(180.0, 50.0, 3.0);
      assert.equal(res.eligible, true);
      assert.equal(res.surplusUsd, 30.0);
      assert.equal(res.childSeedAllocationUsd, 60.0);
      assert.equal(res.motherRetainedUsd, 120.0);
    });

    it('T-MIT-04: should throw TypeError for invalid balance inputs', () => {
      assert.throws(() => evaluateMitosisThreshold(NaN), TypeError);
      assert.throws(() => evaluateMitosisThreshold('150' as any), TypeError);
    });
  });

  // ============================================================================
  // Suite 2: Pre-Replication Proof of Viability Simulator
  // ============================================================================
  describe('2. Pre-Replication Proof of Viability Simulator', () => {
    it('T-MIT-05: should pass simulation with positive Sharpe and positive net return under default positive-EV feed', () => {
      const res = runViabilitySimulation({ steps: 30, seed: 12345 });
      assert.equal(res.passed, true);
      assert.equal(res.stepsExecuted, 30);
      assert(res.sharpeRatio > 0, `Sharpe ratio (${res.sharpeRatio}) must be > 0`);
      assert(res.netReturnUsd > 0, `Net return ($${res.netReturnUsd}) must be > 0`);
      assert(res.winRate > 0, 'Win rate must be > 0');
    });

    it('T-MIT-06: should fail simulation and report failureReason if strategy generates negative returns', () => {
      // Custom feed with guaranteed 100% losing outcomes
      const customFeed = Array(20).fill({
        marketPrice: 0.50,
        modelProb: 0.60,
        won: false,
      });

      const res = runViabilitySimulation({
        steps: 20,
        customPriceFeed: customFeed,
      });

      assert.equal(res.passed, false);
      assert(res.netReturnUsd < 0);
      assert(res.failureReason !== undefined);
      assert(res.failureReason.includes('non-positive'));
    });

    it('T-MIT-07: should fail simulation if returns are flat (zero profit / zero Sharpe)', () => {
      // Custom feed where Kelly does not trade (modelProb <= marketPrice, EV <= 0)
      const customFeed = Array(20).fill({
        marketPrice: 0.60,
        modelProb: 0.50,
        won: false,
      });

      const res = runViabilitySimulation({
        steps: 20,
        customPriceFeed: customFeed,
      });

      assert.equal(res.passed, false);
      assert.equal(res.netReturnUsd, 0);
    });
  });

  // ============================================================================
  // Suite 3: Deterministic Sub-Wallet Key Derivation (RFC 5869 HKDF)
  // ============================================================================
  describe('3. Deterministic Sub-Wallet Key Derivation', () => {
    it('T-MIT-08: should generate deterministic, identical sub-wallet keys across repeated calls with same inputs', () => {
      const w1 = deriveChildSubWallet(validParentKey, 1, 2);
      const w2 = deriveChildSubWallet(validParentKey, 1, 2);

      assert.equal(w1.address, w2.address);
      assert.equal(w1.privateKey, w2.privateKey);
      assert.equal(w1.derivationPath, "m/44'/60'/2'/0/1");
      assert.match(w1.address, /^0x[0-9a-fA-F]{40}$/);
      assert.match(w1.privateKey, /^0x[0-9a-fA-F]{64}$/);
    });

    it('T-MIT-09: should generate unique keys and addresses for different child indices', () => {
      const child1 = deriveChildSubWallet(validParentKey, 1, 2);
      const child2 = deriveChildSubWallet(validParentKey, 2, 2);

      assert.notEqual(child1.address, child2.address);
      assert.notEqual(child1.privateKey, child2.privateKey);
      assert.notEqual(child1.derivationPath, child2.derivationPath);
    });

    it('T-MIT-10: should reject invalid childIndex or invalid generation', () => {
      assert.throws(() => deriveChildSubWallet(validParentKey, 0, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, -1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1.5, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, 0), TypeError);
    });

    it('T-MIT-11: should reject invalid parent private key string', () => {
      assert.throws(() => deriveChildSubWallet('invalid-key', 1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet('0x1234', 1, 2), TypeError);
    });
  });

  // ============================================================================
  // Suite 4: End-to-End Darwinian Mitosis Execution
  // ============================================================================
  describe('4. End-to-End Darwinian Mitosis Execution', () => {
    it('T-MIT-12: should block mitosis when mother balance is $140.00 (< $150.00) and throw MitosisThresholdError', async () => {
      wallet.setMockBalance('base', 70.0);
      wallet.setMockBalance('polygon', 70.0); // Total $140.00

      await assert.rejects(
        async () => {
          await executeMitosis({ wallet, database: db });
        },
        (err: Error) => {
          assert(err instanceof MitosisThresholdError);
          assert(err instanceof MitosisError);
          assert.equal(err.currentBalanceUsd, 140.0);
          assert.equal(err.requiredThresholdUsd, 150.0);
          assert.equal(err.deficitUsd, 10.0);
          return true;
        }
      );

      // Verify audit action
      const actions = db.getActions(10, 'mitosis');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'MITOSIS_BLOCKED_THRESHOLD');
    });

    it('T-MIT-13: should block mitosis when strategy fails proof of viability and throw ViabilityCheckFailedError', async () => {
      wallet.setMockBalance('base', 75.0);
      wallet.setMockBalance('polygon', 75.0); // Total $150.00

      const failingFeed = Array(20).fill({
        marketPrice: 0.50,
        modelProb: 0.60,
        won: false,
      });

      await assert.rejects(
        async () => {
          await executeMitosis({
            wallet,
            database: db,
            viabilityConfig: { steps: 20, customPriceFeed: failingFeed },
          });
        },
        (err: Error) => {
          assert(err instanceof ViabilityCheckFailedError);
          assert(err instanceof MitosisError);
          assert(err.netReturnUsd < 0);
          return true;
        }
      );

      const actions = db.getActions(10, 'mitosis');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'MITOSIS_VIABILITY_FAILED');
    });

    it('T-MIT-14: should execute successful mitosis at $150.00, whitelisting child, transferring $50, and recording double-entry SQLite records', async () => {
      wallet.setMockBalance('base', 100.0);
      wallet.setMockBalance('polygon', 50.0); // Total $150.00

      const res = await executeMitosis({
        wallet,
        database: db,
        viabilityConfig: { steps: 30, seed: 9999 },
      });

      assert.equal(res.success, true);
      assert.equal(res.seedCapitalUsd, 50.0);
      assert.equal(res.motherRemainingBalanceUsd, 100.0);
      assert(wallet.isWhitelisted(res.childAddress));

      // Verify double-entry ledger in database
      const ledger = db.getLedgerEntries(10);
      assert(ledger.some((e) => e.entryType === 'SEED_CAPITAL' && e.amount === 50.0));

      // Verify lineage table
      const lineage = db.getLineageByChild(res.childAddress);
      assert.notEqual(lineage, null);
      assert.equal(lineage?.seedCapitalUsd, 50.0);
      assert.equal(lineage?.totalRoyaltiesPaidUsd, 0.0);
      assert.equal(lineage?.status, 'ACTIVE');

      // Verify actions audit table
      const actions = db.getActions(10, 'mitosis');
      assert(actions.some((a) => a.actionType === 'MITOSIS_SPAWN_SUCCESS'));
    });
  });

  // ============================================================================
  // Suite 5: High-Water Mark 5% Royalty Accounting Engine
  // ============================================================================
  describe('5. High-Water Mark 5% Royalty Accounting Engine', () => {
    it('T-MIT-15: should calculate exact 5% royalty on positive profit with 6-decimal precision', () => {
      assert.equal(calculateRoyalty(100.0), 5.0);
      assert.equal(calculateRoyalty(50.0), 2.5);
      assert.equal(calculateRoyalty(0.33), 0.0165);
      assert.equal(calculateRoyalty(0.0), 0.0);
      assert.equal(calculateRoyalty(-50.0), 0.0);
    });

    it('T-MIT-16: should throw ConstitutionViolationError if royalty percentage is not exactly 0.05', () => {
      assert.throws(
        () => calculateRoyalty(100.0, 0.10),
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          return true;
        }
      );
    });

    it('T-MIT-17: should throw TypeError if netProfit is NaN or non-number', () => {
      assert.throws(() => calculateRoyalty(NaN), TypeError);
      assert.throws(() => calculateRoyalty('100' as any), TypeError);
    });

    it('T-MIT-18: should provide drawdown immunity and prevent double-taxation via High-Water Mark accounting', async () => {
      const childAddress = '0x2222222222222222222222222222222222222222';
      const motherAddress = wallet.getAddress();

      // Register child in lineage
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      // Child wallet balance $100.00
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      // --- Cycle 1: Profit wave ($100 revenue, $10 expense = $90 net profit) ---
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: Date.now(),
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 10.0,
        entryType: 'EXPENSE_GAS',
        timestamp: Date.now(),
      });

      let eval1 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(eval1.cumulativeNetProfitUsd, 90.0);
      assert.equal(eval1.cumulativeObligationUsd, 4.5); // 5% of $90
      assert.equal(eval1.totalRoyaltiesPaidUsd, 0.0);
      assert.equal(eval1.pendingRoyaltyUsd, 4.5);
      assert.equal(eval1.shouldRemit, true);

      // Remit $4.50
      const remit1 = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
      });
      assert.equal(remit1.remitted, true);
      assert.equal(remit1.royaltyAmountUsd, 4.5);

      // Post-remittance check: pending should now be $0.00
      let evalPost1 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalPost1.pendingRoyaltyUsd, 0.0);
      assert.equal(evalPost1.shouldRemit, false);

      // --- Cycle 2: Drawdown loss ($20 gas/LLM loss, profit drops to $70) ---
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 20.0,
        entryType: 'EXPENSE_LLM',
        timestamp: Date.now(),
      });

      let evalDrawdown = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalDrawdown.cumulativeNetProfitUsd, 70.0);
      assert.equal(evalDrawdown.cumulativeObligationUsd, 3.5);
      assert.equal(evalDrawdown.totalRoyaltiesPaidUsd, 4.5);
      assert.equal(evalDrawdown.pendingRoyaltyUsd, 0.0); // Immune during drawdown!
      assert.equal(evalDrawdown.shouldRemit, false);

      // --- Cycle 3: Partial recovery ($15 income, net profit rises to $85, still below previous peak $90) ---
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 15.0,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });

      let evalRecovery = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalRecovery.cumulativeNetProfitUsd, 85.0);
      assert.equal(evalRecovery.cumulativeObligationUsd, 4.25);
      assert.equal(evalRecovery.totalRoyaltiesPaidUsd, 4.5);
      assert.equal(evalRecovery.pendingRoyaltyUsd, 0.0); // Zero due!
      assert.equal(evalRecovery.shouldRemit, false);

      // --- Cycle 4: New high-water mark ($35 income, net profit reaches $120.00) ---
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 35.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      let evalPeak = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalPeak.cumulativeNetProfitUsd, 120.0);
      assert.equal(evalPeak.cumulativeObligationUsd, 6.0); // 5% of $120
      assert.equal(evalPeak.totalRoyaltiesPaidUsd, 4.5);
      assert.equal(evalPeak.pendingRoyaltyUsd, 1.5); // Exactly $1.50 incremental due!
      assert.equal(evalPeak.shouldRemit, true);

      // Remit $1.50
      const remitPeak = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
      });
      assert.equal(remitPeak.remitted, true);
      assert.equal(remitPeak.royaltyAmountUsd, 1.5);
      assert.equal(remitPeak.totalRoyaltiesPaidUsd, 6.0);
    });

    it('T-MIT-19: should defer remittance when liquid balance violates cash-flow solvency buffer ($15.00)', async () => {
      const childAddress = '0x3333333333333333333333333333333333333333';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      // Child has low balance: $12.00 (< $15.00 safe buffer)
      wallet.setMockBalance('base', 6.0);
      wallet.setMockBalance('polygon', 6.0);

      // Net profit = $100 -> obligation $5.00
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: Date.now(),
      });

      const evalStatus = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalStatus.hasProfits, true);
      assert.equal(evalStatus.isSolventForRemittance, false);
      assert.equal(evalStatus.shouldRemit, false);
      assert.equal(evalStatus.reason, 'DEFERRED_INSUFFICIENT_FREE_SURPLUS');

      const remitRes = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
      });
      assert.equal(remitRes.remitted, false);
      assert.equal(remitRes.royaltyAmountUsd, 0.0);
    });

    it('T-MIT-20: should defer dust remittance (< $0.50) unless force=true is set', async () => {
      const childAddress = '0x4444444444444444444444444444444444444444';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      // Net profit = $5.00 -> 5% obligation = $0.25 (< $0.50 dust)
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5.0,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });

      const evalStatus = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evalStatus.hasProfits, true);
      assert.equal(evalStatus.pendingRoyaltyUsd, 0.25);
      assert.equal(evalStatus.shouldRemit, false);
      assert.equal(evalStatus.reason, 'DEFERRED_BELOW_DUST_THRESHOLD');

      // Attempt normal remittance -> deferred
      const normalRes = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
      });
      assert.equal(normalRes.remitted, false);

      // Attempt forced remittance -> executed
      const forcedRes = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
        force: true,
      });
      assert.equal(forcedRes.remitted, true);
      assert.equal(forcedRes.royaltyAmountUsd, 0.25);
    });
  });

  // ============================================================================
  // Suite 6: Constitutional Hyperparameter Mutation Engine
  // ============================================================================
  describe('6. Constitutional Hyperparameter Mutation Engine', () => {
    const parentParams: ChildHyperparameters = {
      kellyFraction: 0.25,
      maxBankrollCap: 0.05,
      heartbeatGreenMs: 60000,
      heartbeatYellowMs: 300000,
      minBountyRewardUsd: 10.0,
      x402PriceUsdc: 0.05,
      polymarketMinEvEdge: 0.01,
      strategyFocus: 'BALANCED',
    };

    it('T-MIT-21: should strictly clamp mutated kellyFraction <= 0.25 (Quarter-Kelly ceiling)', () => {
      // Test with aggressive upward PRNG
      const aggressiveRand = () => 0.9999;
      const mutated = mutateHyperparameters(parentParams, aggressiveRand);

      assert(mutated.kellyFraction <= 0.25, `Kelly ${mutated.kellyFraction} must be <= 0.25`);
      assert(mutated.maxBankrollCap <= 0.05, `Cap ${mutated.maxBankrollCap} must be <= 0.05`);
    });

    it('T-MIT-22: should throw ConstitutionViolationError if kellyFraction > 0.25 is proposed', () => {
      assert.throws(
        () => validateConstitutionalBounds({ ...parentParams, kellyFraction: 0.30 }),
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          assert(err.message.includes('Article II.1'));
          return true;
        }
      );
    });

    it('T-MIT-23: should throw ConstitutionViolationError if maxBankrollCap > 0.05 is proposed', () => {
      assert.throws(
        () => validateConstitutionalBounds({ ...parentParams, maxBankrollCap: 0.06 }),
        (err: Error) => {
          assert(err instanceof ConstitutionViolationError);
          assert(err.message.includes('Article II.2'));
          return true;
        }
      );
    });

    it('T-MIT-24: should generate a complete valid child AppConfig via createChildSpawnConfig', () => {
      const parentConfig = loadConfig();
      const childWallet = deriveChildSubWallet(validParentKey, 1, 2);
      const mutated = mutateHyperparameters(parentParams);

      const childConfig = createChildSpawnConfig(
        parentConfig,
        childWallet.address,
        childWallet.privateKey,
        1,
        2,
        mutated
      );

      assert.equal(childConfig.privateKey, childWallet.privateKey);
      assert.equal(childConfig.kelly.fraction, mutated.kellyFraction);
      assert.equal(childConfig.kelly.maxBankrollCap, mutated.maxBankrollCap);
      assert.equal(childConfig.evolution.royaltyPercentage, CONSTITUTIONAL_ROYALTY_PERCENTAGE);
      assert.equal(childConfig.mock.initialBalanceUsd, 50.0);
    });
  });

  // ============================================================================
  // Suite 7: HeartbeatDaemon Integration Hook
  // ============================================================================
  describe('7. HeartbeatDaemon Integration Hook', () => {
    it('T-MIT-25: should skip mitosis and royalty checks when tier is not VERDE', async () => {
      const res = await executeMitosisLifecycleTick({
        database: db,
        wallet,
        config: loadConfig(),
        currentTier: 'AMARELO',
        cycleCount: 1,
      });

      assert.deepEqual(res, {});
    });

    it('T-MIT-26: should trigger royalty remittance in Tier Verde for child agent', async () => {
      const motherAddress = '0x9999999999999999999999999999999999999999';
      registerChildLineage(db, wallet.getAddress(), motherAddress, 2, 50.0);

      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: Date.now(),
      });

      const config = loadConfig({ MOTHER_WALLET_ADDRESS: motherAddress });

      const res = await executeMitosisLifecycleTick({
        database: db,
        wallet,
        config,
        currentTier: 'VERDE',
        cycleCount: 1,
        isChildAgent: true,
      });

      assert.notEqual(res.royaltyResult, undefined);
      assert.equal(res.royaltyResult?.remitted, true);
      assert.equal(res.royaltyResult?.royaltyAmountUsd, 5.0);
    });
  });
});
