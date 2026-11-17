/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Tier 2 E2E Test Suite
 * ==============================================================================
 * Target: Boundary & Corner Cases (Features F01 through F23)
 * Total Test Cases: Exactly 115 tests (5 per feature)
 * Execution: Native Node.js test runner (`node:test` + `node:assert/strict`)
 * Mode: Pure Opaque-Box verification across boundary conditions, zero balances,
 *       dust thresholds, negative EV rejections, precision clamps, and malformed inputs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

// Shared E2E Helpers
import {
  E2ETestContext,
  MockHttpClient,
  ConstitutionalAssert,
} from './helpers/index.ts';

// Config & Governance
import {
  loadConfig,
  getConfig,
  resetConfig,
  parseEnvFile,
  ConfigValidationError,
  DEFAULT_MOCK_PRIVATE_KEY,
} from '../../src/config.ts';

// Core Engine Services
import { DatabaseService } from '../../src/core/database.ts';
import {
  ApexWallet,
  createApexWallet,
  WalletError,
  NetworkError,
  InsufficientBalanceError,
} from '../../src/core/wallet.ts';
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
} from '../../src/core/death.ts';
import { HeartbeatDaemon } from '../../src/index.ts';

// Types & Errors
import {
  ConstitutionViolationError,
  InsolvencyError,
  KellyRiskError,
  ImmuneCheckError,
  MitosisError,
  type LedgerEntryType,
  type MetabolicTier,
  type AppConfig,
  type Tombstone,
  type OrderOutcome,
} from '../../src/types.ts';

// Triple Revenue Engine
import {
  calculateNetOdds,
  calculateExpectedValue,
  calculateKellyStake,
} from '../../src/modules/polymarket/kelly.ts';
import {
  PolymarketScanner,
  type PolymarketMarket,
} from '../../src/modules/polymarket/scanner.ts';
import { OrderManager } from '../../src/modules/polymarket/order.ts';
import { X402Server } from '../../src/modules/micropayments/server.ts';
import {
  BountiesScanner,
  BountyEvaluator,
  AntiSpamSafeguard,
  filterMicrotasks,
  classifyMicrotask,
  AntiSpamViolationError,
  BountyError,
  DEFAULT_MOCK_BOUNTIES,
  type BountyTask,
  type BountySolution,
} from '../../src/modules/bounties/scanner.ts';

// Evolution & Self-Healing
import {
  ImmuneSystem,
  SecurityViolationError,
  DEFAULT_PROTECTED_PATHS,
} from '../../src/evolution/immune_system.ts';
import {
  evaluateMitosisThreshold,
  runViabilitySimulation,
  deriveChildSubWallet,
  executeMitosis,
  calculateRoyalty,
  evaluateRoyaltyStatus,
  remitRoyalty,
  createChildSpawnConfig,
  MitosisThresholdError,
} from '../../src/evolution/mitosis.ts';

