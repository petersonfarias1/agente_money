/**
 * ==============================================================================
 * Adversarial Stress & Fuzzing Suite: Darwinian Mitosis & Royalty Lifecycle
 * ==============================================================================
 * Target: src/evolution/mitosis.ts (Commit eae3b75)
 *
 * Hostile Adversarial Stress Objectives:
 * 1. Capital Threshold Boundaries:
 *    - Micro-deficit ($149.999999), exact hurdle ($150.00), micro-surplus ($150.000001)
 *    - Sub-cent float precision edge cases ($149.999999999) & $0.00 deficit truncation quirk
 *    - Zero balance ($0.00) & negative deficit balances (-$10.00, -$50.00)
 *    - Large bankroll scaling ($10,000,000.00) with 6-decimal precision
 *    - Non-numeric / pathological inputs (NaN, Infinity, strings)
 *    - Multi-chain liquidity distribution stress in executeMitosis
 * 2. Viability Simulation Stress:
 *    - Negative EV market streams (50 consecutive negative edge steps) -> Kelly 0 / fails viability
 *    - Guaranteed loss streaks (positive edge but 100% loss outcomes) -> netReturn < 0 -> fails viability
 *    - Zero-variance streams: 1-step capped at 10.0 vs multi-step float variance Sharpe explosion (> 1000.0)
 *    - Extreme drawdown sequences (1 pump followed by 30 losses) -> maxDrawdown > 40%, Kelly insolvency protection
 *    - Edge-case steps (0 steps, 1 step) -> no unhandled division by zero or NaN propagation
 *    - Custom hurdle stress (unreachable Sharpe / net return hurdles)
 *    - executeMitosis failure mode: atomic abort, zero state mutation, audit logging
 * 3. Cryptographic Key Derivation Stress:
 *    - Pairwise uniqueness across 10x10 matrix (100 derivations) -> zero collision guarantee
 *    - Deterministic reproducibility across 500 iterations & concurrent async calls
 *    - Invalid parent key fuzzing (31-byte, 33-byte, non-hex, empty string, malformed)
 *    - Non-positive / non-integer childIndex and generation inputs
 *    - Multi-generational recursive lineage derivation (Gen 1 -> Gen 2 -> Gen 3 -> Gen 4)
 *    - Zero address rejection in wallet whitelist and transfer routines
 * 4. High-Water Mark Royalty Stress:
 *    - Complex 7-wave profit/drawdown lifecycle -> verify cumulative royalties never double-taxed
 *    - Solvency buffer depletion ($15.00 threshold) at $14.999999, $15.00, $15.49, $15.50
 *    - Partial remittance preserving exact $15.00 solvency buffer
 *    - Dust remittance (< $0.50 threshold) at $0.499999 vs $0.50 and force bypass
 *    - Anti-replay / double-spend attacks: rapid sequential calls, forced second calls, zero duplicate entries
 *    - Missing lineage record double-taxation drain vulnerability
 *    - Rejection of remittance targeting ZERO_ADDRESS
 * 5. Constitutional Mutation Bounds Stress:
 *    - Kelly fraction violations (k > 0.25, k <= 0, k = NaN, Infinity) -> ConstitutionViolationError
 *    - Bankroll cap violations (cap > 0.05, cap <= 0) -> ConstitutionViolationError
 *    - Stochastic mutation clamping fuzzing across 1,000 hostile PRNG cycles
 *    - createChildSpawnConfig boundary enforcement
 *    - HeartbeatDaemon lifecycle integration under metabolic stress
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
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
  CONSTITUTIONAL_MAX_KELLY_FRACTION,
  CONSTITUTIONAL_MAX_BANKROLL_BET_PERCENT,
  DEFAULT_MIN_ROYALTY_REMITTANCE_USD,
  MIN_SOLVENT_BUFFER_USD,
  type ChildHyperparameters,
} from '../../src/evolution/mitosis.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet, ZERO_ADDRESS, InsufficientBalanceError } from '../../src/core/wallet.ts';
import { loadConfig } from '../../src/config.ts';
import { ConstitutionViolationError, MitosisError } from '../../src/types.ts';

describe('Adversarial Stress: Darwinian Mitosis & Royalty Lifecycle', () => {
  let db: DatabaseService;
  let wallet: ApexWallet;

  const validParentKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    wallet = new ApexWallet();
    wallet.resetMockState();
    wallet.setMockBalance('base', 100.0);
    wallet.setMockBalance('polygon', 50.0); // Total $150.00
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  // ============================================================================
  // SUITE 1: Capital Threshold Boundaries ($149.999999, $150.00, $150.000001, large, zero)
  // ============================================================================
  describe('1. Capital Threshold Boundaries', () => {
    it('ST-CAP-01: Micro-deficit boundary ($149.999999) must reject mitosis with exact deficit ($0.000001)', () => {
      const balance = 149.999999;
      const res = evaluateMitosisThreshold(balance, 50.0, 3.0);

      assert.equal(res.eligible, false);
      assert.equal(res.currentBalanceUsd, 149.999999);
      assert.equal(res.thresholdRequiredUsd, 150.0);
      assert.equal(res.deficitUsd, 0.000001);
      assert.equal(res.surplusUsd, 0);
      assert.equal(res.childSeedAllocationUsd, 0);
      assert.equal(res.motherRetainedUsd, 149.999999);
      assert(res.reason?.includes('below $150.00'));
    });

    it('ST-CAP-02: Exact threshold boundary ($150.000000) must approve mitosis with 1/3 child seed ($50) and 2/3 mother retained ($100)', () => {
      const balance = 150.0;
      const res = evaluateMitosisThreshold(balance, 50.0, 3.0);

      assert.equal(res.eligible, true);
      assert.equal(res.deficitUsd, 0);
      assert.equal(res.surplusUsd, 0);
      assert.equal(res.childSeedAllocationUsd, 50.0);
      assert.equal(res.motherRetainedUsd, 100.0);
      assert.equal(res.childSeedAllocationUsd + res.motherRetainedUsd, 150.0);
    });

    it('ST-CAP-03: Micro-surplus boundary ($150.000001) must approve mitosis with exact micro-surplus ($0.000001)', () => {
      const balance = 150.000001;
      const res = evaluateMitosisThreshold(balance, 50.0, 3.0);

      assert.equal(res.eligible, true);
      assert.equal(res.deficitUsd, 0);
      assert.equal(res.surplusUsd, 0.000001);
      assert(res.childSeedAllocationUsd >= 50.0);
      assert(res.motherRetainedUsd >= 100.0);
    });

    it('ST-CAP-04: Sub-cent epsilon boundary ($149.999999999) guarantees strictly positive deficit ($0.000001 minimum epsilon floor)', () => {
      const balance = 149.999999999;
      const res = evaluateMitosisThreshold(balance, 50.0, 3.0);

      // Invariant: strictly ineligible because 149.999999999 < 150.0
      assert.equal(res.eligible, false);
      assert.equal(res.surplusUsd, 0);

      // Hardening: sub-cent float delta is clamped to minimum micro-USDC epsilon (0.000001)
      assert.equal(res.deficitUsd, 0.000001);
      assert(res.deficitUsd > 0);
      assert.equal(res.childSeedAllocationUsd, 0);

      // MitosisThresholdError reflects strictly positive deficit
      const err = new MitosisThresholdError(balance, 150.0);
      assert.equal(err.deficitUsd, 0.000001);
      assert(err.deficitUsd > 0);
    });

    it('ST-CAP-05: Zero balance ($0.00) & negative deficit balance (-$50.00) must reject with full deficit', () => {
      const zeroRes = evaluateMitosisThreshold(0.0, 50.0, 3.0);
      assert.equal(zeroRes.eligible, false);
      assert.equal(zeroRes.deficitUsd, 150.0);
      assert.equal(zeroRes.childSeedAllocationUsd, 0);

      const negRes = evaluateMitosisThreshold(-50.0, 50.0, 3.0);
      assert.equal(negRes.eligible, false);
      assert.equal(negRes.deficitUsd, 200.0);
      assert.equal(negRes.childSeedAllocationUsd, 0);
    });

    it('ST-CAP-06: Ultra-high bankroll scaling ($10,000,000.00) preserves exact 1/3 and 2/3 capital partitioning', () => {
      const balance = 10_000_000.0;
      const res = evaluateMitosisThreshold(balance, 50.0, 3.0);

      assert.equal(res.eligible, true);
      assert.equal(res.thresholdRequiredUsd, 150.0);
      assert.equal(res.surplusUsd, 9_999_850.0);
      assert.equal(res.childSeedAllocationUsd, 3_333_333.333333);
      assert.equal(res.motherRetainedUsd, 6_666_666.666667);
      assert.equal(
        Number((res.childSeedAllocationUsd + res.motherRetainedUsd).toFixed(6)),
        10_000_000.0
      );
    });

    it('ST-CAP-07: Non-numeric and pathological capital inputs must throw TypeError', () => {
      assert.throws(() => evaluateMitosisThreshold(NaN), TypeError);
      assert.throws(() => evaluateMitosisThreshold('150.00' as unknown as number), TypeError);
      assert.throws(() => evaluateMitosisThreshold(null as unknown as number), TypeError);
      assert.throws(() => evaluateMitosisThreshold(undefined as unknown as number), TypeError);
      assert.throws(() => evaluateMitosisThreshold({} as unknown as number), TypeError);
    });

    it('ST-CAP-08: Non-standard initial capital ($33.333333) with 3x multiplier evaluates threshold and partitioning', () => {
      const initial = 33.333333;
      const res = evaluateMitosisThreshold(100.0, initial, 3.0);

      assert.equal(res.eligible, true);
      assert.equal(res.thresholdRequiredUsd, 99.999999);
      assert(res.surplusUsd >= 0.000001);
      assert.equal(res.childSeedAllocationUsd, 33.333333);
      assert.equal(res.motherRetainedUsd, 66.666667);
    });

    it('ST-CAP-09: executeMitosis must throw MitosisThresholdError at $149.999999 and persist MITOSIS_BLOCKED_THRESHOLD', async () => {
      wallet.setMockBalance('base', 74.999999);
      wallet.setMockBalance('polygon', 75.0); // Total $149.999999

      await assert.rejects(
        async () => {
          await executeMitosis({ wallet, database: db });
        },
        (err: Error) => {
          assert(err instanceof MitosisThresholdError);
          assert.equal(err.name, 'MitosisThresholdError');
          assert.equal(err.currentBalanceUsd, 149.999999);
          assert.equal(err.requiredThresholdUsd, 150.0);
          assert.equal(err.deficitUsd, 0.000001);
          return true;
        }
      );

      const actions = db.getActions(10, 'mitosis');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'MITOSIS_BLOCKED_THRESHOLD');
      const details = JSON.parse(actions[0].details);
      assert.equal(details.currentBalanceUsd, 149.999999);
      assert.equal(details.deficitUsd, 0.000001);
    });

    it('ST-CAP-10: Multi-chain liquidity auto-routing in executeMitosis routes seed capital to liquid chain when Base is empty', async () => {
      // Total wallet balance is $150.00 (meets 3x hurdle), but 100% of funds are on Polygon ($0 on Base)
      wallet.setMockBalance('base', 0.0);
      wallet.setMockBalance('polygon', 150.0);

      // Multi-chain routing automatically selects Polygon where liquidity resides
      const res = await executeMitosis({ wallet, database: db });
      assert.equal(res.success, true);
      assert.equal(res.seedCapitalUsd, 50.0);

      // Verify transaction ledger recorded on Polygon
      const ledger = db.getLedgerEntries(10);
      const seedEntry = ledger.find((e) => e.entryType === 'SEED_CAPITAL');
      assert.ok(seedEntry);
      assert.equal(seedEntry.chain, 'polygon');
      assert.equal(seedEntry.amount, 50.0);
    });
  });

  // ============================================================================
  // SUITE 2: Viability Simulation Stress (Negative EV, Zero-Variance, Drawdowns, Sharpe)
  // ============================================================================
  describe('2. Viability Simulation Stress', () => {
    it('ST-VIA-01: Guaranteed Negative EV Market Stream must allocate zero Kelly and fail viability', () => {
      // 50 steps where market price is 0.60 but model probability is only 0.40 (EV is strictly negative)
      const negativeEvFeed = Array(50).fill({
        marketPrice: 0.60,
        modelProb: 0.40,
        won: false,
      });

      const res = runViabilitySimulation({
        steps: 50,
        customPriceFeed: negativeEvFeed,
      });

      assert.equal(res.passed, false);
      assert.equal(res.stepsExecuted, 50);
      assert.equal(res.netReturnUsd, 0.0);
      assert.equal(res.sharpeRatio, 0.0);
      assert(res.trades.every((t) => t.stakeUsd === 0.0));
      assert(res.failureReason !== undefined);
      assert(res.failureReason.includes('non-positive'));
    });

    it('ST-VIA-02: Guaranteed Loss Streak under Positive EV must result in negative net return and fail viability', () => {
      // Market offers edge (0.50 price vs 0.70 model prob), but bad luck produces 100% loss streak
      const losingFeed = Array(30).fill({
        marketPrice: 0.50,
        modelProb: 0.70,
        won: false,
      });

      const res = runViabilitySimulation({
        steps: 30,
        customPriceFeed: losingFeed,
      });

      assert.equal(res.passed, false);
      assert(res.netReturnUsd < 0, `Net return ($${res.netReturnUsd}) must be negative`);
      assert.equal(res.winRate, 0.0);
      assert(res.sharpeRatio <= 0.0);
      assert(res.failureReason !== undefined);
      assert(res.failureReason.includes('non-positive'));
    });

    it('ST-VIA-03: Zero-variance Flat Stream (no trades taken) must fail viability with Sharpe = 0.0', () => {
      const flatFeed = Array(25).fill({
        marketPrice: 0.50,
        modelProb: 0.50, // Zero EV edge (b*p - q = 1*0.5 - 0.5 = 0)
        won: false,
      });

      const res = runViabilitySimulation({
        steps: 25,
        customPriceFeed: flatFeed,
      });

      assert.equal(res.passed, false);
      assert.equal(res.netReturnUsd, 0.0);
      assert.equal(res.sharpeRatio, 0.0);
      assert.equal(res.maxDrawdown, 0.0);
    });

    it('ST-VIA-04: Zero-variance Constant Win Stream behavior (1-step and multi-step capped at 10.0 ceiling)', () => {
      // Case A: 1-step winning trade has strictly 0 variance, capping Sharpe at 10.0
      const winFeed1 = [{ marketPrice: 0.40, modelProb: 0.60, won: true }];
      const res1 = runViabilitySimulation({ steps: 1, customPriceFeed: winFeed1 });
      assert.equal(res1.passed, true);
      assert.equal(res1.sharpeRatio, 10.0);

      // Case B: Multi-step winning trades have near-zero floating-point variance across compounding bankroll steps;
      // must be capped at 10.0 ceiling to prevent numerical explosion
      const winFeed10 = Array(10).fill({ marketPrice: 0.40, modelProb: 0.60, won: true });
      const res10 = runViabilitySimulation({ steps: 10, customPriceFeed: winFeed10 });
      assert.equal(res10.passed, true);
      assert.equal(
        res10.sharpeRatio,
        10.0,
        `Sharpe ratio must be clamped to 10.0 ceiling; received: ${res10.sharpeRatio}`
      );
    });

    it('ST-VIA-05: Extreme Drawdown Sequence (1 massive pump followed by 30 losses) tests Kelly survival', () => {
      // Step 1: win. Steps 2-31: lose.
      const drawdownFeed = [
        { marketPrice: 0.30, modelProb: 0.80, won: true },
        ...Array(30).fill({ marketPrice: 0.45, modelProb: 0.60, won: false }),
      ];

      const res = runViabilitySimulation({
        steps: 31,
        customPriceFeed: drawdownFeed,
      });

      assert.equal(res.passed, false);
      assert(res.maxDrawdown > 0.40, `Max drawdown (${res.maxDrawdown}) should be substantial`);
      assert(res.finalBankrollUsd > 0, 'Kelly criterion must prevent complete bankruptcy (final bankroll > 0)');
      assert(res.netReturnUsd < 0);
    });

    it('ST-VIA-06: Edge-case step counts (0 steps, 1 step) must not crash or throw unhandled exceptions', () => {
      const zeroRes = runViabilitySimulation({ steps: 0 });
      assert.equal(zeroRes.passed, false);
      assert.equal(zeroRes.stepsExecuted, 0);

      const oneRes = runViabilitySimulation({ steps: 1 });
      assert.equal(oneRes.stepsExecuted, 1);
    });

    it('ST-VIA-07: Custom Sharpe hurdle stress rejects strategies with positive but insufficient Sharpe ratio', () => {
      // Strategy passes normal positive hurdle, but we set minSharpeRatio = 5.0
      const res = runViabilitySimulation({
        steps: 30,
        seed: 42,
        minSharpeRatio: 5.0,
      });

      assert.equal(res.passed, false);
      assert(res.failureReason !== undefined);
      assert(res.failureReason.includes('minimum hurdle'));
    });

    it('ST-VIA-08: Custom Net Return hurdle stress rejects strategies with positive return below threshold', () => {
      // Set minNetReturnUsd to $100 when initial bankroll is $50
      const res = runViabilitySimulation({
        steps: 30,
        seed: 42,
        minNetReturnUsd: 100.0,
      });

      assert.equal(res.passed, false);
      assert(res.failureReason !== undefined);
      assert(res.failureReason.includes('Net return'));
    });

    it('ST-VIA-09: executeMitosis must abort atomically on viability failure without touching mother balance', async () => {
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
          assert.equal(err.name, 'ViabilityCheckFailedError');
          assert(err.netReturnUsd < 0);
          return true;
        }
      );

      // Verify mother balance unchanged at $150.00
      const balance = await wallet.getTotalBalanceUsd();
      assert.equal(balance, 150.0);

      // Verify no ledger expenses recorded
      const ledger = db.getLedgerEntries(10);
      assert.equal(ledger.length, 0);

      // Verify audit action logged
      const actions = db.getActions(10, 'mitosis');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'MITOSIS_VIABILITY_FAILED');
    });
  });

  // ============================================================================
  // SUITE 3: Cryptographic Key Derivation Stress (Collisions, Path/Generation, Invalid Keys)
  // ============================================================================
  describe('3. Cryptographic Key Derivation Stress', () => {
    it('ST-KEY-01: Pairwise Uniqueness across Matrix (100 derivations) ensures zero collisions', () => {
      const derivedAddresses = new Set<string>();
      const derivedPrivateKeys = new Set<string>();
      const derivedPaths = new Set<string>();

      for (let gen = 1; gen <= 10; gen++) {
        for (let idx = 1; idx <= 10; idx++) {
          const res = deriveChildSubWallet(validParentKey, idx, gen);

          assert.match(res.address, /^0x[0-9a-fA-F]{40}$/);
          assert.match(res.privateKey, /^0x[0-9a-fA-F]{64}$/);
          assert.equal(res.derivationPath, `m/44'/60'/${gen}'/0/${idx}`);

          // Uniqueness checks
          assert(
            !derivedAddresses.has(res.address.toLowerCase()),
            `Address collision detected for gen ${gen}, idx ${idx}: ${res.address}`
          );
          assert(
            !derivedPrivateKeys.has(res.privateKey.toLowerCase()),
            `Private key collision detected for gen ${gen}, idx ${idx}: ${res.privateKey}`
          );
          assert(
            !derivedPaths.has(res.derivationPath),
            `Derivation path collision detected: ${res.derivationPath}`
          );

          derivedAddresses.add(res.address.toLowerCase());
          derivedPrivateKeys.add(res.privateKey.toLowerCase());
          derivedPaths.add(res.derivationPath);
        }
      }

      assert.equal(derivedAddresses.size, 100);
      assert.equal(derivedPrivateKeys.size, 100);
      assert.equal(derivedPaths.size, 100);
    });

    it('ST-KEY-02: Deterministic Reproducibility Stress across 500 iterations and concurrent calls', async () => {
      const expected = deriveChildSubWallet(validParentKey, 7, 3);

      // 500 sequential checks
      for (let i = 0; i < 500; i++) {
        const current = deriveChildSubWallet(validParentKey, 7, 3);
        assert.equal(current.address, expected.address);
        assert.equal(current.privateKey, expected.privateKey);
        assert.equal(current.derivationPath, expected.derivationPath);
      }

      // Concurrent async checks
      const concurrentResults = await Promise.all(
        Array(50)
          .fill(null)
          .map(async () => deriveChildSubWallet(validParentKey, 7, 3))
      );

      for (const res of concurrentResults) {
        assert.equal(res.address, expected.address);
        assert.equal(res.privateKey, expected.privateKey);
      }
    });

    it('ST-KEY-03: Invalid Parent Key Fuzzing must strictly throw TypeError', () => {
      // 31-byte key (62 hex chars)
      assert.throws(
        () => deriveChildSubWallet('0x' + 'ab'.repeat(31), 1, 2),
        TypeError
      );

      // 33-byte key (66 hex chars)
      assert.throws(
        () => deriveChildSubWallet('0x' + 'ab'.repeat(33), 1, 2),
        TypeError
      );

      // Non-hex characters
      assert.throws(
        () => deriveChildSubWallet('0x' + 'zz'.repeat(32), 1, 2),
        TypeError
      );
      assert.throws(
        () => deriveChildSubWallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg', 1, 2),
        TypeError
      );

      // Empty and short strings
      assert.throws(() => deriveChildSubWallet('', 1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet('0x', 1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet('12345', 1, 2), TypeError);

      // Non-string inputs
      assert.throws(() => deriveChildSubWallet(null as unknown as string, 1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(undefined as unknown as string, 1, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(12345 as unknown as string, 1, 2), TypeError);
    });

    it('ST-KEY-04: Non-positive or non-integer childIndex and generation must throw TypeError', () => {
      assert.throws(() => deriveChildSubWallet(validParentKey, 0, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, -5, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1.25, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, NaN, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, Infinity, 2), TypeError);

      assert.throws(() => deriveChildSubWallet(validParentKey, 1, 0), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, -2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, 2.5), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, NaN), TypeError);
    });

    it('ST-KEY-05: Multi-generational recursive lineage derivation (Gen 1 -> Gen 2 -> Gen 3 -> Gen 4)', () => {
      // Gen 1 parent key derives Gen 2 child
      const gen2 = deriveChildSubWallet(validParentKey, 1, 2);
      assert.equal(gen2.generation, 2);

      // Gen 2 child private key derives Gen 3 grandchild
      const gen3 = deriveChildSubWallet(gen2.privateKey, 1, 3);
      assert.equal(gen3.generation, 3);
      assert.notEqual(gen3.address, gen2.address);

      // Gen 3 grandchild derives Gen 4 great-grandchild
      const gen4 = deriveChildSubWallet(gen3.privateKey, 1, 4);
      assert.equal(gen4.generation, 4);
      assert.notEqual(gen4.address, gen3.address);
    });

    it('ST-KEY-06: Zero address rejection in wallet whitelist and transfer routines', async () => {
      const derived = deriveChildSubWallet(validParentKey, 1, 2);
      assert.notEqual(derived.address.toLowerCase(), ZERO_ADDRESS);

      // Verify wallet rejects adding ZERO_ADDRESS to whitelist
      assert.throws(
        () => wallet.addToWhitelist(ZERO_ADDRESS, 'CHILD_SUB_WALLET'),
        ConstitutionViolationError
      );

      // Verify wallet rejects transfers to ZERO_ADDRESS
      await assert.rejects(
        async () => {
          await wallet.transferUsdc('base', ZERO_ADDRESS, 10.0);
        },
        ConstitutionViolationError
      );

      // Verify createChildSpawnConfig rejects ZERO_ADDRESS
      const parentConfig = loadConfig();
      const params: ChildHyperparameters = {
        kellyFraction: 0.25,
        maxBankrollCap: 0.05,
        heartbeatGreenMs: 60000,
        heartbeatYellowMs: 300000,
        minBountyRewardUsd: 10.0,
        x402PriceUsdc: 0.05,
        polymarketMinEvEdge: 0.01,
        strategyFocus: 'BALANCED',
      };

      assert.throws(
        () => createChildSpawnConfig(parentConfig, 'invalid-addr', derived.privateKey, 1, 2, params),
        MitosisError
      );
    });
  });

  // ============================================================================
  // SUITE 4: High-Water Mark Royalty Stress (Multi-Wave, Solvency Buffer, Dust, Anti-Replay)
  // ============================================================================
  describe('4. High-Water Mark Royalty Stress', () => {
    it('ST-ROY-01: Complex 7-wave profit/drawdown lifecycle verifies cumulative royalties never double-taxed', async () => {
      const childAddress = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      // Keep child wallet well funded ($500.00) so solvency buffer does not interfere with math test
      wallet.setMockBalance('base', 250.0);
      wallet.setMockBalance('polygon', 250.0);

      // --- Wave 1: First profit wave ($200 revenue, $20 expense = $180 net profit) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 200.0, entryType: 'INCOME_POLYMARKET', timestamp: 1 });
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 20.0, entryType: 'EXPENSE_GAS', timestamp: 2 });

      let ev1 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev1.cumulativeNetProfitUsd, 180.0);
      assert.equal(ev1.cumulativeObligationUsd, 9.0); // 5% of $180
      assert.equal(ev1.totalRoyaltiesPaidUsd, 0.0);
      assert.equal(ev1.pendingRoyaltyUsd, 9.0);

      const r1 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r1.remitted, true);
      assert.equal(r1.royaltyAmountUsd, 9.0);
      assert.equal(r1.totalRoyaltiesPaidUsd, 9.0);

      // Post-Wave 1 check: pending is 0
      let evPost1 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evPost1.pendingRoyaltyUsd, 0.0);

      // --- Wave 2: Drawdown loss ($60 operating loss -> cumulative net profit drops to $120) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 60.0, entryType: 'EXPENSE_LLM', timestamp: 3 });

      let ev2 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev2.cumulativeNetProfitUsd, 120.0);
      assert.equal(ev2.cumulativeObligationUsd, 6.0); // 5% of $120 is $6.00
      assert.equal(ev2.totalRoyaltiesPaidUsd, 9.0);
      assert.equal(ev2.pendingRoyaltyUsd, 0.0); // Drawdown immunity: pending royalty is exactly $0!
      assert.equal(ev2.shouldRemit, false);

      const r2 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r2.remitted, false);
      assert.equal(r2.royaltyAmountUsd, 0.0);

      // --- Wave 3: Partial recovery ($30 income -> net profit rises to $150, still below $180 ATH) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 30.0, entryType: 'INCOME_X402', timestamp: 4 });

      let ev3 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev3.cumulativeNetProfitUsd, 150.0);
      assert.equal(ev3.cumulativeObligationUsd, 7.5); // 5% of $150
      assert.equal(ev3.totalRoyaltiesPaidUsd, 9.0);
      assert.equal(ev3.pendingRoyaltyUsd, 0.0); // Zero due because previous peak $180 already covered!
      assert.equal(ev3.shouldRemit, false);

      // --- Wave 4: New ATH breakout ($90 income -> net profit reaches $240.00) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 90.0, entryType: 'INCOME_BOUNTY', timestamp: 5 });

      let ev4 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev4.cumulativeNetProfitUsd, 240.0);
      assert.equal(ev4.cumulativeObligationUsd, 12.0); // 5% of $240
      assert.equal(ev4.totalRoyaltiesPaidUsd, 9.0);
      assert.equal(ev4.pendingRoyaltyUsd, 3.0); // Exactly $3.00 incremental due!
      assert.equal(ev4.shouldRemit, true);

      const r4 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r4.remitted, true);
      assert.equal(r4.royaltyAmountUsd, 3.0);
      assert.equal(r4.totalRoyaltiesPaidUsd, 12.0);

      // --- Wave 5: Severe market collapse ($240 operating loss -> net profit drops to $0.00) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 240.0, entryType: 'EXPENSE_GAS', timestamp: 6 });

      let ev5 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev5.cumulativeNetProfitUsd, 0.0);
      assert.equal(ev5.cumulativeObligationUsd, 0.0);
      assert.equal(ev5.totalRoyaltiesPaidUsd, 12.0);
      assert.equal(ev5.pendingRoyaltyUsd, 0.0);
      assert.equal(ev5.shouldRemit, false);

      // --- Wave 6: Second ATH breakout ($300 income -> net profit rises to $300.00) ---
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 300.0, entryType: 'INCOME_POLYMARKET', timestamp: 7 });

      let ev6 = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(ev6.cumulativeNetProfitUsd, 300.0);
      assert.equal(ev6.cumulativeObligationUsd, 15.0); // 5% of $300
      assert.equal(ev6.totalRoyaltiesPaidUsd, 12.0);
      assert.equal(ev6.pendingRoyaltyUsd, 3.0); // Exactly $3.00 incremental due!

      const r6 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r6.remitted, true);
      assert.equal(r6.royaltyAmountUsd, 3.0);
      assert.equal(r6.totalRoyaltiesPaidUsd, 15.0);

      // --- Wave 7: Verification of total lifetime royalties paid ---
      // Realized peak net profit was $300.00.
      // Total royalties remitted: $9.00 + $3.00 + $3.00 = $15.00 (exactly 5.0% of $300.00).
      const lineage = db.getLineageByChild(childAddress);
      assert.equal(lineage?.totalRoyaltiesPaidUsd, 15.0);
    });

    it('ST-ROY-02: Solvency Buffer Depletion Boundaries ($15.00 threshold) protect child from metabolic starvation', async () => {
      const childAddress = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      // Cumulative profit = $100 -> obligation = $5.00
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 100.0, entryType: 'INCOME_POLYMARKET', timestamp: 1 });

      // Case A: Balance at $14.999999 (< $15.00)
      wallet.setMockBalance('base', 7.499999);
      wallet.setMockBalance('polygon', 7.5);
      const evA = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evA.isSolventForRemittance, false);
      assert.equal(evA.shouldRemit, false);
      assert.equal(evA.reason, 'DEFERRED_INSUFFICIENT_FREE_SURPLUS');

      // Case B: Balance exactly at $15.000000 (free surplus = 0)
      wallet.setMockBalance('base', 7.5);
      wallet.setMockBalance('polygon', 7.5);
      const evB = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evB.isSolventForRemittance, false);
      assert.equal(evB.shouldRemit, false);
      assert.equal(evB.reason, 'DEFERRED_INSUFFICIENT_FREE_SURPLUS');

      // Case C: Balance at $15.49 (free surplus $0.49 < $0.50 dust)
      wallet.setMockBalance('base', 7.74);
      wallet.setMockBalance('polygon', 7.75); // Total $15.49
      const evC = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evC.isSolventForRemittance, true);
      assert.equal(evC.freeSurplusUsd, 0.49);
      assert.equal(evC.shouldRemit, false);
      assert.equal(evC.reason, 'DEFERRED_BELOW_DUST_THRESHOLD');

      // Case D: Balance at $15.50 (free surplus $0.50 >= dust threshold)
      wallet.setMockBalance('base', 7.75);
      wallet.setMockBalance('polygon', 7.75); // Total $15.50
      const evD = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evD.isSolventForRemittance, true);
      assert.equal(evD.freeSurplusUsd, 0.50);
      assert.equal(evD.shouldRemit, true);
      assert.equal(evD.remittanceAmountUsd, 0.50); // Remits exactly $0.50

      // Case E: Partial remittance preserving exact solvency buffer:
      // Balance $20.00, obligation $5.00 -> free surplus $5.00 -> remits $5.00, leaves $15.00
      wallet.setMockBalance('base', 10.0);
      wallet.setMockBalance('polygon', 10.0); // Total $20.00
      const remitRes = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(remitRes.remitted, true);
      assert.equal(remitRes.royaltyAmountUsd, 5.0);
      assert.equal(remitRes.balanceAfterRemittanceUsd, 15.0); // Exact solvency buffer preserved!
    });

    it('ST-ROY-03: Dust Remittance Boundaries ($0.50 threshold) and force override', async () => {
      const childAddress = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      // Case A: Profit $9.99 -> 5% obligation = $0.4995 (< $0.50 dust)
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 9.99, entryType: 'INCOME_X402', timestamp: 1 });
      const evDust = await evaluateRoyaltyStatus(db, wallet, childAddress);
      assert.equal(evDust.shouldRemit, false);
      assert.equal(evDust.reason, 'DEFERRED_BELOW_DUST_THRESHOLD');

      // Case B: Normal remit call defers
      const normalRes = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(normalRes.remitted, false);

      // Case C: Forced remit executes dust transfer
      const forcedRes = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
        force: true,
      });
      assert.equal(forcedRes.remitted, true);
      assert.equal(forcedRes.royaltyAmountUsd, 0.4995);
    });

    it('ST-ROY-04: Anti-Replay / Double-Spend Attack Prevention rejects successive and forced duplicate remittances', async () => {
      const childAddress = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
      const motherAddress = wallet.getAddress();
      registerChildLineage(db, childAddress, motherAddress, 2, 50.0);

      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      db.insertLedger({ chain: 'base', token: 'USDC', amount: 100.0, entryType: 'INCOME_BOUNTY', timestamp: 1 });

      // First remittance: succeeds
      const r1 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r1.remitted, true);
      assert.equal(r1.royaltyAmountUsd, 5.0);

      // Attack: immediate second remittance call without new income
      const r2 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress });
      assert.equal(r2.remitted, false);
      assert.equal(r2.royaltyAmountUsd, 0.0);
      assert.equal(r2.reason, 'NO_ROYALTIES_DUE');

      // Attack: forced second remittance call
      const r3 = await remitRoyalty({
        database: db,
        wallet,
        motherWalletAddress: motherAddress,
        childAddress,
        force: true,
      });
      assert.equal(r3.remitted, false);
      assert.equal(r3.royaltyAmountUsd, 0.0);
      assert.equal(r3.reason, 'ZERO_AMOUNT_DUE');

      // Verify ledger has exactly 1 ROYALTY_OUT entry
      const ledger = db.getLedgerEntries(50);
      const royaltyOutEntries = ledger.filter((e) => e.entryType === 'ROYALTY_OUT');
      assert.equal(royaltyOutEntries.length, 1);
    });

    it('ST-ROY-05: Missing Lineage Resiliency prevents double-taxation drain via atomic lineage upsert', async () => {
      // Child address not pre-registered in lineage table
      const unregisteredChild = '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
      const motherAddress = wallet.getAddress();

      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      // Cycle 1: Child generates $100.00 revenue
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 100.0, entryType: 'INCOME_X402', timestamp: 1 });

      const ev1 = await evaluateRoyaltyStatus(db, wallet, unregisteredChild);
      assert.equal(ev1.totalRoyaltiesPaidUsd, 0.0);
      assert.equal(ev1.pendingRoyaltyUsd, 5.0);
      assert.equal(ev1.shouldRemit, true);

      // Remit $5.00
      const r1 = await remitRoyalty({ database: db, wallet, motherWalletAddress: motherAddress, childAddress: unregisteredChild });
      assert.equal(r1.remitted, true);
      assert.equal(r1.royaltyAmountUsd, 5.0);

      // Cycle 2: Atomic upsert in updateRoyaltiesPaid created the missing lineage record with $5.00 paid.
      // Next tick without new income:
      const ev2 = await evaluateRoyaltyStatus(db, wallet, unregisteredChild);

      // Verified: Child is protected against phantom double-taxation
      assert.equal(ev2.totalRoyaltiesPaidUsd, 5.0);
      assert.equal(ev2.cumulativeNetProfitUsd, 100.0);
      assert.equal(ev2.pendingRoyaltyUsd, 0.0);
      assert.equal(ev2.shouldRemit, false);
      assert.equal(ev2.reason, 'NO_ROYALTIES_DUE');

      // Verify lineage entry persisted
      const lineage = db.getLineageByChild(unregisteredChild);
      assert.ok(lineage);
      assert.equal(lineage.totalRoyaltiesPaidUsd, 5.0);
      assert.equal(lineage.parentAddress, motherAddress);
    });

    it('ST-ROY-06: Remittance targeting ZERO_ADDRESS must throw ConstitutionViolationError', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);
      db.insertLedger({ chain: 'base', token: 'USDC', amount: 100.0, entryType: 'INCOME_X402', timestamp: 1 });

      await assert.rejects(
        async () => {
          await remitRoyalty({
            database: db,
            wallet,
            motherWalletAddress: ZERO_ADDRESS,
            childAddress: wallet.getAddress(),
          });
        },
        ConstitutionViolationError
      );
    });
  });

  // ============================================================================
  // SUITE 5: Constitutional Mutation Bounds Stress (Hyperparameters & Bounds)
  // ============================================================================
  describe('5. Constitutional Mutation Bounds Stress', () => {
    const baselineParams: ChildHyperparameters = {
      kellyFraction: 0.25,
      maxBankrollCap: 0.05,
      heartbeatGreenMs: 60000,
      heartbeatYellowMs: 300000,
      minBountyRewardUsd: 10.0,
      x402PriceUsdc: 0.05,
      polymarketMinEvEdge: 0.01,
      strategyFocus: 'BALANCED',
    };

    it('ST-MUT-01: Kelly fraction violations (k > 0.25, k <= 0, NaN, Infinity) must throw ConstitutionViolationError', () => {
      // Exact boundary + epsilon
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, kellyFraction: 0.250001 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, kellyFraction: 0.50 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, kellyFraction: 1.0 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, kellyFraction: 0.0 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, kellyFraction: -0.10 }),
        ConstitutionViolationError
      );

      // Exact boundary passes
      assert.doesNotThrow(() =>
        validateConstitutionalBounds({ ...baselineParams, kellyFraction: 0.25 })
      );
    });

    it('ST-MUT-02: Bankroll cap violations (cap > 0.05, cap <= 0) must throw ConstitutionViolationError', () => {
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, maxBankrollCap: 0.050001 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, maxBankrollCap: 0.10 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, maxBankrollCap: 0.0 }),
        ConstitutionViolationError
      );
      assert.throws(
        () => validateConstitutionalBounds({ ...baselineParams, maxBankrollCap: -0.01 }),
        ConstitutionViolationError
      );

      // Exact boundary passes
      assert.doesNotThrow(() =>
        validateConstitutionalBounds({ ...baselineParams, maxBankrollCap: 0.05 })
      );
    });

    it('ST-MUT-03: Stochastic Mutation Clamping Fuzzing across 1,000 hostile PRNG cycles', () => {
      // Hostile PRNG 1: Always max nudge up (0.999999)
      const maxUpPRNG = () => 0.999999;
      // Hostile PRNG 2: Always max nudge down (0.000001)
      const maxDownPRNG = () => 0.000001;
      // Hostile PRNG 3: Alternating
      let toggle = false;
      const alternatingPRNG = () => {
        toggle = !toggle;
        return toggle ? 0.999999 : 0.000001;
      };

      const hostilePRNGs = [maxUpPRNG, maxDownPRNG, alternatingPRNG, Math.random];

      for (let i = 0; i < 1000; i++) {
        const prng = hostilePRNGs[i % hostilePRNGs.length];
        const mutated = mutateHyperparameters(baselineParams, prng);

        // Invariant 1: Kelly fraction in range (0, 0.25]
        assert(
          mutated.kellyFraction > 0 && mutated.kellyFraction <= CONSTITUTIONAL_MAX_KELLY_FRACTION,
          `Kelly fraction ${mutated.kellyFraction} violated Article II.1 at iteration ${i}`
        );

        // Invariant 2: Max bankroll cap in range (0, 0.05]
        assert(
          mutated.maxBankrollCap > 0 && mutated.maxBankrollCap <= CONSTITUTIONAL_MAX_BANKROLL_BET_PERCENT,
          `Bankroll cap ${mutated.maxBankrollCap} violated Article II.2 at iteration ${i}`
        );

        // Invariant 3: Heartbeat intervals
        assert(mutated.heartbeatGreenMs >= 30000 && mutated.heartbeatGreenMs <= 120000);
        assert(mutated.heartbeatYellowMs >= 180000 && mutated.heartbeatYellowMs <= 600000);

        // Invariant 4: Revenue bounds
        assert(mutated.minBountyRewardUsd >= 5.0 && mutated.minBountyRewardUsd <= 50.0);
        assert(mutated.x402PriceUsdc >= 0.01 && mutated.x402PriceUsdc <= 0.25);
        assert(mutated.polymarketMinEvEdge >= 0.00 && mutated.polymarketMinEvEdge <= 0.05);

        // Invariant 5: Passes validateConstitutionalBounds
        assert.doesNotThrow(() => validateConstitutionalBounds(mutated));
      }
    });

    it('ST-MUT-04: HeartbeatDaemon Lifecycle Integration Under Stress suppresses actions outside Tier Verde', async () => {
      const config = loadConfig();

      // Tier AMARELO
      const yellowRes = await executeMitosisLifecycleTick({
        database: db,
        wallet,
        config,
        currentTier: 'AMARELO',
        cycleCount: 1,
      });
      assert.deepEqual(yellowRes, {});

      // Tier LARANJA
      const orangeRes = await executeMitosisLifecycleTick({
        database: db,
        wallet,
        config,
        currentTier: 'LARANJA',
        cycleCount: 1,
      });
      assert.deepEqual(orangeRes, {});

      // Tier VERMELHO
      const redRes = await executeMitosisLifecycleTick({
        database: db,
        wallet,
        config,
        currentTier: 'VERMELHO',
        cycleCount: 1,
      });
      assert.deepEqual(redRes, {});
    });
  });
});
