/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Tier 1 E2E Test Suite
 * ==============================================================================
 * Target: Comprehensive Feature Coverage (Features F01 through F23)
 * Total Test Cases: Exactly 115 tests (5 per feature)
 * Execution: Native Node.js test runner (`node:test` + `node:assert/strict`)
 * Mode: Pure Opaque-Box verification across public module exports & interfaces.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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
  DEFAULT_MOCK_PRIVATE_KEY,
} from '../../src/config.ts';

// Core Engine Services
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet, createApexWallet } from '../../src/core/wallet.ts';
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
} from '../../src/types.ts';

// Triple Revenue Engine
import {
  calculateNetOdds,
  calculateExpectedValue,
  calculateKellyStake,
} from '../../src/modules/polymarket/kelly.ts';
import { PolymarketScanner } from '../../src/modules/polymarket/scanner.ts';
import { OrderManager } from '../../src/modules/polymarket/order.ts';
import { X402Server } from '../../src/modules/micropayments/server.ts';
import {
  BountiesScanner,
  BountyEvaluator,
  AntiSpamSafeguard,
  classifyMicrotask,
  filterMicrotasks,
  DEFAULT_MOCK_BOUNTIES,
  type BountyTask,
  type BountySolution,
} from '../../src/modules/bounties/scanner.ts';

// Evolution & Self-Healing
import { ImmuneSystem } from '../../src/evolution/immune_system.ts';
import {
  evaluateMitosisThreshold,
  runViabilitySimulation,
  deriveChildSubWallet,
  executeMitosis,
  calculateRoyalty,
  evaluateRoyaltyStatus,
  remitRoyalty,
  createChildSpawnConfig,
} from '../../src/evolution/mitosis.ts';