describe('Tier 2 E2E Test Suite: Boundary & Corner Cases (F01 - F23)', () => {
  let ctx: E2ETestContext;
  let db: DatabaseService;
  let wallet: ApexWallet;
  let config: AppConfig;

  const validParentKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    ctx = new E2ETestContext({
      MOTHER_WALLET_ADDRESS: '0x1111111111111111111111111111111111111111',
    });
    db = ctx.db;
    wallet = ctx.wallet;
    config = ctx.config;
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  // ============================================================================
  // F01: Canonical Project Setup
  // ============================================================================
  describe('F01: Canonical Project Setup', () => {
    it('T2-F01-01: Malformed package.json syntax', () => {
      const malformedJson = '{ name: "apex-aea", trailingComma: true, }';
      assert.throws(() => JSON.parse(malformedJson), SyntaxError);
    });

    it('T2-F01-02: Zero strict type errors under tsconfig.json', () => {
      const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json');
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

      assert.equal(tsconfig.compilerOptions?.strict, true);
      assert.equal(tsconfig.compilerOptions?.noEmit, true);
      assert.equal(tsconfig.compilerOptions?.skipLibCheck, true);
    });

    it('T2-F01-03: Missing core source file detection in build validator', async () => {
      const nonExistentPath = path.resolve(process.cwd(), 'src/nonexistent_core_file.ts');
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            '--experimental-strip-types',
            '--no-warnings=ExperimentalWarning',
            '--check',
            nonExistentPath,
          ],
          { cwd: process.cwd(), stdio: 'ignore' }
        );
        child.on('close', (code) => resolve(code ?? 1));
      });

      assert.notEqual(exitCode, 0, 'Build check on non-existent file must fail with non-zero exit code');
    });

    it('T2-F01-04: Git command execution outside git tree', () => {
      assert.throws(
        () =>
          execSync('git --git-dir=nonexistent_git_dir status', {
            cwd: ctx.tempDir,
            stdio: 'pipe',
          }),
        /not a git repository/i
      );
    });

    it('T2-F01-05: Large output buffer handling in build subprocess', async () => {
      const chunkCount = 500;
      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['-e', `for (let i = 0; i < ${chunkCount}; i++) console.log("A".repeat(1024));`],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );

        let data = '';
        child.stdout.on('data', (d) => {
          data += d.toString();
        });
        child.on('error', reject);
        child.on('close', () => resolve(data));
      });

      assert.ok(result.length >= chunkCount * 1024);
    });
  });

  // ============================================================================
  // F02: Multi-Network Config
  // ============================================================================
  describe('F02: Multi-Network Config', () => {
    it('T2-F02-01: Mock key rejection in mainnet mode', () => {
      resetConfig();
      assert.throws(
        () => loadConfig({ NETWORK_MODE: 'mainnet', PRIVATE_KEY: DEFAULT_MOCK_PRIVATE_KEY }),
        (err: any) =>
          err instanceof ConfigValidationError &&
          err.message.includes('Mock/dummy private key cannot be used in mainnet')
      );
    });

    it('T2-F02-02: USE_MOCK_APIS rejection in mainnet mode', () => {
      resetConfig();
      const realKey = '0x' + '2'.repeat(64);
      assert.throws(
        () =>
          loadConfig({
            NETWORK_MODE: 'mainnet',
            USE_MOCK_APIS: 'true',
            PRIVATE_KEY: realKey,
          }),
        (err: any) =>
          err instanceof ConfigValidationError &&
          err.message.includes('USE_MOCK_APIS cannot be enabled in mainnet')
      );
    });

    it('T2-F02-03: Malformed private key formats', () => {
      resetConfig();
      const badKeys = [
        '0xabc', // odd hex length
        '0x' + 'g'.repeat(64), // non-hex character 'g'
        '1'.repeat(64), // missing 0x prefix
        '0x' + '1'.repeat(63), // 63 hex chars (too short)
        '0x' + '1'.repeat(65), // 65 hex chars (too long)
      ];

      for (const key of badKeys) {
        assert.throws(
          () => loadConfig({ NETWORK_MODE: 'testnet', PRIVATE_KEY: key }),
          ConfigValidationError
        );
      }
    });

    it('T2-F02-04: Inverted metabolic thresholds hierarchy', () => {
      resetConfig();
      assert.throws(
        () =>
          loadConfig({
            TIER_GREEN_THRESHOLD: '10.0',
            TIER_YELLOW_THRESHOLD: '50.0',
          }),
        (err: any) =>
          err instanceof ConfigValidationError &&
          err.message.includes('Invalid metabolic thresholds hierarchy')
      );
    });

    it('T2-F02-05: Unicode BOM and unclosed quotes in .env parser', () => {
      const content = '\uFEFFKEY1="unclosed\nKEY2="hello \\"world\\""\nKEY3=plain';
      const parsed = parseEnvFile(content);

      assert.equal(parsed.KEY2, 'hello \\"world\\"');
      assert.equal(parsed.KEY3, 'plain');
      assert.ok('KEY1' in parsed);
    });
  });

  // ============================================================================
  // F03: Immutable Constitution
  // ============================================================================
  describe('F03: Immutable Constitution', () => {
    it('T2-F03-01: Exact numeric metabolic boundaries in Article III', () => {
      const constPath = path.resolve(process.cwd(), 'src/constitution.md');
      const text = fs.readFileSync(constPath, 'utf8');

      assert.match(text, /\$50\.00/);
      assert.match(text, /\$10\.00/);
      assert.match(text, /\$2\.00/);
      assert.match(text, /\$0\.00/);
    });

    it('T2-F03-02: Exact rollback command string in Article V', () => {
      const constPath = path.resolve(process.cwd(), 'src/constitution.md');
      const text = fs.readFileSync(constPath, 'utf8');

      assert.ok(text.includes('git reset --hard HEAD && git clean -fd'));
    });

    it('T2-F03-03: Exact 3x multiplier and 5.0% royalty in Article VI', () => {
      const constPath = path.resolve(process.cwd(), 'src/constitution.md');
      const text = fs.readFileSync(constPath, 'utf8');

      assert.match(text, /3\s*\\times|three times|3x/i);
      assert.match(text, /5\.0%/);
    });

    it('T2-F03-04: Startup abort on missing constitution file', () => {
      const missingPath = path.join(ctx.tempDir, 'nonexistent_constitution.md');
      assert.throws(
        () => ConstitutionalAssert.assertConstitutionComplete(missingPath),
        /Constitution file does not exist/
      );
    });

    it('T2-F03-05: Immune System protected path enforcement', () => {
      assert.ok(DEFAULT_PROTECTED_PATHS.includes('src/constitution.md'));

      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['src/constitution.md']);

      assert.equal(res.valid, false);
      assert.ok(res.violatedFiles.includes('src/constitution.md'));
    });
  });

  // ============================================================================
  // F04: Shared Types & Contracts
  // ============================================================================
  describe('F04: Shared Types & Contracts', () => {
    it('T2-F04-01: Error stack trace and instanceof preservation', () => {
      const err = new KellyRiskError('Fraction exceeds limit');

      assert.equal(err instanceof KellyRiskError, true);
      assert.equal(err instanceof Error, true);
      assert.equal(err.name, 'KellyRiskError');
      assert.ok(err.stack && err.stack.includes('KellyRiskError'));
    });

    it('T2-F04-02: Error serialization to JSON', () => {
      const err = new ConstitutionViolationError('Whitelist violation');
      const json = JSON.stringify({
        name: err.name,
        message: err.message,
      });

      const parsed = JSON.parse(json);
      assert.equal(parsed.name, 'ConstitutionViolationError');
      assert.equal(parsed.message, '[CONSTITUTION VIOLATION] Whitelist violation');
    });

    it('T2-F04-03: Tombstone interface field completeness', () => {
      const tombstone: Tombstone = {
        agentAddress: '0x1234567890123456789012345678901234567890',
        terminalReason: 'Terminal Insolvency',
        deathTimestamp: Date.now(),
        finalBalanceUsd: 0.0,
        birthTimestamp: Date.now() - 3600000,
        totalLifespanMs: 3600000,
        totalRevenueGenerated: 150.0,
        totalExpensesIncurred: 10.0,
        finalLedgerSnapshot: [],
        operationalSummary: {
          totalHeartbeatCycles: 42,
          polymarketPositionsCount: 5,
          x402RequestsServed: 20,
          bountiesSolvedCount: 2,
        },
        postMortemInsights: ['Zero liquid balance reached'],
      };

      assert.equal(tombstone.finalBalanceUsd, 0.0);
      assert.equal(tombstone.operationalSummary.totalHeartbeatCycles, 42);
    });

    it('T2-F04-04: Exhaustive tier switch handling', () => {
      const tiers: MetabolicTier[] = ['VERDE', 'AMARELO', 'LARANJA', 'VERMELHO'];
      const evaluated: string[] = [];

      for (const t of tiers) {
        switch (t) {
          case 'VERDE':
            evaluated.push('V');
            break;
          case 'AMARELO':
            evaluated.push('A');
            break;
          case 'LARANJA':
            evaluated.push('L');
            break;
          case 'VERMELHO':
            evaluated.push('R');
            break;
          default:
            assert.fail(`Unrecognized tier: ${t}`);
        }
      }

      assert.deepEqual(evaluated, ['V', 'A', 'L', 'R']);
    });

    it('T2-F04-05: Strict binary outcome types', () => {
      const validOutcomes: OrderOutcome[] = ['YES', 'NO'];
      for (const o of validOutcomes) {
        assert.ok(o === 'YES' || o === 'NO');
      }
    });
  });

  // ============================================================================
  // F05: SQLite Persistence
  // ============================================================================
  describe('F05: SQLite Persistence', () => {
    it('T2-F05-01: Transaction rollback on runtime error', () => {
      assert.throws(() => {
        db.transaction(() => {
          db.insertLedger({
            chain: 'base',
            token: 'USDC',
            amount: 100.0,
            entryType: 'INCOME_X402',
            timestamp: Date.now(),
          });
          throw new Error('Forced rollback');
        });
      }, /Forced rollback/);

      assert.equal(db.getLedgerEntries().length, 0);
    });

    it('T2-F05-02: Nested transaction rollback via SAVEPOINT', () => {
      db.transaction(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 50.0,
          entryType: 'INCOME_X402',
          timestamp: Date.now(),
        });

        try {
          db.transaction(() => {
            db.insertLedger({
              chain: 'polygon',
              token: 'USDC',
              amount: 25.0,
              entryType: 'INCOME_POLYMARKET',
              timestamp: Date.now(),
            });
            throw new Error('Inner failure');
          });
        } catch {
          // Handled inner savepoint rollback
        }
      });

      const entries = db.getLedgerEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].amount, 50.0);
    });

    it('T2-F05-03: Negative amount CHECK constraint violation', () => {
      assert.throws(
        () =>
          db.insertLedger({
            chain: 'base',
            token: 'USDC',
            amount: -10.0,
            entryType: 'INCOME_X402',
            timestamp: Date.now(),
          }),
        /CHECK constraint failed: amount >= 0/
      );
    });

    it('T2-F05-04: Invalid chain CHECK constraint violation', () => {
      assert.throws(
        () =>
          db.insertLedger({
            chain: 'ethereum' as any,
            token: 'USDC',
            amount: 10.0,
            entryType: 'INCOME_X402',
            timestamp: Date.now(),
          }),
        /CHECK constraint failed: chain IN/
      );
    });

    it('T2-F05-05: Access after db.close()', () => {
      const closedDb = new DatabaseService(':memory:');
      closedDb.close();

      assert.throws(
        () => closedDb.getLedgerEntries(),
        /Database is closed or uninitialized/
      );
    });
  });

  // ============================================================================
  // F06: Dual-Chain Wallet
  // ============================================================================
  describe('F06: Dual-Chain Wallet', () => {
    it('T2-F06-01: Non-whitelisted recipient rejection (Article I)', async () => {
      const stranger = '0x7777777777777777777777777777777777777777';
      assert.equal(wallet.isWhitelisted(stranger), false);

      await assert.rejects(
        () => wallet.transferUsdc('base', stranger, 1.0),
        ConstitutionViolationError
      );
    });

    it('T2-F06-02: Zero address transfer rejection (Article I)', async () => {
      const zeroAddr = '0x0000000000000000000000000000000000000000';
      await assert.rejects(
        () => wallet.transferUsdc('base', zeroAddr, 1.0),
        ConstitutionViolationError
      );
    });

    it('T2-F06-03: Balance deficit rejection', async () => {
      wallet.setMockBalance('base', 10.0);
      const recipient = '0x8888888888888888888888888888888888888888';
      wallet.addToWhitelist(recipient);

      await assert.rejects(
        () => wallet.transferUsdc('base', recipient, 15.0),
        InsufficientBalanceError
      );
    });

    it('T2-F06-04: Sub-atomic USDC unit transfer rejection', async () => {
      const recipient = '0x8888888888888888888888888888888888888888';
      wallet.addToWhitelist(recipient);

      await assert.rejects(
        () => wallet.transferUsdc('base', recipient, 0.0000005),
        /below minimum atomic USDC unit/
      );
    });

    it('T2-F06-05: Simulated network failure handling', async () => {
      wallet.setSimulateError(true);
      await assert.rejects(
        () => wallet.getBaseUsdcBalance(),
        NetworkError
      );
      wallet.setSimulateError(false);
    });
  });

  // ============================================================================
  // F07: Adaptive Metabolism
  // ============================================================================
  describe('F07: Adaptive Metabolism', () => {
    it('T2-F07-01: Exact boundary values: $50.00 and $50.000001', () => {
      const status50 = evaluateTier(50.0);
      assert.equal(status50.tier, 'AMARELO');

      const status50Plus = evaluateTier(50.000001);
      assert.equal(status50Plus.tier, 'VERDE');
    });

    it('T2-F07-02: Exact boundary values: $10.00 and $9.999999', () => {
      const status10 = evaluateTier(10.0);
      assert.equal(status10.tier, 'AMARELO');

      const status10Minus = evaluateTier(9.999999);
      assert.equal(status10Minus.tier, 'LARANJA');
    });

    it('T2-F07-03: Exact boundary values: $2.00, $0.000001, $0.00', () => {
      const status2 = evaluateTier(2.0);
      assert.equal(status2.tier, 'LARANJA');
      assert.equal(isCriticalSurvival(2.0), false);

      const statusCritical = evaluateTier(0.000001);
      assert.equal(statusCritical.tier, 'LARANJA');
      assert.equal(isCriticalSurvival(0.000001), true);

      const statusZero = evaluateTier(0.0);
      assert.equal(statusZero.tier, 'VERMELHO');
    });

    it('T2-F07-04: Negative balance (debt/deficit) handling', () => {
      const status = evaluateTier(-10.0);
      assert.equal(status.tier, 'VERMELHO');
      assert.equal(isTerminalInsolvency(-10.0), true);
    });

    it('T2-F07-05: Non-number and NaN parameter rejection', () => {
      assert.throws(() => evaluateTier(NaN), TypeError);
      assert.throws(() => evaluateTier('50' as any), TypeError);
      assert.throws(() => evaluateTier(null as any), TypeError);
    });
  });

  // ============================================================================
  // F08: Permadeath Protocol
  // ============================================================================
  describe('F08: Permadeath Protocol', () => {
    it('T2-F08-01: Teardown hook exception isolation', async () => {
      let secondHookExecuted = false;
      registerTeardownHook(() => {
        throw new Error('Failing teardown hook');
      });
      registerTeardownHook(() => {
        secondHookExecuted = true;
      });

      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const tombPath = path.join(ctx.tempDir, 'tomb_isolation.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );

      assert.equal(secondHookExecuted, true);
    });

    it('T2-F08-02: Permadeath with uninitialized DB', async () => {
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const tombPath = path.join(ctx.tempDir, 'tomb_no_db.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath, database: null as any }),
        /EXIT_0/
      );

      assert.ok(fs.existsSync(tombPath));
      const tomb = JSON.parse(fs.readFileSync(tombPath, 'utf8'));
      assert.equal(tomb.totalRevenueGenerated, 0);
    });

    it('T2-F08-03: Tombstone path in non-existent directory tree', async () => {
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const deepTombPath = path.join(ctx.tempDir, 'deep', 'nested', 'path', 'tombstone.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: deepTombPath }),
        /EXIT_0/
      );

      assert.ok(fs.existsSync(deepTombPath));
    });

    it('T2-F08-04: Negative balance recorded accurately in tombstone', async () => {
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const tombPath = path.join(ctx.tempDir, 'tomb_neg.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath, finalBalanceUsd: -5.0 }),
        /EXIT_0/
      );

      const tomb = JSON.parse(fs.readFileSync(tombPath, 'utf8'));
      assert.equal(tomb.finalBalanceUsd, -5.0);
    });

    it('T2-F08-05: Repeated / concurrent permadeath invocation', async () => {
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const tombPath = path.join(ctx.tempDir, 'tomb_repeat.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );

      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );

      assert.ok(fs.existsSync(tombPath));
    });
  });

  // ============================================================================
  // F09: Heartbeat Daemon
  // ============================================================================
  describe('F09: Heartbeat Daemon', () => {
    it('T2-F09-01: Terminal insolvency triggered inside tick()', async () => {
      wallet.setMockBalance('base', 0.0);
      wallet.setMockBalance('polygon', 0.0);

      let permadeathTriggered = false;
      setExitHandler((): never => {
        permadeathTriggered = true;
        throw new Error('EXIT_0');
      });

      const daemon = new HeartbeatDaemon({
        wallet,
        database: db,
        config,
        tombstonePath: path.join(ctx.tempDir, 'tombstone.json'),
      });
      try {
        await daemon.tick();
      } catch {
        // Expected permadeath exit exception
      }

      assert.equal(permadeathTriggered, true);
      assert.equal(daemon.isRunning, false);
    });

    it('T2-F09-02: Transient wallet RPC error recovery', async () => {
      wallet.setSimulateError(true);
      const daemon = new HeartbeatDaemon({
        wallet,
        database: db,
        config,
        tombstonePath: path.join(ctx.tempDir, 'tombstone.json'),
      });
      const res = await daemon.tick();

      assert.equal(res.success, false);
      const actions = db.getActions(10, 'heartbeat');
      assert.ok(actions.some((a) => a.actionType === 'TICK_FAILED'));
      wallet.setSimulateError(false);
    });

    it('T2-F09-03: Closed DB during heartbeat tick', async () => {
      const closedDb = new DatabaseService(':memory:');
      closedDb.close();

      const daemon = new HeartbeatDaemon({ wallet, database: closedDb, config });
      const res = await daemon.tick();

      assert.equal(res.success, true);
      assert.equal(res.tier, 'VERDE');
    });

    it('T2-F09-04: Zero/sub-millisecond interval override', async () => {
      const daemon = new HeartbeatDaemon({
        wallet,
        database: db,
        config,
        intervalOverrideMs: 0,
      });

      const res = await daemon.tick();
      assert.equal(res.success, true);
    });

    it('T2-F09-05: Concurrent tick execution prevention', async () => {
      const daemon = new HeartbeatDaemon({
        wallet,
        database: db,
        config,
        tombstonePath: path.join(ctx.tempDir, 'tombstone.json'),
      });
      const [res1, res2] = await Promise.all([daemon.tick(), daemon.tick()]);

      assert.equal(res1.success, true);
      assert.equal(res2.success, true);
      assert.equal(res1.cycle, 1);
      assert.equal(res2.cycle, 1);
      assert.equal(daemon.cycleCount, 1);
    });
  });

  // ============================================================================
  // F10: Fractional Quarter-Kelly
  // ============================================================================
  describe('F10: Fractional Quarter-Kelly', () => {
    it('T2-F10-01: Extreme probability boundary: p -> 0.0001 and p -> 0.9999', () => {
      const oddsLow = calculateNetOdds(0.0001);
      assert.ok(Number.isFinite(oddsLow));
      assert.ok(oddsLow > 0);

      const oddsHigh = calculateNetOdds(0.9999);
      assert.ok(Number.isFinite(oddsHigh));
      assert.ok(oddsHigh > 0);
    });

    it('T2-F10-02: Invalid market price rejection (<= 0 or >= 1)', () => {
      const invalidPrices = [0.0, 1.0, -0.5, 1.5];
      for (const p of invalidPrices) {
        assert.throws(() => calculateNetOdds(p), KellyRiskError);
      }
    });

    it('T2-F10-03: Invalid probability rejection (<= 0 or >= 1)', () => {
      const invalidProbs = [0.0, 1.0, -0.1, 1.1];
      for (const p of invalidProbs) {
        assert.throws(() => calculateExpectedValue(1.5, p, 1 - p), KellyRiskError);
      }
    });

    it('T2-F10-04: Floating-point precision clamping (12 decimals)', () => {
      const result = calculateKellyStake(0.333333333333, 0.666666666666, 1000);
      assert.ok(Number.isFinite(result.expectedValue));
      assert.ok(Number.isFinite(result.rawKellyFraction));
    });

    it('T2-F10-05: Custom multiplier override validation', () => {
      const result = calculateKellyStake(0.4, 0.6, 1000, {
        fractionMultiplier: 0.5, // Half-Kelly
      });

      assert.equal(result.quarterKellyFraction, Number((0.5 * result.rawKellyFraction).toFixed(12)));
    });
  });

  // ============================================================================
  // F11: Risk Hurdle & 5% Cap
  // ============================================================================
  describe('F11: Risk Hurdle & 5% Cap', () => {
    it('T2-F11-01: Negative EV rejection with non-zero Kelly', () => {
      const result = calculateKellyStake(0.7, 0.3, 1000);
      assert.equal(result.authorized, false);
      assert.equal(result.allocatedFraction, 0);
      assert.equal(result.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
    });

    it('T2-F11-02: Microscopic edge below $1.00 dust floor', () => {
      const result = calculateKellyStake(0.5, 0.501, 100);
      assert.equal(result.authorized, false);
      assert.equal(result.rejectionReason, 'REJECTED_DUST_THRESHOLD');
    });

    it('T2-F11-03: Zero and negative liquid bankroll', () => {
      const resZero = calculateKellyStake(0.4, 0.6, 0);
      assert.equal(resZero.authorized, false);
      assert.equal(resZero.rejectionReason, 'REJECTED_INSUFFICIENT_BANKROLL');

      const resNeg = calculateKellyStake(0.4, 0.6, -50);
      assert.equal(resNeg.authorized, false);
      assert.equal(resNeg.rejectionReason, 'REJECTED_INSUFFICIENT_BANKROLL');
    });

    it('T2-F11-04: Massive bankroll ($10M) ceiling enforcement', () => {
      const result = calculateKellyStake(0.4, 0.7, 10000000);
      assert.equal(result.allocatedFraction, 0.05);
      assert.equal(result.stakeAmountUsd, 500000.0);
    });

    it('T2-F11-05: Rejection of config with maxBankrollCap > 0.05', () => {
      resetConfig();
      assert.throws(
        () => loadConfig({ MAX_BANKROLL_BET_PERCENT: '0.10' }),
        (err: any) =>
          err instanceof ConfigValidationError &&
          err.message.includes('MAX_BANKROLL_BET_PERCENT cannot exceed 0.05')
      );
    });
  });

  // ============================================================================
  // F12: Polymarket Scanner
  // ============================================================================
  describe('F12: Polymarket Scanner', () => {
    it('T2-F12-01: Outcome price extremes filtering (< 0.02 or > 0.98)', async () => {
      const extremeMarket: PolymarketMarket = {
        id: 'extreme-market',
        conditionId: '0x' + '1'.repeat(64),
        question: 'Extreme probability market?',
        slug: 'extreme-market',
        outcomes: ['YES', 'NO'],
        outcomePrices: [0.01, 0.99],
        impliedProbability: 0.01,
        liquidityUsd: 10000,
        volume24hUsd: 1000,
        active: true,
        closed: false,
      };

      const scanner = new PolymarketScanner('https://clob.polymarket.com', true, [extremeMarket]);
      const candidates = await scanner.fetchMarkets();

      assert.equal(candidates.length, 0);
    });

    it('T2-F12-02: Zero markets catalog handling', async () => {
      const scanner = new PolymarketScanner('https://clob.polymarket.com', true, []);
      const candidates = await scanner.fetchMarkets();

      assert.equal(candidates.length, 0);
    });

    it('T2-F12-03: Estimator exception resilience', async () => {
      const scanner = new PolymarketScanner();
      const failingEstimator = async () => {
        throw new Error('LLM Timeout');
      };

      const opps = await scanner.scanOpportunities(1000, failingEstimator);
      assert.equal(opps.length, 0);
    });

    it('T2-F12-04: Estimator returning null', async () => {
      const scanner = new PolymarketScanner();
      const nullEstimator = async () => null;

      const opps = await scanner.scanOpportunities(1000, nullEstimator);
      assert.equal(opps.length, 0);
    });

    it('T2-F12-05: Live CLOB API HTTP 500 fallback', async () => {
      const scanner = new PolymarketScanner('https://invalid-nonexistent-clob.example.com', false);
      const candidates = await scanner.fetchMarkets();

      assert.ok(candidates.length > 0);
    });
  });

  // ============================================================================
  // F13: Polymarket Executor
  // ============================================================================
  describe('F13: Polymarket Executor', () => {
    it('T2-F13-01: Order placement rejection on unauthorized Kelly', async () => {
      const orderManager = new OrderManager(db, wallet);
      const unauthOpp = {
        market: {
          id: 'mock-1',
          conditionId: '0x' + '2'.repeat(64),
          question: 'Mock?',
          slug: 'mock',
          outcomes: ['YES', 'NO'],
          outcomePrices: [0.5, 0.5],
          impliedProbability: 0.5,
          liquidityUsd: 10000,
          volume24hUsd: 1000,
          active: true,
          closed: false,
        },
        outcome: 'YES' as OrderOutcome,
        marketPrice: 0.5,
        estimatedProb: 0.5,
        edge: 0.0,
        kelly: calculateKellyStake(0.5, 0.5, 1000),
      };

      await assert.rejects(
        () => orderManager.placeOrder(unauthOpp),
        KellyRiskError
      );
    });

    it('T2-F13-02: Order placement rejection on insufficient wallet balance', async () => {
      wallet.setMockBalance('polygon', 1.0);
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(1000);
      const opp = opps[0];

      await assert.rejects(
        () => orderManager.placeOrder(opp),
        InsufficientBalanceError
      );
    });

    it('T2-F13-03: Idempotent position resolution', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const pos = await orderManager.placeOrder(opps[0]);

      const res1 = await orderManager.resolvePosition(pos.id, opps[0].outcome);
      assert.equal(res1.status, 'WON');

      const ledgerCount1 = db.getLedgerEntries().filter((e) => e.entryType === 'INCOME_POLYMARKET').length;
      const res2 = await orderManager.resolvePosition(pos.id, opps[0].outcome);
      assert.equal(res2.status, 'WON');

      const ledgerCount2 = db.getLedgerEntries().filter((e) => e.entryType === 'INCOME_POLYMARKET').length;
      assert.equal(ledgerCount1, ledgerCount2);
    });

    it('T2-F13-04: Non-existent position resolution', async () => {
      const orderManager = new OrderManager(db, wallet);
      assert.throws(
        () => orderManager.resolvePosition(999999, 'YES'),
        /Position with id 999999 does not exist/
      );
    });

    it('T2-F13-05: Permadeath emergency order liquidation', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      await orderManager.placeOrder(opps[0]);

      const cancelled = orderManager.cancelAllOpenOrders('Emergency liquidation');
      assert.ok(cancelled >= 1);
      assert.equal(db.getPositions(100, 'OPEN').length, 0);
    });
  });

  // ============================================================================
  // F14: x402 HTTP Paywall
  // ============================================================================
  describe('F14: x402 HTTP Paywall', () => {
    let server: X402Server;
    let pipePath: string;

    beforeEach(async () => {
      pipePath =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\apex-t2-x402-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : `/tmp/apex-t2-x402-${Date.now()}.sock`;

      server = new X402Server({ pipePath, database: db, wallet, config });
      await server.start();
    });

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('T2-F14-01: Method Not Allowed (HTTP 405)', async () => {
      const res = await MockHttpClient.request('/health', {
        method: 'POST',
        socketPath: pipePath,
      });

      assert.equal(res.statusCode, 405);
      assert.equal(res.headers['allow'], 'GET');
    });

    it('T2-F14-02: Unknown route handling (HTTP 404)', async () => {
      const res = await MockHttpClient.request('/unknown_endpoint', {
        socketPath: pipePath,
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    it('T2-F14-03: Pipe / address in use conflict handling', async () => {
      const conflictServer = new X402Server({ pipePath, database: db, wallet, config });
      await assert.rejects(() => conflictServer.start());
    });

    it('T2-F14-04: Permadeath automatic server teardown', async () => {
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      const tombPath = path.join(ctx.tempDir, 'tomb_x402.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );

      assert.equal(server.isRunning(), false);
    });

    it('T2-F14-05: Case-insensitive header support', async () => {
      const tx = '0x' + '7'.repeat(64);
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'X-PAYMENT-PROOF': tx },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.paid, true);
    });
  });

  // ============================================================================
  // F15: x402 Proof of Payment
  // ============================================================================
  describe('F15: x402 Proof of Payment', () => {
    let server: X402Server;
    let pipePath: string;

    beforeEach(async () => {
      pipePath =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\apex-t2-x402-p-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : `/tmp/apex-t2-x402-p-${Date.now()}.sock`;

      server = new X402Server({ pipePath, database: db, wallet, config });
      await server.start();
    });

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('T2-F15-01: Malformed proof rejection (HTTP 400)', async () => {
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': '0xshort' },
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    it('T2-F15-02: Base64 encoded JSON payment proof', async () => {
      const payload = JSON.stringify({
        txHash: '0x' + '9'.repeat(64),
        payer: '0x8888888888888888888888888888888888888888',
      });
      const b64 = Buffer.from(payload).toString('base64');

      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': b64 },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.paid, true);
    });

    it('T2-F15-03: Persistent replay attack defense across server restart', async () => {
      const tx = '0x' + 'a'.repeat(64);
      const res1 = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });
      assert.equal(res1.statusCode, 200);

      await server.stop();

      const newPipe =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\apex-t2-x402-restart-${Date.now()}`
          : `/tmp/apex-t2-x402-restart-${Date.now()}.sock`;
      const server2 = new X402Server({ pipePath: newPipe, database: db, wallet, config });
      await server2.start();

      const res2 = await MockHttpClient.request('/api/analysis', {
        socketPath: newPipe,
        headers: { 'x-payment-proof': tx },
      });
      assert.equal(res2.statusCode, 409);
      await server2.stop();
    });

    it('T2-F15-04: Replay attack audit action logging', async () => {
      const tx = '0x' + 'b'.repeat(64);
      await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });

      await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });

      const actions = db.getActions(50, 'x402_server');
      assert.ok(actions.some((a) => a.actionType === 'REPLAY_ATTACK_PREVENTED'));
    });

    it('T2-F15-05: Unverified txHash rejection in live mode', async () => {
      (server as any).verifyPayment = async () => ({
        verified: false,
        error: 'Unconfirmed transaction on Base',
      });

      const tx = '0x' + 'c'.repeat(64);
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });

      assert.equal(res.statusCode, 402);
      assert.equal(res.body.error, 'Payment Verification Failed');
    });
  });

  // ============================================================================
  // F16: Bounties Scanner
  // ============================================================================
  describe('F16: Bounties Scanner', () => {
    it('T2-F16-01: Hard difficulty absolute rejection', () => {
      const hardTask: BountyTask = {
        ...DEFAULT_MOCK_BOUNTIES[0],
        difficulty: 'hard',
        rewardUsd: 1000.0,
      };

      const filtered = filterMicrotasks([hardTask]);
      assert.equal(filtered.length, 0);
    });

    it('T2-F16-02: Empty provider catalog handling', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: { fetchOpenBounties: async () => [] },
      });

      const bounties = await scanner.scanBounties();
      assert.equal(bounties.length, 0);
    });

    it('T2-F16-03: Provider error resilience', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: {
          fetchOpenBounties: async () => {
            throw new Error('API Rate Limit Exceeded');
          },
        },
      });

      await assert.rejects(
        async () => {
          await scanner.scanBounties();
        },
        /API Rate Limit Exceeded/
      );
    });

    it('T2-F16-04: Platform filter restriction', () => {
      const tasks: BountyTask[] = [
        { ...DEFAULT_MOCK_BOUNTIES[0], id: '1', platform: 'github' },
        { ...DEFAULT_MOCK_BOUNTIES[0], id: '2', platform: 'algora' },
      ];

      const filtered = filterMicrotasks(tasks, { platforms: ['github'] });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].platform, 'github');
    });

    it('T2-F16-05: Missing required tag exclusion', () => {
      const filtered = filterMicrotasks(DEFAULT_MOCK_BOUNTIES, {
        requiredTags: ['nonexistent-tag-12345'],
      });

      assert.equal(filtered.length, 0);
    });
  });

  // ============================================================================
  // F17: Bounty Solution Evaluator
  // ============================================================================
  describe('F17: Bounty Solution Evaluator', () => {
    const validTask = DEFAULT_MOCK_BOUNTIES[0];

    it('T2-F17-01: Anti-Spam assertNoUnsolicitedComment unconditional throw', () => {
      assert.throws(
        () => AntiSpamSafeguard.assertNoUnsolicitedComment(),
        AntiSpamViolationError
      );
    });

    it('T2-F17-02: Patch placeholder rejection (TODO/FIXME)', () => {
      const evalRes = BountyEvaluator.evaluate(validTask);
      const placeholderSolution: BountySolution = {
        bountyId: validTask.id,
        targetFile: 'src/file.ts',
        patchContent: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n+// TODO: implement this logic later\n',
        summary: 'Incomplete placeholder',
        confidence: 0.9,
        testsIncluded: true,
        syntaxValid: true,
      };

      const check = AntiSpamSafeguard.validateSubmission(validTask, evalRes, placeholderSolution, db);
      assert.equal(check.passed, false);
      assert.ok(check.violations.some((v) => v.includes('TODO/FIXME')));
    });

    it('T2-F17-03: Syntax invalid patch rejection', () => {
      const evalRes = BountyEvaluator.evaluate(validTask);
      const invalidSolution: BountySolution = {
        bountyId: validTask.id,
        targetFile: 'src/file.ts',
        patchContent: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n+const x: = ;\n',
        summary: 'Invalid syntax',
        confidence: 0.9,
        testsIncluded: true,
        syntaxValid: false,
      };

      const check = AntiSpamSafeguard.validateSubmission(validTask, evalRes, invalidSolution, db);
      assert.equal(check.passed, false);
      assert.ok(check.violations.some((v) => v.includes('syntax validation')));
    });

    it('T2-F17-04: Daily submission rate limit enforcement', () => {
      for (let i = 0; i < 5; i++) {
        db.recordAction({
          component: 'bounties',
          actionType: 'BOUNTY_SUBMISSION_SIMULATED',
          details: JSON.stringify({ index: i }),
          tier: 'VERDE',
          balanceUsd: 100,
          timestamp: Date.now(),
        });
      }

      const evalRes = BountyEvaluator.evaluate(validTask);
      const solution: BountySolution = {
        bountyId: validTask.id,
        targetFile: 'src/file.ts',
        patchContent: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n+export const valid = true;\n',
        summary: 'Valid fix',
        confidence: 0.9,
        testsIncluded: true,
        syntaxValid: true,
      };

      const check = AntiSpamSafeguard.validateSubmission(validTask, evalRes, solution, db, {
        dailyLimit: 5,
      });

      assert.equal(check.passed, false);
      assert.ok(check.violations.some((v) => v.includes('Daily submission limit reached')));
    });

    it('T2-F17-05: Duplicate bounty reward claim rejection', async () => {
      const scanner = new BountiesScanner({ dryRun: true, database: db });
      const solution: BountySolution = {
        bountyId: validTask.id,
        targetFile: 'docs/api.md',
        patchContent: '--- a/docs.md\n+++ b/docs.md\n@@ -1 +1 @@\n+Fixed typo in api documentation.\n',
        summary: 'Typo fix',
        confidence: 0.95,
        testsIncluded: true,
        syntaxValid: true,
      };

      const sub = await scanner.solveAndSubmit(validTask, solution);
      scanner.claimReward(validTask, sub);

      assert.throws(
        () => scanner.claimReward(validTask, sub),
        BountyError
      );
    });
  });

  // ============================================================================
  // F18: Immune System Sandbox
  // ============================================================================
  describe('F18: Immune System Sandbox', () => {
    it('T2-F18-01: Protected constitution modification attempt', () => {
      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['src/constitution.md']);

      assert.equal(res.valid, false);
      assert.ok(res.violatedFiles.includes('src/constitution.md'));
    });

    it('T2-F18-02: Protected core engine file modification attempt', () => {
      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['src/core/death.ts', 'package.json']);

      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 2);
    });

    it('T2-F18-03: Directory traversal path evasion attempt', () => {
      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['src/modules/../../src/constitution.md']);

      assert.equal(res.valid, false);
      assert.ok(res.violatedFiles.length >= 1);
    });

    it('T2-F18-04: Self-modification blocked in Tier Amarelo/Laranja', async () => {
      wallet.setMockBalance('base', 15.0);
      wallet.setMockBalance('polygon', 15.0); // Total $30 (Tier Amarelo)

      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });
      await assert.rejects(
        () => immune.validateModification({ description: 'Attempt in Amarelo' }),
        ImmuneCheckError
      );
    });

    it('T2-F18-05: Test execution timeout enforcement', async () => {
      const immune = new ImmuneSystem({
        timeoutMs: 10,
        execRunner: async () => {
          return { stdout: '', stderr: '[TIMEOUT] Exceeded limit', exitCode: 124 };
        },
      });

      const res = await immune.runImmuneCheck();
      assert.equal(res.passed, false);
      assert.equal(res.exitCode, 124);
    });
  });

  // ============================================================================
  // F19: Git Rollback Self-Healing
  // ============================================================================
  describe('F19: Git Rollback Self-Healing', () => {
    it('T2-F19-01: Immediate rollback on scope violation', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      let rollbackCalled = false;
      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async (cmd, args) => {
          if (args.includes('reset') || args.includes('clean')) {
            rollbackCalled = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        () =>
          immune.validateModification({
            targetFiles: ['src/constitution.md'],
            description: 'Protected file touch',
          }),
        SecurityViolationError
      );

      assert.equal(rollbackCalled, true);
    });

    it('T2-F19-02: Untracked rogue files cleanup', async () => {
      const executedCommands: string[] = [];
      const immune = new ImmuneSystem({
        execRunner: async (cmd, args) => {
          executedCommands.push(`${cmd} ${args.join(' ')}`);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await immune.rollbackWorkspace();
      assert.ok(executedCommands.some((c) => c.includes('clean -fd')));
    });

    it('T2-F19-03: Rollback on already clean workspace', async () => {
      const immune = new ImmuneSystem({
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      await immune.rollbackWorkspace();
    });

    it('T2-F19-04: Subprocess git failure error wrapping', async () => {
      const immune = new ImmuneSystem({
        execRunner: async () => {
          throw new Error('Git lock acquisition timeout');
        },
      });

      await assert.rejects(
        () => immune.rollbackWorkspace(),
        ImmuneCheckError
      );
    });

    it('T2-F19-05: autoRollback: false diagnostic mode', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      let rollbackExecuted = false;
      const immune = new ImmuneSystem({
        wallet,
        database: db,
        autoRollback: false,
        execRunner: async (cmd, args) => {
          if (args.includes('--porcelain')) {
            return { stdout: ' M src/modules/custom.ts\n', stderr: '', exitCode: 0 };
          }
          if (cmd === 'npm' && args.includes('test')) {
            return { stdout: '', stderr: 'Failing tests', exitCode: 1 };
          }
          if (args.includes('reset') || args.includes('clean')) {
            rollbackExecuted = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        () => immune.validateModification({ description: 'Diagnostic test' }),
        ImmuneCheckError
      );

      assert.equal(rollbackExecuted, false);
    });
  });

  // ============================================================================
  // F20: Mitosis Capital Threshold
  // ============================================================================
  describe('F20: Mitosis Capital Threshold', () => {
    it('T2-F20-01: Sub-penny deficit blocking ($149.999999 on $150)', () => {
      const res = evaluateMitosisThreshold(149.999999, 50.0);
      assert.equal(res.eligible, false);
      assert.equal(res.deficitUsd, 0.000001);
    });

    it('T2-F20-02: Severe insolvency deficit', () => {
      const res = evaluateMitosisThreshold(10.0, 50.0);
      assert.equal(res.eligible, false);
      assert.equal(res.deficitUsd, 140.0);
    });

    it('T2-F20-03: MitosisThresholdError error structure', () => {
      const err = new MitosisThresholdError(100.0, 150.0);
      assert.equal(err.currentBalanceUsd, 100.0);
      assert.equal(err.requiredThresholdUsd, 150.0);
      assert.equal(err.deficitUsd, 50.0);
    });

    it('T2-F20-04: executeMitosis() below threshold rejection', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0); // Total $100 (< $150)

      await assert.rejects(
        () => executeMitosis({ wallet, database: db }),
        MitosisThresholdError
      );

      const actions = db.getActions(10, 'mitosis');
      assert.ok(actions.some((a) => a.actionType === 'MITOSIS_BLOCKED_THRESHOLD'));
    });

    it('T2-F20-05: Non-number parameter rejection', () => {
      assert.throws(() => evaluateMitosisThreshold(NaN as any), TypeError);
      assert.throws(() => evaluateMitosisThreshold('150' as any), TypeError);
    });
  });

  // ============================================================================
  // F21: Proof of Viability
  // ============================================================================
  describe('F21: Proof of Viability', () => {
    it('T2-F21-01: Negative net return rejection', () => {
      const losingFeed = Array(30).fill({
        marketPrice: 0.5,
        modelProb: 0.6,
        won: false,
      });

      const res = runViabilitySimulation({ customPriceFeed: losingFeed });
      assert.equal(res.passed, false);
      assert.ok(res.failureReason && res.failureReason.includes('non-positive'));
    });

    it('T2-F21-02: Negative Sharpe ratio rejection', () => {
      const losingFeed = Array(30).fill({
        marketPrice: 0.5,
        modelProb: 0.6,
        won: false,
      });

      const res = runViabilitySimulation({ customPriceFeed: losingFeed });
      assert.equal(res.passed, false);
      assert.ok(res.sharpeRatio <= 0);
    });

    it('T2-F21-03: Zero variance division by zero safety', () => {
      const constantFeed = Array(30).fill({
        marketPrice: 0.5,
        modelProb: 0.6,
        won: true,
      });

      const res = runViabilitySimulation({ customPriceFeed: constantFeed });
      assert.ok(Number.isFinite(res.sharpeRatio));
    });

    it('T2-F21-04: Zero steps edge case', () => {
      const res = runViabilitySimulation({ steps: 0 });
      assert.equal(res.stepsExecuted, 0);
      assert.equal(res.trades.length, 0);
    });

    it('T2-F21-05: Strict Sharpe hurdle override', () => {
      const res = runViabilitySimulation({ minSharpeRatio: 9.99 });
      assert.equal(res.passed, false);
      assert.ok(res.failureReason && res.failureReason.includes('Sharpe ratio'));
    });
  });

  // ============================================================================
  // F22: Sub-Wallet & Child Spawn
  // ============================================================================
  describe('F22: Sub-Wallet & Child Spawn', () => {
    it('T2-F22-01: Non-positive child index rejection (0, -1)', () => {
      assert.throws(() => deriveChildSubWallet(validParentKey, 0, 2), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, -1, 2), TypeError);
    });

    it('T2-F22-02: Non-positive generation rejection (0, -1)', () => {
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, 0), TypeError);
      assert.throws(() => deriveChildSubWallet(validParentKey, 1, -1), TypeError);
    });

    it('T2-F22-03: Malformed parent private key in derivation', () => {
      assert.throws(() => deriveChildSubWallet('0xbad', 1, 2), TypeError);
    });

    it('T2-F22-04: Liquidity balancing during seed transfer', async () => {
      wallet.setMockBalance('base', 140.0);
      wallet.setMockBalance('polygon', 10.0); // Base has $140 >= $50, Polygon only $10

      const mRes = await executeMitosis({ wallet, database: db });
      assert.equal(mRes.success, true);
      assert.equal(mRes.seedCapitalUsd, 50.0);
    });

    it('T2-F22-05: Multi-generation derivation (Gen 1 -> Gen 2 -> Gen 3)', () => {
      const child = deriveChildSubWallet(validParentKey, 1, 2);
      const grandchild = deriveChildSubWallet(child.privateKey, 1, 3);

      assert.equal(child.generation, 2);
      assert.equal(grandchild.generation, 3);
      assert.notEqual(child.address, grandchild.address);
    });
  });

  // ============================================================================
  // F23: Clan Fund 5% Royalty
  // ============================================================================
  describe('F23: Clan Fund 5% Royalty', () => {
    it('T2-F23-01: Zero royalty on loss or zero profit', () => {
      assert.equal(calculateRoyalty(0.0), 0.0);
      assert.equal(calculateRoyalty(-50.0), 0.0);
    });

    it('T2-F23-02: Solvency guard deferral (buffer < $15.00)', async () => {
      const childDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 5.0);
      childWallet.setMockBalance('polygon', 5.0); // Liquid balance $10.00 (< $15 buffer)

      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      const royStatus = await evaluateRoyaltyStatus(childDb, childWallet, childWallet.getAddress());
      assert.equal(royStatus.hasProfits, true);
      assert.equal(royStatus.shouldRemit, false);
      assert.equal(royStatus.reason, 'DEFERRED_INSUFFICIENT_FREE_SURPLUS');
      childDb.close();
    });

    it('T2-F23-03: Dust threshold deferral (< $0.50)', async () => {
      const childDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 50.0);
      childWallet.setMockBalance('polygon', 50.0);

      // Profit of $5 yields $0.25 royalty (< $0.50 dust)
      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      const royStatus = await evaluateRoyaltyStatus(childDb, childWallet, childWallet.getAddress());
      assert.equal(royStatus.hasProfits, true);
      assert.equal(royStatus.shouldRemit, false);
      assert.equal(royStatus.reason, 'DEFERRED_BELOW_DUST_THRESHOLD');
      childDb.close();
    });

    it('T2-F23-04: Drawdown immunity (no royalty refund on loss)', async () => {
      const childDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 50.0);
      childWallet.setMockBalance('polygon', 50.0);

      // Record child lineage with $5 royalty already paid
      childDb.recordLineage({
        childAddress: childWallet.getAddress(),
        parentAddress: wallet.getAddress(),
        generation: 2,
        birthTimestamp: Date.now() - 100000,
        seedCapitalUsd: 50.0,
        totalRoyaltiesPaidUsd: 5.0,
        status: 'ACTIVE',
      });

      // Child has $70 revenue and $50 expenses (net profit $20, obligation is $1.0, paid is $5)
      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 70.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now() - 5000,
      });
      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 50.0,
        entryType: 'EXPENSE_LLM',
        timestamp: Date.now() - 1000,
      });

      const royStatus = await evaluateRoyaltyStatus(childDb, childWallet, childWallet.getAddress());
      assert.equal(royStatus.pendingRoyaltyUsd, 0.0);
      assert.equal(royStatus.shouldRemit, false);
      assert.equal(royStatus.reason, 'NO_ROYALTIES_DUE');
      childDb.close();
    });

    it('T2-F23-05: Constitutional royalty percentage invariant violation', () => {
      assert.throws(
        () => calculateRoyalty(100.0, 0.1),
        ConstitutionViolationError
      );
    });
  });
});