describe('Tier 1 E2E Test Suite: Comprehensive Feature Coverage (F01 - F23)', () => {
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
    it('T1-F01-01: Valid package.json manifest', () => {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      assert.equal(pkg.name, 'apex-aea');
      assert.equal(pkg.type, 'module');
      assert.ok(pkg.scripts?.build, 'scripts.build must be defined');
      assert.ok(pkg.scripts?.test, 'scripts.test must be defined');
      assert.ok(pkg.scripts?.start, 'scripts.start must be defined');
      assert.ok(pkg.dependencies?.viem, 'viem dependency must be present');
    });

    it('T1-F01-02: Valid tsconfig.json configuration', () => {
      const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json');
      assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json must exist');
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

      assert.equal(tsconfig.compilerOptions?.target, 'ES2022');
      assert.equal(tsconfig.compilerOptions?.module, 'NodeNext');
      assert.equal(tsconfig.compilerOptions?.moduleResolution, 'NodeNext');
      assert.equal(tsconfig.compilerOptions?.strict, true);
      assert.equal(tsconfig.compilerOptions?.noEmit, true);
    });

    it('T1-F01-03: scripts/build.js syntax verification pass', () => {
      const buildScriptPath = path.resolve(process.cwd(), 'scripts/build.js');
      assert.ok(fs.existsSync(buildScriptPath), 'scripts/build.js must exist');

      const stdout = execSync('node scripts/build.js', {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      assert.match(stdout, /APEX BUILD SUCCESS/);
    });

    it('T1-F01-04: Git repository initialization and head commit', () => {
      const headCommit = execSync('git rev-parse HEAD', {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();

      assert.equal(headCommit.length, 40, 'Git HEAD must be a 40-character commit hash');
      assert.match(headCommit, /^[0-9a-f]{40}$/);
    });

    it('T1-F01-05: Clean root module importability', async () => {
      const rootModule = await import('../../src/index.ts');

      assert.ok(rootModule.HeartbeatDaemon, 'Must export HeartbeatDaemon');
      assert.ok(rootModule.calculateKellyStake, 'Must export calculateKellyStake');
      assert.ok(rootModule.X402Server, 'Must export X402Server');
      assert.ok(rootModule.BountiesScanner, 'Must export BountiesScanner');
      assert.ok(rootModule.ImmuneSystem, 'Must export ImmuneSystem');
      assert.ok(rootModule.executeMitosis, 'Must export executeMitosis');
    });
  });

  // ============================================================================
  // F02: Multi-Network Config
  // ============================================================================
  describe('F02: Multi-Network Config', () => {
    it('T1-F02-01: Mock mode deterministic configuration load', () => {
      resetConfig();
      const cfg = loadConfig({ NETWORK_MODE: 'mock' });

      assert.equal(cfg.networkMode, 'mock');
      assert.equal(cfg.network.isMock, true);
      assert.equal(cfg.mock.useMockApis, true);
      assert.equal(cfg.initialCapitalUsd, 50.0);
      assert.equal(cfg.privateKey, DEFAULT_MOCK_PRIVATE_KEY);
    });

    it('T1-F02-02: Testnet mode network resolution', () => {
      resetConfig();
      const testnetKey = '0x1111111111111111111111111111111111111111111111111111111111111111';
      const cfg = loadConfig({ NETWORK_MODE: 'testnet', PRIVATE_KEY: testnetKey });

      assert.equal(cfg.networkMode, 'testnet');
      assert.equal(cfg.network.baseRpcUrl, 'https://sepolia.base.org');
      assert.equal(cfg.network.polygonRpcUrl, 'https://rpc-amoy.polygon.technology');
      assert.equal(cfg.network.isMock, false);
    });

    it('T1-F02-03: Mainnet mode network resolution', () => {
      resetConfig();
      const mainnetKey = '0x2222222222222222222222222222222222222222222222222222222222222222';
      const cfg = loadConfig({
        NETWORK_MODE: 'mainnet',
        PRIVATE_KEY: mainnetKey,
        USE_MOCK_APIS: 'false',
      });

      assert.equal(cfg.networkMode, 'mainnet');
      assert.equal(cfg.network.baseRpcUrl, 'https://mainnet.base.org');
      assert.equal(cfg.network.polygonRpcUrl, 'https://polygon-rpc.com');
      assert.equal(cfg.network.isMock, false);
    });

    it('T1-F02-04: Robust .env string parsing', () => {
      const rawEnv = `
        # Initial comment
        export NETWORK_MODE=mock # inline comment
        INITIAL_CAPITAL_USD="50.00" # quoted value
        STR_WITH_HASH="secret#123" # hash in quotes preserved
        SINGLE_QUOTED='single'
      `;
      const parsed = parseEnvFile(rawEnv);

      assert.equal(parsed.NETWORK_MODE, 'mock');
      assert.equal(parsed.INITIAL_CAPITAL_USD, '50.00');
      assert.equal(parsed.STR_WITH_HASH, 'secret#123');
      assert.equal(parsed.SINGLE_QUOTED, 'single');
    });

    it('T1-F02-05: Singleton configuration caching & reset', () => {
      resetConfig();
      const first = getConfig();
      const second = getConfig();
      assert.strictEqual(first, second, 'getConfig must return cached singleton');

      resetConfig();
      const third = getConfig();
      assert.notStrictEqual(first, third, 'resetConfig must flush cached configuration');
    });
  });

  // ============================================================================
  // F03: Immutable Constitution
  // ============================================================================
  describe('F03: Immutable Constitution', () => {
    it('T1-F03-01: Constitution file presence and size', () => {
      const constPath = path.resolve(process.cwd(), 'src/constitution.md');
      assert.ok(fs.existsSync(constPath), 'src/constitution.md must exist');
      const stat = fs.statSync(constPath);
      assert.ok(stat.size > 1000, `Constitution size (${stat.size}) must exceed 1000 bytes`);
    });

    it('T1-F03-02: Structural completeness of all 7 Articles', () => {
      const constText = fs.readFileSync(path.resolve(process.cwd(), 'src/constitution.md'), 'utf8');
      const articleHeaders = [
        '## Article I:',
        '## Article II:',
        '## Article III:',
        '## Article IV:',
        '## Article V:',
        '## Article VI:',
        '## Article VII:',
      ];

      let lastIndex = -1;
      for (const header of articleHeaders) {
        const index = constText.indexOf(header);
        assert.ok(index !== -1, `Article header missing: ${header}`);
        assert.ok(index > lastIndex, `Article headers must appear in strict sequential order: ${header}`);
        lastIndex = index;
      }
    });

    it('T1-F03-03: Article I Whitelist covenant specification', () => {
      const constText = fs.readFileSync(path.resolve(process.cwd(), 'src/constitution.md'), 'utf8');
      assert.match(constText, /Sovereign Whitelist/i);
      assert.match(constText, /Strict Destination Whitelist/i);
      assert.match(constText, /ConstitutionViolationError/);
    });

    it('T1-F03-04: Article II Mathematical risk limits specification', () => {
      const constText = fs.readFileSync(path.resolve(process.cwd(), 'src/constitution.md'), 'utf8');
      assert.match(constText, /0\.25/);
      assert.match(constText, /0\.05/);
      assert.match(constText, /b\s*\\cdot\s*p\s*-\s*q/);
    });

    it('T1-F03-05: Article IV Permadeath sequence specification', () => {
      const constText = fs.readFileSync(path.resolve(process.cwd(), 'src/constitution.md'), 'utf8');
      assert.match(constText, /tombstone\.json/);
      assert.match(constText, /process\.exit\(0\)/);
    });
  });

  // ============================================================================
  // F04: Shared Types & Contracts
  // ============================================================================
  describe('F04: Shared Types & Contracts', () => {
    it('T1-F04-01: ConstitutionViolationError contract', () => {
      const err = new ConstitutionViolationError('Unauthorized address');
      assert.equal(err.name, 'ConstitutionViolationError');
      assert.ok(err.message.includes('[CONSTITUTION VIOLATION]'));
      assert.ok(err instanceof Error);
    });

    it('T1-F04-02: InsolvencyError contract', () => {
      const err = new InsolvencyError();
      assert.equal(err.name, 'InsolvencyError');
      assert.ok(err.message.includes('[INSOLVENCY]'));
      assert.ok(err instanceof Error);
    });

    it('T1-F04-03: KellyRiskError, ImmuneCheckError, MitosisError contracts', () => {
      const errKelly = new KellyRiskError('Invalid edge');
      assert.equal(errKelly.name, 'KellyRiskError');
      assert.ok(errKelly.message.includes('[KELLY RISK]'));
      assert.ok(errKelly instanceof Error);

      const errImmune = new ImmuneCheckError('Test failure');
      assert.equal(errImmune.name, 'ImmuneCheckError');
      assert.ok(errImmune.message.includes('[IMMUNE CHECK]'));
      assert.ok(errImmune instanceof Error);

      const errMitosis = new MitosisError('Insufficient funds');
      assert.equal(errMitosis.name, 'MitosisError');
      assert.ok(errMitosis.message.includes('[MITOSIS]'));
      assert.ok(errMitosis instanceof Error);
    });

    it('T1-F04-04: Financial Ledger entry types validation', () => {
      const validTypes: LedgerEntryType[] = [
        'INCOME_X402',
        'INCOME_POLYMARKET',
        'INCOME_BOUNTY',
        'EXPENSE_GAS',
        'EXPENSE_LLM',
        'ROYALTY_IN',
        'ROYALTY_OUT',
        'SEED_CAPITAL',
      ];
      assert.equal(validTypes.length, 8);
    });

    it('T1-F04-05: MetabolicTier type union validation', () => {
      const tiers: MetabolicTier[] = ['VERDE', 'AMARELO', 'LARANJA', 'VERMELHO'];
      assert.equal(tiers.length, 4);
    });
  });

  // ============================================================================
  // F05: SQLite Persistence
  // ============================================================================
  describe('F05: SQLite Persistence', () => {
    it('T1-F05-01: In-memory schema creation', () => {
      assert.equal(db.isOpen(), true);
      assert.doesNotThrow(() => db.getLedgerEntries());
      assert.doesNotThrow(() => db.getActions());
      assert.doesNotThrow(() => db.getPositions());
      assert.doesNotThrow(() => db.getConfig('test'));
      assert.doesNotThrow(() => db.getLineageByChild('0x0000000000000000000000000000000000000001'));
    });

    it('T1-F05-02: Ledger insertion and revenue/expense aggregation', () => {
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 0.05,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 25.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 0.1,
        entryType: 'EXPENSE_LLM',
        timestamp: Date.now(),
      });

      assert.equal(db.getTotalRevenue(), 25.05);
      assert.equal(db.getTotalExpenses(), 0.1);
      assert.equal(db.getLedgerEntries().length, 3);
    });

    it('T1-F05-03: Actions audit logging', () => {
      db.recordAction({
        component: 'heartbeat',
        actionType: 'TICK',
        details: 'Normal tick cycle',
        tier: 'VERDE',
        balanceUsd: 75.0,
        timestamp: Date.now(),
      });
      db.recordAction({
        component: 'polymarket',
        actionType: 'SCAN',
        details: 'Scanned 10 markets',
        tier: 'VERDE',
        balanceUsd: 75.0,
        timestamp: Date.now(),
      });

      const hbActions = db.getActions(50, 'heartbeat');
      assert.equal(hbActions.length, 1);
      assert.equal(hbActions[0].component, 'heartbeat');
      assert.equal(hbActions[0].actionType, 'TICK');
    });

    it('T1-F05-04: Lineage lifecycle operations', () => {
      const childAddr = '0x1234567890123456789012345678901234567890';
      db.recordLineage({
        childAddress: childAddr,
        parentAddress: '0x0000000000000000000000000000000000000001',
        generation: 2,
        birthTimestamp: Date.now(),
        seedCapitalUsd: 50.0,
        totalRoyaltiesPaidUsd: 0.0,
        status: 'ACTIVE',
      });

      db.updateRoyaltiesPaid(childAddr, 5.0);
      db.updateLineageStatus(childAddr, 'INSOLVENT');

      const lineage = db.getLineageByChild(childAddr);
      assert.ok(lineage);
      assert.equal(lineage.totalRoyaltiesPaidUsd, 5.0);
      assert.equal(lineage.status, 'INSOLVENT');
    });

    it('T1-F05-05: Atomic transaction execution', () => {
      db.transaction(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 50.0,
          entryType: 'SEED_CAPITAL',
          timestamp: Date.now(),
        });
        db.recordAction({
          component: 'system',
          actionType: 'BOOT',
          details: 'Initial boot',
          tier: 'VERDE',
          balanceUsd: 50.0,
          timestamp: Date.now(),
        });
      });

      assert.equal(db.getLedgerEntries().length, 1);
      assert.equal(db.getActions().length, 1);
    });
  });

  // ============================================================================
  // F06: Dual-Chain Wallet
  // ============================================================================
  describe('F06: Dual-Chain Wallet', () => {
    it('T1-F06-01: Wallet initialization and address derivation', async () => {
      const w = createApexWallet(loadConfig({ NETWORK_MODE: 'mock' }));
      const addr = w.getAddress();
      assert.match(addr, /^0x[0-9a-fA-F]{40}$/);

      const total = await w.getTotalBalanceUsd();
      assert.equal(total, 75.0);
    });

    it('T1-F06-02: Balance breakdown across dual chains', async () => {
      const breakdown = await wallet.getBalanceBreakdown();
      assert.equal(breakdown.baseUsdc, 37.5);
      assert.equal(breakdown.polygonUsdc, 37.5);
      assert.equal(breakdown.totalUsd, 75.0);
    });

    it('T1-F06-03: Whitelist pre-population on boot', () => {
      const testWallet = new ApexWallet(loadConfig({
        NETWORK_MODE: 'mock',
        MOTHER_WALLET_ADDRESS: '0x1111111111111111111111111111111111111111',
      }));
      assert.equal(testWallet.isWhitelisted('0x1111111111111111111111111111111111111111'), true);
      assert.equal(testWallet.isWhitelisted('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'), true);
    });

    it('T1-F06-04: Transfer execution on Base', async () => {
      const recipient = '0x9999999999999999999999999999999999999999';
      wallet.addToWhitelist(recipient);

      const txHash = await wallet.transferUsdc('base', recipient, 10.0);
      assert.match(txHash, /^0x[0-9a-fA-F]{64}$/);

      const baseBal = await wallet.getUsdcBalance('base');
      assert.equal(baseBal, 27.5);
    });

    it('T1-F06-05: Transfer execution on Polygon', async () => {
      const recipient = '0x8888888888888888888888888888888888888888';
      wallet.addToWhitelist(recipient);

      const txHash = await wallet.transferUsdc('polygon', recipient, 5.0);
      assert.match(txHash, /^0x[0-9a-fA-F]{64}$/);

      const polyBal = await wallet.getUsdcBalance('polygon');
      assert.equal(polyBal, 32.5);
    });
  });

  // ============================================================================
  // F07: Adaptive Metabolism
  // ============================================================================
  describe('F07: Adaptive Metabolism', () => {
    it('T1-F07-01: Tier Verde evaluation (> $50)', () => {
      const status = evaluateTier(75.0);
      assert.equal(status.tier, 'VERDE');
      assert.equal(status.modelClass, 'advanced');
      assert.equal(status.heartbeatIntervalMs, 60000);
      assert.equal(status.allowSpeculativeResearch, true);
      assert.equal(status.allowSelfModification, true);
    });

    it('T1-F07-02: Tier Amarelo evaluation ($10 to $50)', () => {
      const status = evaluateTier(25.0);
      assert.equal(status.tier, 'AMARELO');
      assert.equal(status.modelClass, 'economic');
      assert.equal(status.heartbeatIntervalMs, 300000);
      assert.equal(status.allowSpeculativeResearch, false);
      assert.equal(status.allowSelfModification, false);
    });

    it('T1-F07-03: Tier Laranja evaluation ($2 to $10)', () => {
      const status = evaluateTier(5.0);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.modelClass, 'survival');
      assert.equal(status.heartbeatIntervalMs, 60000);
    });

    it('T1-F07-04: Critical survival sub-tier evaluation ($0 < B < $2)', () => {
      const status = evaluateTier(1.5);
      assert.equal(status.tier, 'LARANJA');
      assert.equal(status.reason, 'CRITICAL_SURVIVAL_SUB_TIER');
      assert.equal(isCriticalSurvival(1.5), true);
    });

    it('T1-F07-05: Tier Vermelho evaluation (<= $0)', () => {
      const status = evaluateTier(0.0);
      assert.equal(status.tier, 'VERMELHO');
      assert.equal(status.heartbeatIntervalMs, 0);
      assert.equal(isTerminalInsolvency(0.0), true);
    });
  });

  // ============================================================================
  // F08: Permadeath Protocol
  // ============================================================================
  describe('F08: Permadeath Protocol', () => {
    it('T1-F08-01: Permadeath clean exit handler interception', async () => {
      let exitCode: number | null = null;
      setExitHandler((code: number): never => {
        exitCode = code;
        throw new Error(`EXIT_${code}`);
      });

      const tombPath = path.join(ctx.tempDir, 'tombstone_clean.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );
      assert.equal(exitCode, 0);
    });

    it('T1-F08-02: tombstone.json post-mortem generation', async () => {
      const tombPath = path.join(ctx.tempDir, 'tombstone_verify.json');
      setExitHandler((): never => {
        throw new Error('EXIT_0');
      });

      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath, agentAddress: wallet.getAddress() }),
        /EXIT_0/
      );

      const tombstone = ConstitutionalAssert.assertTombstoneSnapshot(tombPath);
      assert.equal(tombstone.agentAddress, wallet.getAddress());
      assert.equal(tombstone.finalBalanceUsd, 0.0);
    });

    it('T1-F08-03: Teardown hooks execution', async () => {
      let hook1Called = false;
      let hook2Called = false;

      registerTeardownHook(() => { hook1Called = true; });
      registerTeardownHook(() => { hook2Called = true; });

      setExitHandler((): never => { throw new Error('EXIT_0'); });

      const tombPath = path.join(ctx.tempDir, 'tombstone_hooks.json');
      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath }),
        /EXIT_0/
      );

      assert.equal(hook1Called, true);
      assert.equal(hook2Called, true);
    });

    it('T1-F08-04: Financial aggregation in tombstone', async () => {
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 10.0,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 2.0,
        entryType: 'EXPENSE_LLM',
        timestamp: Date.now(),
      });

      setExitHandler((): never => { throw new Error('EXIT_0'); });
      const tombPath = path.join(ctx.tempDir, 'tombstone_fin.json');

      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath, database: db }),
        /EXIT_0/
      );

      const content = JSON.parse(fs.readFileSync(tombPath, 'utf8'));
      assert.equal(content.totalRevenueGenerated, 10.0);
      assert.equal(content.totalExpensesIncurred, 2.0);
    });

    it('T1-F08-05: Lineage insolvency marking on permadeath', async () => {
      const childAddr = '0x3333333333333333333333333333333333333333';
      const fileDbPath = path.join(ctx.tempDir, 'tombstone_lineage.sqlite');
      const testDb = new DatabaseService(fileDbPath);

      testDb.recordLineage({
        childAddress: childAddr,
        parentAddress: wallet.getAddress(),
        generation: 2,
        birthTimestamp: Date.now(),
        seedCapitalUsd: 50.0,
        totalRoyaltiesPaidUsd: 0.0,
        status: 'ACTIVE',
      });

      setExitHandler((): never => { throw new Error('EXIT_0'); });
      const tombPath = path.join(ctx.tempDir, 'tombstone_lineage.json');

      await assert.rejects(
        () => executePermadeath({ tombstonePath: tombPath, database: testDb, agentAddress: childAddr }),
        /EXIT_0/
      );

      assert.equal(testDb.isOpen(), false, 'Database must be closed upon permadeath');

      const verifyDb = new DatabaseService(fileDbPath);
      const record = verifyDb.getLineageByChild(childAddr);
      assert.equal(record?.status, 'INSOLVENT');
      verifyDb.close();
    });
  });

  // ============================================================================
  // F09: Heartbeat Daemon
  // ============================================================================
  describe('F09: Heartbeat Daemon', () => {
    it('T1-F09-01: Heartbeat tick in Tier Verde', async () => {
      const daemon = new HeartbeatDaemon({ wallet, database: db, config });
      const res = await daemon.tick();

      assert.equal(res.success, true);
      assert.equal(res.tier, 'VERDE');
      assert.equal(res.heartbeatIntervalMs, 60000);

      const actions = db.getActions(10, 'heartbeat');
      assert.ok(actions.some((a) => a.actionType === 'TICK_EVALUATED'));
    });

    it('T1-F09-02: Heartbeat tick in Tier Amarelo', async () => {
      wallet.setMockBalance('base', 15.0);
      wallet.setMockBalance('polygon', 15.0);

      const daemon = new HeartbeatDaemon({ wallet, database: db, config });
      const res = await daemon.tick();

      assert.equal(res.tier, 'AMARELO');
      assert.equal(res.heartbeatIntervalMs, 300000);
    });

    it('T1-F09-03: Heartbeat tick in Tier Laranja', async () => {
      wallet.setMockBalance('base', 2.5);
      wallet.setMockBalance('polygon', 2.5);

      const daemon = new HeartbeatDaemon({ wallet, database: db, config });
      const res = await daemon.tick();

      assert.equal(res.tier, 'LARANJA');
      assert.equal(res.heartbeatIntervalMs, 60000);
    });

    it('T1-F09-04: Bounded execution with maxCycles', async () => {
      const daemon = new HeartbeatDaemon({
        wallet,
        database: db,
        config,
        maxCycles: 3,
        intervalOverrideMs: 10,
      });

      await daemon.start();
      for (let i = 0; i < 20 && daemon.isRunning; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }

      assert.equal(daemon.cycleCount, 3);
      assert.equal(daemon.isRunning, false);
    });

    it('T1-F09-05: Graceful daemon stop', async () => {
      const daemon = new HeartbeatDaemon({ wallet, database: db, config });
      await daemon.stop('User request');

      assert.equal(daemon.isRunning, false);
      const actions = db.getActions(10, 'heartbeat');
      assert.ok(actions.some((a) => a.actionType === 'DAEMON_STOPPED'));
    });
  });

  // ============================================================================
  // F10: Fractional Quarter-Kelly
  // ============================================================================
  describe('F10: Fractional Quarter-Kelly', () => {
    it('T1-F10-01: Net decimal odds computation', () => {
      const b = calculateNetOdds(0.4);
      assert.equal(b, 1.5);
    });

    it('T1-F10-02: Expected Value computation', () => {
      const ev = calculateExpectedValue(1.5, 0.6, 0.4);
      assert.equal(ev, 0.5);
    });

    it('T1-F10-03: Raw Kelly fraction computation', () => {
      const b = 1.5;
      const ev = calculateExpectedValue(b, 0.6, 0.4);
      const rawKelly = ev / b;
      assert.equal(Number(rawKelly.toFixed(6)), 0.333333);
    });

    it('T1-F10-04: Quarter-Kelly fraction computation', () => {
      const result = calculateKellyStake(0.4, 0.6, 1000);
      assert.equal(Number(result.quarterKellyFraction.toFixed(6)), 0.083333);
    });

    it('T1-F10-05: Sizing on 50/50 market with edge', () => {
      const result = calculateKellyStake(0.5, 0.6, 1000);
      assert.equal(result.b, 1.0);
      assert.equal(result.expectedValue, 0.2);
      assert.equal(result.allocatedFraction, 0.05);
      assert.equal(result.stakeAmountUsd, 50.0);
    });
  });

  // ============================================================================
  // F11: Risk Hurdle & 5% Cap
  // ============================================================================
  describe('F11: Risk Hurdle & 5% Cap', () => {
    it('T1-F11-01: Clamping to 5% bankroll cap', () => {
      const result = calculateKellyStake(0.4, 0.6, 1000);
      assert.equal(result.allocatedFraction, 0.05);
      assert.equal(result.stakeAmountUsd, 50.0);
    });

    it('T1-F11-02: Unclamped allocation below 5%', () => {
      const result = calculateKellyStake(0.5, 0.54, 1000);
      assert.equal(result.allocatedFraction, 0.02);
      assert.equal(result.stakeAmountUsd, 20.0);
    });

    it('T1-F11-03: Minimum order floor authorization', () => {
      const result = calculateKellyStake(0.5, 0.54, 100);
      assert.equal(result.authorized, true);
      assert.equal(result.stakeAmountUsd, 2.0);
    });

    it('T1-F11-04: Rejection on zero expected value', () => {
      const result = calculateKellyStake(0.5, 0.5, 1000);
      assert.equal(result.authorized, false);
      assert.equal(result.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
      assert.equal(result.stakeAmountUsd, 0);
    });

    it('T1-F11-05: Rejection on negative expected value', () => {
      const result = calculateKellyStake(0.6, 0.4, 1000);
      assert.equal(result.authorized, false);
      assert.equal(result.rejectionReason, 'REJECTED_NON_POSITIVE_EV');
    });
  });

  // ============================================================================
  // F12: Polymarket Scanner
  // ============================================================================
  describe('F12: Polymarket Scanner', () => {
    it('T1-F12-01: Ingestion of standard mock market catalog', async () => {
      const scanner = new PolymarketScanner();
      const markets = await scanner.fetchMarkets();
      assert.ok(markets.length > 0);
    });

    it('T1-F12-02: Discard inactive and closed markets', async () => {
      const scanner = new PolymarketScanner();
      const markets = await scanner.fetchMarkets();

      for (const m of markets) {
        assert.equal(m.active, true);
        assert.equal(m.closed, false);
      }
    });

    it('T1-F12-03: Liquidity and volume hurdle filtering', async () => {
      const scanner = new PolymarketScanner();
      const markets = await scanner.fetchMarkets({
        minLiquidityUsd: 1000,
        minVolume24hUsd: 500,
      });

      for (const m of markets) {
        assert.ok(m.liquidityUsd >= 1000);
        assert.ok(m.volume24hUsd >= 500);
      }
    });

    it('T1-F12-04: Opportunity scanning and edge detection', async () => {
      const scanner = new PolymarketScanner();
      const opportunities = await scanner.scanOpportunities(1000);

      assert.ok(opportunities.length > 0);
      assert.equal(opportunities[0].kelly.authorized, true);
      assert.ok(opportunities[0].edge > 0);
    });

    it('T1-F12-05: Opportunity sorting by edge descending', async () => {
      const scanner = new PolymarketScanner();
      const opportunities = await scanner.scanOpportunities(1000);

      for (let i = 0; i < opportunities.length - 1; i++) {
        assert.ok(opportunities[i].edge >= opportunities[i + 1].edge);
      }
    });
  });

  // ============================================================================
  // F13: Polymarket Executor
  // ============================================================================
  describe('F13: Polymarket Executor', () => {
    it('T1-F13-01: Order placement and position recording', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const opp = opps[0];

      const pos = await orderManager.placeOrder(opp);
      assert.equal(pos.status, 'OPEN');

      const saved = db.getPositionById(pos.id);
      assert.ok(saved);
      assert.equal(saved.status, 'OPEN');
    });

    it('T1-F13-02: Winning position resolution and payout ledger entry', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const opp = opps[0];

      const pos = await orderManager.placeOrder(opp);
      const resolved = await orderManager.resolvePosition(pos.id, opp.outcome);

      assert.equal(resolved.status, 'WON');
      const ledger = db.getLedgerEntries();
      assert.ok(ledger.some((l) => l.entryType === 'INCOME_POLYMARKET'));
    });

    it('T1-F13-03: Losing position resolution', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const opp = opps[0];

      const pos = await orderManager.placeOrder(opp);
      const losingOutcome = opp.outcome === 'YES' ? 'NO' : 'YES';
      const resolved = await orderManager.resolvePosition(pos.id, losingOutcome);

      assert.equal(resolved.status, 'LOST');
      assert.equal(resolved.payoutUsd, 0.0);
    });

    it('T1-F13-04: Position cancellation', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const opp = opps[0];

      const pos = await orderManager.placeOrder(opp);
      const cancelled = await orderManager.cancelPosition(pos.id, 'Market invalidated');

      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.payoutUsd, pos.stakeUsd);
    });

    it('T1-F13-05: Performance summary aggregation', async () => {
      const orderManager = new OrderManager(db, wallet);
      const scanner = new PolymarketScanner();
      const opps = await scanner.scanOpportunities(100);
      const opp = opps[0];

      const pos = await orderManager.placeOrder(opp);
      await orderManager.resolvePosition(pos.id, opp.outcome);

      const summary = orderManager.getPositionSummary();
      assert.ok(summary.totalPositions >= 1);
      assert.ok('winRate' in summary);
      assert.ok('netProfitUsd' in summary);
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
          ? `\\\\.\\pipe\\apex-t1-x402-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : `/tmp/apex-t1-x402-${Date.now()}.sock`;

      server = new X402Server({ pipePath, database: db, wallet, config });
      await server.start();
    });

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('T1-F14-01: Server startup on ephemeral pipe/port', () => {
      assert.equal(server.isRunning(), true);
    });

    it('T1-F14-02: Public /health endpoint response', async () => {
      const res = await MockHttpClient.request('/health', { socketPath: pipePath });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.status, 'healthy');
      assert.equal(res.body.agent, 'Apex-AEA');
    });

    it('T1-F14-03: Public /api/paywall/info invoice parameters', async () => {
      const res = await MockHttpClient.request('/api/paywall/info', { socketPath: pipePath });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.pricing);
      assert.ok(res.body.pricing.priceUsdc);
      assert.ok(res.body.pricing.recipientAddress);
    });

    it('T1-F14-04: HTTP 402 Payment Required on gated resource', async () => {
      const res = await MockHttpClient.request('/api/analysis', { socketPath: pipePath });
      assert.equal(res.statusCode, 402);
      assert.equal(res.headers['x-payment-required'], 'true');
    });

    it('T1-F14-05: Clean server shutdown', async () => {
      await server.stop();
      assert.equal(server.isRunning(), false);
      await assert.rejects(() => MockHttpClient.request('/health', { socketPath: pipePath }));
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
          ? `\\\\.\\pipe\\apex-t1-x402-p-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : `/tmp/apex-t1-x402-p-${Date.now()}.sock`;

      server = new X402Server({ pipePath, database: db, wallet, config });
      await server.start();
    });

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('T1-F15-01: Unlock gated analysis with valid txHash', async () => {
      const tx = '0x' + 'a'.repeat(64);
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['x-payment-settled'], 'true');
      assert.equal(res.body.paid, true);
      assert.ok(res.body.intelligence);
    });

    it('T1-F15-02: Unlock analysis with JSON payment proof', async () => {
      const proof = JSON.stringify({
        txHash: '0x' + 'b'.repeat(64),
        payer: '0x9999999999999999999999999999999999999999',
      });
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': proof },
      });

      assert.equal(res.statusCode, 200);
    });

    it('T1-F15-03: Unlock analysis with Bearer authorization header', async () => {
      const res = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { authorization: 'Bearer 0x' + 'c'.repeat(64) },
      });

      assert.equal(res.statusCode, 200);
    });

    it('T1-F15-04: Atomic INCOME_X402 settlement in SQLite', async () => {
      const tx = '0x' + 'd'.repeat(64);
      await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });

      const entries = db.getLedgerEntries().filter((e) => e.entryType === 'INCOME_X402');
      assert.ok(entries.length >= 1);
      assert.equal(entries[0].amount, 0.05);
    });

    it('T1-F15-05: Replay attack defense (HTTP 409 Conflict)', async () => {
      const tx = '0x' + 'e'.repeat(64);
      const res1 = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });
      assert.equal(res1.statusCode, 200);

      const res2 = await MockHttpClient.request('/api/analysis', {
        socketPath: pipePath,
        headers: { 'x-payment-proof': tx },
      });
      assert.equal(res2.statusCode, 409);
    });
  });

  // ============================================================================
  // F16: Bounties Scanner
  // ============================================================================
  describe('F16: Bounties Scanner', () => {
    it('T1-F16-01: Microtask classification across categories', () => {
      assert.equal(classifyMicrotask(DEFAULT_MOCK_BOUNTIES[0]), 'documentation');
      assert.equal(
        classifyMicrotask({
          ...DEFAULT_MOCK_BOUNTIES[1],
          description: 'Add comprehensive unit tests in test/utils.test.ts covering null values',
        }),
        'tests'
      );
      assert.equal(classifyMicrotask(DEFAULT_MOCK_BOUNTIES[2]), 'linting');
      assert.equal(classifyMicrotask(DEFAULT_MOCK_BOUNTIES[3]), 'bugfix');
    });

    it('T1-F16-02: Negative complexity filter', () => {
      const complexTask: BountyTask = {
        ...DEFAULT_MOCK_BOUNTIES[0],
        title: 'Refactor architecture',
        description: 'Complete architecture refactor for zk-rollup bridge',
        tags: ['architecture'],
      };
      assert.equal(classifyMicrotask(complexTask), 'other');
    });

    it('T1-F16-03: Minimum reward filtering', () => {
      const filtered = filterMicrotasks(DEFAULT_MOCK_BOUNTIES, { minRewardUsd: 10.0 });
      assert.ok(!filtered.some((t) => t.rewardUsd < 10.0));
    });

    it('T1-F16-04: Status filtering (OPEN only)', () => {
      const tasks: BountyTask[] = [
        { ...DEFAULT_MOCK_BOUNTIES[0], id: '1', status: 'OPEN' },
        { ...DEFAULT_MOCK_BOUNTIES[0], id: '2', status: 'ACCEPTED' },
      ];
      const filtered = filterMicrotasks(tasks);
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, '1');
    });

    it('T1-F16-05: Discovered bounties persistence', async () => {
      const scanner = new BountiesScanner({ database: db });
      await scanner.scanBounties();

      const actions = db.getActions(50, 'bounties');
      assert.ok(actions.some((a) => a.actionType === 'BOUNTY_DISCOVERED'));
    });
  });

  // ============================================================================
  // F17: Bounty Solution Evaluator
  // ============================================================================
  describe('F17: Bounty Solution Evaluator', () => {
    const validTask: BountyTask = DEFAULT_MOCK_BOUNTIES[0];

    const validSolution: BountySolution = {
      bountyId: validTask.id,
      targetFile: 'docs/api.md',
      patchContent: '--- a/docs/api.md\n+++ b/docs/api.md\n@@ -10 +10 @@\n-broken auth link\n+https://api.example.com/auth\n',
      summary: 'Fix API link',
      confidence: 0.95,
      testsIncluded: true,
      syntaxValid: true,
    };

    it('T1-F17-01: Feasibility scoring on clear microtask', () => {
      const evaluation = BountyEvaluator.evaluate(validTask);
      assert.ok(evaluation.score >= 0.7);
      assert.equal(evaluation.isFeasible, true);
      assert.ok(evaluation.expectedNetProfitUsd > 0);
    });

    it('T1-F17-02: Anti-spam safeguard pass on valid solution', () => {
      const evalRes = BountyEvaluator.evaluate(validTask);
      const check = AntiSpamSafeguard.validateSubmission(validTask, evalRes, validSolution, db);

      assert.equal(check.passed, true);
      assert.equal(check.submissionAllowed, true);
      assert.equal(check.violations.length, 0);
    });

    it('T1-F17-03: Dry-run submission execution', async () => {
      const scanner = new BountiesScanner({ dryRun: true, database: db });
      const submission = await scanner.solveAndSubmit(validTask, validSolution);

      assert.ok(submission.prUrl.includes('simulated'));
      const actions = db.getActions(50, 'bounties');
      assert.ok(actions.some((a) => a.actionType === 'BOUNTY_SUBMISSION_SIMULATED'));
    });

    it('T1-F17-04: Reward claim and ledger persistence', async () => {
      const scanner = new BountiesScanner({ dryRun: true, database: db });
      const submission = await scanner.solveAndSubmit(validTask, validSolution);

      scanner.claimReward(validTask, submission);
      assert.equal(submission.rewardClaimed, true);

      const entries = db.getLedgerEntries().filter((e) => e.entryType === 'INCOME_BOUNTY');
      assert.ok(entries.length >= 1);
      assert.equal(entries[0].amount, 25.0);
    });

    it('T1-F17-05: Bounty metrics and stats aggregation', async () => {
      const scanner = new BountiesScanner({ dryRun: true, database: db });
      await scanner.scanBounties();
      const sub = await scanner.solveAndSubmit(validTask, validSolution);
      scanner.claimReward(validTask, sub);

      const stats = scanner.getStats();
      assert.ok(stats.totalScanned >= 1);
      assert.ok(stats.totalRevenueUsd >= 25.0);
    });
  });

  // ============================================================================
  // F18: Immune System Sandbox
  // ============================================================================
  describe('F18: Immune System Sandbox', () => {
    it('T1-F18-01: Constitutional scope verification on modules', () => {
      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['src/modules/polymarket/custom_strategy.ts']);

      assert.equal(res.valid, true);
      assert.equal(res.violatedFiles.length, 0);
    });

    it('T1-F18-02: Constitutional scope verification on prompts & strategies', () => {
      const immune = new ImmuneSystem();
      const res = immune.verifyConstitutionalScope(['prompts/alpha.md', 'strategies/kelly_variant.ts']);

      assert.equal(res.valid, true);
      assert.equal(res.violatedFiles.length, 0);
    });

    it('T1-F18-03: Pre-deployment syntax build check', async () => {
      const immune = new ImmuneSystem({
        execRunner: async () => ({ stdout: 'PASS', stderr: '', exitCode: 0 }),
      });
      const res = await immune.runBuildCheck();

      assert.equal(res.passed, true);
      assert.equal(res.exitCode, 0);
    });

    it('T1-F18-04: Sandboxed automated test execution', async () => {
      const mockImmune = new ImmuneSystem({
        execRunner: async () => ({ stdout: 'PASS', stderr: '', exitCode: 0 }),
      });
      const res = await mockImmune.runImmuneCheck();

      assert.equal(res.passed, true);
      assert.equal(res.exitCode, 0);
    });

    it('T1-F18-05: Verification in Tier Verde', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async (cmd, args) => {
          if (args.includes('--porcelain')) {
            return { stdout: ' M src/modules/polymarket/custom.ts\n', stderr: '', exitCode: 0 };
          }
          return { stdout: 'PASS', stderr: '', exitCode: 0 };
        },
      });

      const res = await immune.validateModification({ description: 'Strategy update' });
      assert.equal(res.authorized, true);
      assert.equal(res.rollbackExecuted, false);

      const actions = db.getActions(10, 'immune_system');
      assert.ok(actions.some((a) => a.actionType === 'IMMUNE_SYSTEM_VERIFIED'));
    });
  });

  // ============================================================================
  // F19: Git Rollback Self-Healing
  // ============================================================================
  describe('F19: Git Rollback Self-Healing', () => {
    it('T1-F19-01: Explicit workspace rollback', async () => {
      const commandsExecuted: string[] = [];
      const immune = new ImmuneSystem({
        execRunner: async (cmd, args) => {
          commandsExecuted.push(`${cmd} ${args.join(' ')}`);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await immune.rollbackWorkspace();
      assert.ok(commandsExecuted.some((c) => c.includes('reset --hard HEAD')));
      assert.ok(commandsExecuted.some((c) => c.includes('clean -fd')));
    });

    it('T1-F19-02: Inspection of working tree diff', async () => {
      const immune = new ImmuneSystem({
        execRunner: async () => ({
          stdout: 'diff --git a/test.ts b/test.ts\n',
          stderr: '',
          exitCode: 0,
        }),
      });

      const diff = await immune.getDiff();
      assert.ok(diff.includes('diff --git'));
    });

    it('T1-F19-03: Automatic rollback on test failure', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async (cmd, args) => {
          if (args.includes('--porcelain')) {
            return { stdout: ' M src/modules/polymarket/custom.ts\n', stderr: '', exitCode: 0 };
          }
          if (cmd === 'npm' && args.includes('test')) {
            return { stdout: 'FAIL', stderr: '1 test failed', exitCode: 1 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        () => immune.validateModification({ description: 'Failing test code' }),
        ImmuneCheckError
      );

      const actions = db.getActions(10, 'immune_system');
      assert.ok(actions.some((a) => a.actionType === 'IMMUNE_SYSTEM_ROLLBACK'));
    });

    it('T1-F19-04: Automatic rollback on syntax build failure', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async (cmd, args) => {
          if (args.includes('--porcelain')) {
            return { stdout: ' M src/modules/polymarket/custom.ts\n', stderr: '', exitCode: 0 };
          }
          if (args.includes('scripts/build.js')) {
            return { stdout: '', stderr: 'Syntax error detected', exitCode: 1 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        () => immune.validateModification({ description: 'Syntax break' }),
        ImmuneCheckError
      );
    });

    it('T1-F19-05: Audit action logging of failed diff', async () => {
      wallet.setMockBalance('base', 50.0);
      wallet.setMockBalance('polygon', 50.0);

      const immune = new ImmuneSystem({
        wallet,
        database: db,
        execRunner: async (cmd, args) => {
          if (args.includes('--porcelain')) {
            return { stdout: ' M src/modules/broken.ts\n', stderr: '', exitCode: 0 };
          }
          if (cmd === 'npm' && args.includes('test')) {
            return { stdout: '', stderr: 'Failure', exitCode: 1 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      try {
        await immune.validateModification({ description: 'Audit test' });
      } catch {
        // Expected
      }

      const actions = db.getActions(50, 'immune_system');
      const rollbackAction = actions.find((a) => a.actionType === 'IMMUNE_SYSTEM_ROLLBACK');
      assert.ok(rollbackAction);
      assert.ok(rollbackAction.details);
    });
  });

  // ============================================================================
  // F20: Mitosis Capital Threshold
  // ============================================================================
  describe('F20: Mitosis Capital Threshold', () => {
    it('T1-F20-01: Exact 3x capital threshold eligibility', () => {
      const res = evaluateMitosisThreshold(150.0, 50.0);
      assert.equal(res.eligible, true);
      assert.equal(res.surplusUsd, 0.0);
      assert.equal(res.deficitUsd, 0.0);
    });

    it('T1-F20-02: Surplus calculation above 3x', () => {
      const res = evaluateMitosisThreshold(200.0, 50.0);
      assert.equal(res.eligible, true);
      assert.equal(res.surplusUsd, 50.0);
    });

    it('T1-F20-03: Capital partitioning (1/3 child seed, 2/3 mother retained)', () => {
      const res = evaluateMitosisThreshold(150.0, 50.0);
      assert.equal(res.childSeedAllocationUsd, 50.0);
      assert.equal(res.motherRetainedUsd, 100.0);
    });

    it('T1-F20-04: Proportional partitioning on surplus', () => {
      const res = evaluateMitosisThreshold(300.0, 50.0);
      assert.equal(res.childSeedAllocationUsd, 100.0);
      assert.equal(res.motherRetainedUsd, 200.0);
    });

    it('T1-F20-05: Custom initial capital threshold', () => {
      const res = evaluateMitosisThreshold(300.0, 100.0);
      assert.equal(res.thresholdRequiredUsd, 300.0);
      assert.equal(res.eligible, true);
    });
  });

  // ============================================================================
  // F21: Proof of Viability
  // ============================================================================
  describe('F21: Proof of Viability', () => {
    it('T1-F21-01: Positive-expectancy simulation benchmark', () => {
      const res = runViabilitySimulation();
      assert.equal(res.passed, true);
      assert.ok(res.sharpeRatio > 0);
      assert.ok(res.netReturnUsd > 0);
    });

    it('T1-F21-02: Trade step logging and progression', () => {
      const res = runViabilitySimulation();
      assert.equal(res.trades.length, 30);
      const t = res.trades[0];
      assert.ok('marketPrice' in t);
      assert.ok('modelEstimatedProb' in t);
      assert.ok('stakeUsd' in t);
      assert.ok('pnlUsd' in t);
      assert.ok('resultingBankrollUsd' in t);
    });

    it('T1-F21-03: Performance metrics consistency', () => {
      const res = runViabilitySimulation();
      const wins = res.trades.filter((t) => t.won).length;
      assert.equal(res.winRate, wins / res.trades.length);
      assert.ok(Math.abs(res.finalBankrollUsd - (res.initialBankrollUsd + res.netReturnUsd)) < 0.0001);
    });

    it('T1-F21-04: Custom step count benchmark', () => {
      const res = runViabilitySimulation({ steps: 50 });
      assert.equal(res.stepsExecuted, 50);
      assert.equal(res.trades.length, 50);
    });

    it('T1-F21-05: Maximum drawdown tracking', () => {
      const res = runViabilitySimulation();
      assert.ok(res.maxDrawdown >= 0);
    });
  });

  // ============================================================================
  // F22: Sub-Wallet & Child Spawn
  // ============================================================================
  describe('F22: Sub-Wallet & Child Spawn', () => {
    it('T1-F22-01: Deterministic HKDF sub-wallet derivation', () => {
      const sub1 = deriveChildSubWallet(validParentKey, 1, 2);
      const sub1Again = deriveChildSubWallet(validParentKey, 1, 2);

      assert.match(sub1.privateKey, /^0x[0-9a-fA-F]{64}$/);
      assert.match(sub1.address, /^0x[0-9a-fA-F]{40}$/);
      assert.equal(sub1.privateKey, sub1Again.privateKey);
      assert.equal(sub1.address, sub1Again.address);
    });

    it('T1-F22-02: Distinct sub-wallets across child indices', () => {
      const sub1 = deriveChildSubWallet(validParentKey, 1, 2);
      const sub2 = deriveChildSubWallet(validParentKey, 2, 2);

      assert.notEqual(sub1.address, sub2.address);
      assert.notEqual(sub1.privateKey, sub2.privateKey);
    });

    it('T1-F22-03: Full mitosis execution workflow', async () => {
      wallet.setMockBalance('base', 75.0);
      wallet.setMockBalance('polygon', 75.0);

      const mRes = await executeMitosis({ wallet, database: db });
      assert.equal(mRes.success, true);
      assert.equal(mRes.seedCapitalUsd, 50.0);

      const ledger = db.getLedgerEntries().filter((l) => l.entryType === 'SEED_CAPITAL');
      assert.ok(ledger.length >= 1);
    });

    it('T1-F22-04: Child lineage persistence', async () => {
      wallet.setMockBalance('base', 75.0);
      wallet.setMockBalance('polygon', 75.0);

      const mRes = await executeMitosis({ wallet, database: db });
      const record = db.getLineageByChild(mRes.childAddress);

      assert.ok(record);
      assert.equal(record.generation, 2);
      assert.equal(record.status, 'ACTIVE');
      assert.equal(record.seedCapitalUsd, 50.0);
    });

    it('T1-F22-05: Child spawn configuration creation', async () => {
      wallet.setMockBalance('base', 75.0);
      wallet.setMockBalance('polygon', 75.0);

      const mRes = await executeMitosis({ wallet, database: db });
      const childConfig = createChildSpawnConfig(
        config,
        mRes.childAddress,
        mRes.childPrivateKey,
        1,
        2,
        {
          kellyFraction: 0.25,
          maxBankrollCap: 0.05,
          heartbeatGreenMs: 60000,
          heartbeatYellowMs: 300000,
          minBountyRewardUsd: 10.0,
          x402PriceUsdc: 0.05,
          polymarketMinEvEdge: 0.02,
          strategyFocus: 'balanced',
        }
      );

      assert.equal(childConfig.privateKey, mRes.childPrivateKey);
      assert.equal(childConfig.motherWalletAddress, config.motherWalletAddress);
    });
  });

  // ============================================================================
  // F23: Clan Fund 5% Royalty
  // ============================================================================
  describe('F23: Clan Fund 5% Royalty', () => {
    it('T1-F23-01: Exact 5% royalty mathematical calculation', () => {
      const roy = calculateRoyalty(100.0);
      assert.equal(roy, 5.0);
    });

    it('T1-F23-02: High-Water Mark cumulative status evaluation', async () => {
      const childDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 50.0);
      childWallet.setMockBalance('polygon', 50.0);

      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      const royStatus = await evaluateRoyaltyStatus(childDb, childWallet, childWallet.getAddress());
      assert.equal(royStatus.hasProfits, true);
      assert.equal(royStatus.cumulativeNetProfitUsd, 100.0);
      assert.equal(royStatus.pendingRoyaltyUsd, 5.0);
      assert.equal(royStatus.shouldRemit, true);
      childDb.close();
    });

    it('T1-F23-03: Royalty remittance execution', async () => {
      const childDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 50.0);
      childWallet.setMockBalance('polygon', 50.0);

      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      const motherAddr = wallet.getAddress();
      const remitRes = await remitRoyalty({
        database: childDb,
        wallet: childWallet,
        motherWalletAddress: motherAddr,
      });

      assert.equal(remitRes.remitted, true);
      assert.equal(remitRes.royaltyAmountUsd, 5.0);

      const entries = childDb.getLedgerEntries().filter((e) => e.entryType === 'ROYALTY_OUT');
      assert.ok(entries.length >= 1);
      childDb.close();
    });

    it('T1-F23-04: Mother clan fund double-entry recording', async () => {
      const childDb = new DatabaseService(':memory:');
      const motherDb = new DatabaseService(':memory:');
      const childWallet = new ApexWallet();
      childWallet.setMockBalance('base', 50.0);
      childWallet.setMockBalance('polygon', 50.0);

      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      const motherAddr = wallet.getAddress();
      await remitRoyalty({
        database: childDb,
        wallet: childWallet,
        motherWalletAddress: motherAddr,
        motherDatabase: motherDb,
      });

      const motherEntries = motherDb.getLedgerEntries().filter((e) => e.entryType === 'ROYALTY_IN');
      assert.ok(motherEntries.length >= 1);

      const actions = motherDb.getActions(10, 'clan_fund');
      assert.ok(actions.some((a) => a.actionType === 'ROYALTY_RECEIVED'));

      childDb.close();
      motherDb.close();
    });

    it('T1-F23-05: Mother wallet automatic whitelisting', async () => {
      const childDb = new DatabaseService(':memory:');
      const freshChildWallet = new ApexWallet();
      const motherAddr = wallet.getAddress();

      freshChildWallet.removeFromWhitelist(motherAddr);
      freshChildWallet.setMockBalance('base', 50.0);

      childDb.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: Date.now(),
      });

      await remitRoyalty({
        database: childDb,
        wallet: freshChildWallet,
        motherWalletAddress: motherAddr,
      });

      assert.equal(freshChildWallet.isWhitelisted(motherAddr), true);
      childDb.close();
    });
  });
});
