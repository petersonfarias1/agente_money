/**
 * ==============================================================================
 * Adversarial Stress & Fuzzing Harness: Database & Wallet
 * ==============================================================================
 * Target components:
 * - src/core/database.ts (SQLite DatabaseSync persistence engine)
 * - src/core/wallet.ts (Dual-chain Viem + Mock sovereign wallet engine)
 *
 * Challenge Dimensions:
 * 1. SQL Injection fuzzing across all string parameters and tables
 * 2. Extreme input boundaries (empty strings, huge strings, emojis, null bytes, unicode)
 * 3. Schema integrity and CHECK constraint enforcement
 * 4. High-volume transactions and deeply nested savepoints with partial rollbacks
 * 5. File persistence, multiple instances and WAL concurrency stress
 * 6. Floating-point USDC conversions and arithmetic precision boundaries
 * 7. Constitutional transfer enforcement and Sovereign Whitelist bypass attacks
 * 8. Balance exhaustion, exact-zero solvency, cross-chain isolation and network error atomicity
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService, getDatabase, resetDatabase } from '../../src/core/database.ts';
import {
  ApexWallet,
  usdcUnitsToNumber,
  numberToUsdcUnits,
  WalletError,
  InsufficientBalanceError,
  InvalidAddressError,
  NetworkError,
  ZERO_ADDRESS,
  DEFAULT_WHITELISTED_EXCHANGES,
  USDC_DECIMALS,
} from '../../src/core/wallet.ts';
import { ConstitutionViolationError } from '../../src/types.ts';
import { loadConfig } from '../../src/config.ts';

// ==============================================================================
// SUITE 1: DATABASE ADVERSARIAL STRESS & FUZZING
// ==============================================================================

describe('Database Adversarial Stress & Fuzzing Tests', () => {
  let db: DatabaseService;
  const tempFileDirs: string[] = [];

  function createTempDbPath(prefix: string): string {
    const dir = path.resolve(`./tmp_stress_${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    tempFileDirs.push(dir);
    return path.join(dir, 'stress.db');
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
    resetDatabase();
    for (const dir of tempFileDirs) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors on busy files
        }
      }
    }
    tempFileDirs.length = 0;
  });

  describe('1.1 SQL Injection Resistance', () => {
    const SQLI_PAYLOADS = [
      `' OR '1'='1`,
      `'; DROP TABLE ledger; --`,
      `'); DELETE FROM actions; --`,
      `" UNION SELECT null, null, null, null, null, null, null; --`,
      `' OR 1=1; ATTACH DATABASE ':memory:' AS evil; --`,
      `admin' --`,
      `' OR '' = '`,
      `1; PRAGMA writable_schema = 1; --`,
      `' AND 1=0 UNION ALL SELECT 1, 'hacked', 'base', 'USDC', 999999, 'INCOME_X402', null, 0 --`,
    ];

    it('should resist SQL injection in insertLedger parameters', () => {
      for (const payload of SQLI_PAYLOADS) {
        const id = db.insertLedger({
          txHash: payload,
          chain: 'base',
          token: payload,
          amount: 10.0,
          entryType: 'INCOME_X402',
          counterparty: payload,
          timestamp: Date.now(),
        });
        assert.ok(id > 0, `Expected insert to succeed with payload: ${payload}`);

        // Verify parameter is stored literally, not executed
        const entries = db.getLedgerEntries(1);
        assert.equal(entries[0].txHash, payload);
        assert.equal(entries[0].counterparty, payload);
      }

      // Assert tables were not dropped or damaged
      const count = db.getLedgerEntries(100).length;
      assert.equal(count, SQLI_PAYLOADS.length);
      assert.equal(db.getTotalRevenue(), 10.0 * SQLI_PAYLOADS.length);
    });

    it('should resist SQL injection in recordAction parameters', () => {
      for (const payload of SQLI_PAYLOADS) {
        const id = db.recordAction({
          component: payload,
          actionType: payload,
          details: payload,
          tier: 'VERDE',
          balanceUsd: 100.0,
          timestamp: Date.now(),
        });
        assert.ok(id > 0);

        const actions = db.getActions(1, payload);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].details, payload);
        assert.equal(actions[0].component, payload);
      }
    });

    it('should resist SQL injection in setConfig / getConfig', () => {
      for (const payload of SQLI_PAYLOADS) {
        db.setConfig(payload, `value_for_${payload}`);
        const val = db.getConfig(payload);
        assert.equal(val, `value_for_${payload}`);
      }
    });

    it('should resist SQL injection in polymarket_positions', () => {
      for (const payload of SQLI_PAYLOADS) {
        const id = db.savePosition({
          conditionId: payload,
          marketId: payload,
          question: `Will injection succeed? ${payload}`,
          outcome: 'YES',
          shares: 50.0,
          avgPrice: 0.5,
          currentValue: 25.0,
          stakeUsd: 25.0,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
        });
        assert.ok(id > 0);

        const pos = db.getPositionById(id);
        assert.ok(pos);
        assert.equal(pos?.conditionId, payload);
      }
    });
  });

  describe('1.2 Adversarial Input Boundaries & Fuzzing', () => {
    it('should handle large string payloads (1 MB) in actions and config', () => {
      const largePayload = 'A'.repeat(1024 * 1024); // 1 MB
      const id = db.recordAction({
        component: 'HEAVY_TEST',
        actionType: 'STRESS_BLOB',
        details: largePayload,
        tier: 'AMARELO',
        balanceUsd: 45.0,
        timestamp: Date.now(),
      });
      assert.ok(id > 0);

      const retrieved = db.getActions(1, 'HEAVY_TEST');
      assert.equal(retrieved[0].details.length, 1024 * 1024);
      assert.equal(retrieved[0].details, largePayload);

      db.setConfig('giant_config', largePayload);
      assert.equal(db.getConfig('giant_config')?.length, 1024 * 1024);
    });

    it('should handle complex unicode, emojis, RTL, and null bytes safely', () => {
      const EXOTIC_STRINGS = [
        '🔥💸🤖🚀 Apex AEA Sovereign Capital 🚀🤖💸🔥',
        'مرحبا بالعالم - اختبار الحقن واللغة العربية',
        'שלום עולם - בדיקת מערכת אוטונומית',
        'こんにちは世界！日本語のテストです。',
        'Line 1\nLine 2\r\nLine 3\tTabbed\bBackspace',
        'Special characters: `~!@#$%^&*()_+-=[]{}|;:",.<>?/\\',
        'Zero-width: \u200B\u200C\u200D\uFEFF',
        'Null byte sequence: Before\0After',
      ];

      for (const str of EXOTIC_STRINGS) {
        const id = db.recordAction({
          component: 'UNICODE_TEST',
          actionType: 'EXOTIC_STRING',
          details: str,
          tier: 'LARANJA',
          balanceUsd: 5.0,
          timestamp: Date.now(),
        });
        assert.ok(id > 0);
      }

      const actions = db.getActions(50, 'UNICODE_TEST');
      assert.equal(actions.length, EXOTIC_STRINGS.length);
    });

    it('should enforce CHECK constraints on ledger invalid values', () => {
      // 1. Negative amount
      assert.throws(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: -0.01,
          entryType: 'EXPENSE_GAS',
          timestamp: Date.now(),
        });
      }, /CHECK constraint failed/);

      // 2. Invalid chain
      assert.throws(() => {
        db.insertLedger({
          chain: 'ethereum' as any,
          token: 'USDC',
          amount: 10.0,
          entryType: 'EXPENSE_GAS',
          timestamp: Date.now(),
        });
      }, /CHECK constraint failed/);

      // 3. Invalid entry type
      assert.throws(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 10.0,
          entryType: 'MALICIOUS_DRAIN' as any,
          timestamp: Date.now(),
        });
      }, /CHECK constraint failed/);
    });

    it('should enforce CHECK constraints on lineage table', () => {
      // Negative seed capital
      assert.throws(() => {
        db.recordLineage({
          childAddress: '0x1111111111111111111111111111111111111111',
          parentAddress: '0x2222222222222222222222222222222222222222',
          generation: 1,
          birthTimestamp: Date.now(),
          seedCapitalUsd: -50.0,
          totalRoyaltiesPaidUsd: 0,
          status: 'ACTIVE',
        });
      }, /CHECK constraint failed/);

      // Generation 0 (< 1)
      assert.throws(() => {
        db.recordLineage({
          childAddress: '0x1111111111111111111111111111111111111111',
          parentAddress: '0x2222222222222222222222222222222222222222',
          generation: 0,
          birthTimestamp: Date.now(),
          seedCapitalUsd: 50.0,
          totalRoyaltiesPaidUsd: 0,
          status: 'ACTIVE',
        });
      }, /CHECK constraint failed/);

      // Invalid status
      assert.throws(() => {
        db.recordLineage({
          childAddress: '0x1111111111111111111111111111111111111111',
          parentAddress: '0x2222222222222222222222222222222222222222',
          generation: 1,
          birthTimestamp: Date.now(),
          seedCapitalUsd: 50.0,
          totalRoyaltiesPaidUsd: 0,
          status: 'ZOMBIE' as any,
        });
      }, /CHECK constraint failed/);
    });

    it('should enforce CHECK constraints on actions and polymarket_positions', () => {
      // Invalid tier in actions
      assert.throws(() => {
        db.recordAction({
          component: 'TEST',
          actionType: 'TEST',
          details: 'invalid tier',
          tier: 'PURPLE' as any,
          balanceUsd: 10.0,
          timestamp: Date.now(),
        });
      }, /CHECK constraint failed/);

      // Invalid outcome in positions
      assert.throws(() => {
        db.savePosition({
          conditionId: '0x123',
          question: 'Valid question?',
          outcome: 'MAYBE' as any,
          shares: 10,
          avgPrice: 0.5,
          currentValue: 5,
          stakeUsd: 5,
          status: 'OPEN',
          openedAt: new Date().toISOString(),
        });
      }, /CHECK constraint failed/);
    });

    it('should aggregate financial figures with zero entries and huge floats accurately', () => {
      assert.equal(db.getTotalRevenue(), 0.0);
      assert.equal(db.getTotalExpenses(), 0.0);

      // Insert 0.0 amounts
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 0.0,
        entryType: 'INCOME_X402',
        timestamp: Date.now(),
      });
      assert.equal(db.getTotalRevenue(), 0.0);

      // Insert massive realistic numbers ($10M)
      const bigAmount = 10_000_000.55;
      db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: bigAmount,
        entryType: 'INCOME_POLYMARKET',
        timestamp: Date.now(),
      });
      assert.equal(db.getTotalRevenue(), bigAmount);

      const bigExpense = 5_000_000.25;
      db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: bigExpense,
        entryType: 'EXPENSE_GAS',
        timestamp: Date.now(),
      });
      assert.equal(db.getTotalExpenses(), bigExpense);
    });
  });

  describe('1.3 High-Volume Transaction Stress & Nested Savepoints', () => {
    it('should handle deeply nested savepoints (30 levels deep)', () => {
      const MAX_DEPTH = 30;

      function recurseNested(depth: number): void {
        db.transaction(() => {
          db.recordAction({
            component: 'DEPTH_TEST',
            actionType: `LEVEL_${depth}`,
            details: `Depth level ${depth}`,
            tier: 'VERDE',
            balanceUsd: 100 - depth,
            timestamp: Date.now(),
          });

          if (depth < MAX_DEPTH) {
            recurseNested(depth + 1);
          }
        });
      }

      recurseNested(1);

      const actions = db.getActions(100, 'DEPTH_TEST');
      assert.equal(actions.length, MAX_DEPTH);
    });

    it('should roll back intermediate nested savepoint without aborting outer transaction', () => {
      db.transaction(() => {
        db.recordAction({
          component: 'ISOLATION_TEST',
          actionType: 'OUTER_1',
          details: 'Should commit',
          tier: 'VERDE',
          balanceUsd: 100,
          timestamp: Date.now(),
        });

        // Nested level 1: will fail and catch
        try {
          db.transaction(() => {
            db.recordAction({
              component: 'ISOLATION_TEST',
              actionType: 'INNER_FAIL',
              details: 'Should be rolled back',
              tier: 'VERDE',
              balanceUsd: 100,
              timestamp: Date.now(),
            });
            throw new Error('Simulated inner failure');
          });
        } catch (err) {
          assert.equal((err as Error).message, 'Simulated inner failure');
        }

        db.recordAction({
          component: 'ISOLATION_TEST',
          actionType: 'OUTER_2',
          details: 'Should also commit',
          tier: 'VERDE',
          balanceUsd: 90,
          timestamp: Date.now(),
        });
      });

      const actions = db.getActions(50, 'ISOLATION_TEST');
      assert.equal(actions.length, 2);
      const actionTypes = actions.map((a) => a.actionType).reverse();
      assert.deepEqual(actionTypes, ['OUTER_1', 'OUTER_2']);
    });

    it('should handle high-volume bulk insertion (1000 items) inside atomic transaction', () => {
      const NUM_RECORDS = 1000;
      const startTime = Date.now();

      db.transaction(() => {
        for (let i = 0; i < NUM_RECORDS; i++) {
          db.insertLedger({
            txHash: `0x${i.toString(16).padStart(64, '0')}`,
            chain: i % 2 === 0 ? 'base' : 'polygon',
            token: 'USDC',
            amount: 1.0,
            entryType: i % 2 === 0 ? 'INCOME_X402' : 'EXPENSE_GAS',
            counterparty: '0x1111111111111111111111111111111111111111',
            timestamp: startTime + i,
          });
        }
      });

      const count = db.getLedgerEntries(NUM_RECORDS + 10).length;
      assert.equal(count, NUM_RECORDS);
      assert.equal(db.getTotalRevenue(), 500.0);
      assert.equal(db.getTotalExpenses(), 500.0);
    });

    it('should completely roll back 1000 bulk insertions when transaction throws', () => {
      const NUM_RECORDS = 1000;

      assert.throws(() => {
        db.transaction(() => {
          for (let i = 0; i < NUM_RECORDS; i++) {
            db.insertLedger({
              chain: 'base',
              token: 'USDC',
              amount: 1.0,
              entryType: 'INCOME_BOUNTY',
              timestamp: Date.now(),
            });
          }
          throw new Error('Forced catastrophic transaction rollback');
        });
      }, /Forced catastrophic transaction rollback/);

      const count = db.getLedgerEntries(100).length;
      assert.equal(count, 0);
      assert.equal(db.getTotalRevenue(), 0.0);
    });
  });

  describe('1.4 File-Based Persistence & WAL Concurrency', () => {
    it('should persist data across separate DatabaseService instances on disk', () => {
      const filePath = createTempDbPath('persistence');
      const db1 = new DatabaseService(filePath);

      db1.insertLedger({
        txHash: '0xfilepersist001',
        chain: 'base',
        token: 'USDC',
        amount: 250.75,
        entryType: 'SEED_CAPITAL',
        timestamp: 1700000000000,
      });
      db1.setConfig('AGENT_STATE', 'INITIALIZED');
      db1.close();

      // Open new connection to the same file
      const db2 = new DatabaseService(filePath);
      assert.equal(db2.isOpen(), true);

      const entries = db2.getLedgerEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].txHash, '0xfilepersist001');
      assert.equal(entries[0].amount, 250.75);
      assert.equal(db2.getConfig('AGENT_STATE'), 'INITIALIZED');

      db2.close();
    });

    it('should allow concurrent reading and writing via WAL mode across instances', () => {
      const filePath = createTempDbPath('wal_concurrency');
      const writer = new DatabaseService(filePath);
      const reader = new DatabaseService(filePath);

      // Writer writes 50 records
      for (let i = 0; i < 50; i++) {
        writer.recordAction({
          component: 'CONCURRENCY_WRITER',
          actionType: `TICK_${i}`,
          details: `Data block ${i}`,
          tier: 'VERDE',
          balanceUsd: 100,
          timestamp: Date.now(),
        });
      }

      // Reader queries concurrently
      const readerResults = reader.getActions(100, 'CONCURRENCY_WRITER');
      assert.equal(readerResults.length, 50);

      writer.close();
      reader.close();
    });

    it('should be safe to call initialize() multiple times (idempotent)', () => {
      assert.doesNotThrow(() => {
        db.initialize();
        db.initialize();
      });
      assert.equal(db.isOpen(), true);
    });
  });
});

// ==============================================================================
// SUITE 2: WALLET ADVERSARIAL STRESS & FUZZING
// ==============================================================================

describe('Wallet Adversarial Stress & Fuzzing Tests', () => {
  let wallet: ApexWallet;

  beforeEach(() => {
    const config = loadConfig({
      NETWORK_MODE: 'mock',
      MOCK_WALLET_BALANCE_USD: '100.00',
      MOTHER_WALLET_ADDRESS: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    wallet = new ApexWallet(config);
  });

  describe('2.1 USDC Precision & Arithmetic Boundaries', () => {
    it('should accurately convert atomic unit boundaries', () => {
      // 1 micro-USDC (minimum atomic unit: 10^-6)
      assert.equal(numberToUsdcUnits(0.000001), 1n);
      assert.equal(usdcUnitsToNumber(1n), 0.000001);

      // 0 USD
      assert.equal(numberToUsdcUnits(0), 0n);
      assert.equal(usdcUnitsToNumber(0n), 0.0);

      // Arbitrary 6-decimal boundary
      assert.equal(numberToUsdcUnits(99999999.999999), 99999999999999n);
      assert.equal(usdcUnitsToNumber(99999999999999n), 99999999.999999);
    });

    it('should correctly handle IEEE-754 precision quirks (0.1 + 0.2)', () => {
      const floatSum = 0.1 + 0.2; // 0.30000000000000004 in JS
      const units = numberToUsdcUnits(floatSum);
      assert.equal(units, 300_000n);
      assert.equal(usdcUnitsToNumber(units), 0.3);
    });

    it('should round sub-atomic micro-USDC units predictably', () => {
      // Sub-atomic units: 0.0000004 -> rounds to 0n
      assert.equal(numberToUsdcUnits(0.0000004), 0n);
      // 0.0000006 -> rounds to 1n
      assert.equal(numberToUsdcUnits(0.0000006), 1n);
      // 1.0000004 -> rounds to 1_000_000n
      assert.equal(numberToUsdcUnits(1.0000004), 1_000_000n);
    });

    it('should reject non-finite, negative, or invalid amounts in numberToUsdcUnits', () => {
      assert.throws(() => numberToUsdcUnits(-0.000001), WalletError);
      assert.throws(() => numberToUsdcUnits(-100), WalletError);
      assert.throws(() => numberToUsdcUnits(NaN), WalletError);
      assert.throws(() => numberToUsdcUnits(Infinity), WalletError);
      assert.throws(() => numberToUsdcUnits(-Infinity), WalletError);
    });

    it('should maintain exact 6-decimal arithmetic for large balances up to $1 Billion USD', () => {
      const oneBillionUsd = 1_000_000_000.000001;
      const units = numberToUsdcUnits(oneBillionUsd);
      assert.equal(units, 1_000_000_000_000_001n);
      assert.equal(usdcUnitsToNumber(units), oneBillionUsd);

      const hundredMillion = 100_000_000.555555;
      const unitsHm = numberToUsdcUnits(hundredMillion);
      assert.equal(unitsHm, 100_000_000_555_555n);
      assert.equal(usdcUnitsToNumber(unitsHm), hundredMillion);
    });
  });

  describe('2.2 Constitutional Transfer Security & Whitelist Fuzzing', () => {
    it('should reject transfers to ZERO_ADDRESS with ConstitutionViolationError', async () => {
      // Validly formatted zero address
      await assert.rejects(
        async () => wallet.transferUsdc('base', ZERO_ADDRESS, 1.0),
        ConstitutionViolationError
      );

      // Mixed-case zero address with standard 0x prefix
      const zeroMixed = '0x0000000000000000000000000000000000000000';
      await assert.rejects(
        async () => wallet.transferUsdc('base', zeroMixed, 1.0),
        ConstitutionViolationError
      );
    });

    it('should reject non-canonical 0X uppercase prefix zero address with ConstitutionViolationError', async () => {
      // Uppercase 0X prefix is valid EVM hex format, but zero address is prohibited by Constitution Article I
      const upperZero = '0X0000000000000000000000000000000000000000';
      await assert.rejects(
        async () => wallet.transferUsdc('base', upperZero, 1.0),
        ConstitutionViolationError
      );

      assert.throws(
        () => wallet.addToWhitelist(upperZero),
        ConstitutionViolationError
      );

      // Truly malformed addresses reject with InvalidAddressError
      const malformed = '0XGGGG000000000000000000000000000000000000';
      await assert.rejects(
        async () => wallet.transferUsdc('base', malformed, 1.0),
        InvalidAddressError
      );
      assert.throws(
        () => wallet.addToWhitelist(malformed),
        InvalidAddressError
      );
    });

    it('should reject adding ZERO_ADDRESS to whitelist with ConstitutionViolationError', () => {
      assert.throws(
        () => wallet.addToWhitelist(ZERO_ADDRESS),
        ConstitutionViolationError
      );
    });

    it('should reject unwhitelisted valid EVM addresses with ConstitutionViolationError', async () => {
      const UNWHITELISTED = [
        '0x1234567890123456789012345678901234567890',
        '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000',
        '0x9999999999999999999999999999999999999999',
      ];

      for (const addr of UNWHITELISTED) {
        assert.equal(wallet.isWhitelisted(addr), false);
        await assert.rejects(
          async () => wallet.transferUsdc('base', addr, 5.0),
          ConstitutionViolationError
        );
      }
    });

    it('should reject malformed EVM address inputs with InvalidAddressError', async () => {
      const MALFORMED = [
        '',
        'not_an_address',
        '0x123', // too short
        '0x123456789012345678901234567890123456789', // 39 chars
        '0x12345678901234567890123456789012345678901', // 41 chars
        '1234567890123456789012345678901234567890', // missing 0x
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // non-hex
        ' 0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ', // whitespace padded
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\0', // null byte injection
      ];

      for (const bad of MALFORMED) {
        await assert.rejects(
          async () => wallet.transferUsdc('base', bad, 1.0),
          InvalidAddressError
        );
        assert.throws(
          () => wallet.addToWhitelist(bad),
          InvalidAddressError
        );
      }
    });

    it('should immediately prohibit transfers upon whitelist revocation', async () => {
      const target = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      wallet.addToWhitelist(target, 'CUSTOM', 'Temporary Recipient');
      assert.equal(wallet.isWhitelisted(target), true);

      // Transfer succeeds when whitelisted
      const txHash = await wallet.transferUsdc('base', target, 5.0);
      assert.match(txHash, /^0x[0-9a-fA-F]{64}$/);

      // Revoke from whitelist
      const removed = wallet.removeFromWhitelist(target);
      assert.equal(removed, true);
      assert.equal(wallet.isWhitelisted(target), false);

      // Subsequent transfer must fail with ConstitutionViolationError
      await assert.rejects(
        async () => wallet.transferUsdc('base', target, 5.0),
        ConstitutionViolationError
      );
    });

    it('should handle case insensitivity gracefully in whitelist queries and revocation', () => {
      const mixed = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
      wallet.addToWhitelist(mixed);

      // Verify lookup with lowercase and uppercase
      assert.equal(wallet.isWhitelisted(mixed.toLowerCase()), true);
      assert.equal(wallet.isWhitelisted(mixed.toUpperCase()), true);

      // Remove using uppercase
      assert.equal(wallet.removeFromWhitelist(mixed.toUpperCase()), true);
      assert.equal(wallet.isWhitelisted(mixed), false);
    });
  });

  describe('2.3 Balance Exhaustion, Solvency & Overdraft Protection', () => {
    it('should reject transfers of sub-atomic amounts (< 0.000001) with WalletError', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;

      // 0.0000009 USD
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 0.0000009),
        /below minimum atomic USDC unit/
      );

      // 0.0000001 USD
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 0.0000001),
        /below minimum atomic USDC unit/
      );

      // 0.0 USD
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 0.0),
        /positive finite number/
      );

      // Negative USD
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, -5.0),
        /positive finite number/
      );
    });

    it('should allow spending exact balance down to 0.000000 and then reject further spending', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      wallet.setMockBalance('base', 50.0);
      assert.equal(await wallet.getBaseUsdcBalance(), 50.0);

      // Transfer full $50.00
      const tx = await wallet.transferUsdc('base', whitelisted, 50.0);
      assert.match(tx, /^0x[0-9a-fA-F]{64}$/);
      assert.equal(await wallet.getBaseUsdcBalance(), 0.0);

      // Next transfer of even 1 micro-USDC must fail with InsufficientBalanceError
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 0.000001),
        InsufficientBalanceError
      );
    });

    it('should reject 1 micro-USDC overdraft ($50.000001 when balance is $50.00)', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      wallet.setMockBalance('base', 50.0);

      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 50.000001),
        InsufficientBalanceError
      );
    });

    it('should enforce strict chain isolation (Base balance cannot fund Polygon transfers)', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      wallet.setMockBalances({ base: 50.0, polygon: 0.0 });

      assert.equal(await wallet.getBaseUsdcBalance(), 50.0);
      assert.equal(await wallet.getPolygonUsdcBalance(), 0.0);
      assert.equal(await wallet.getTotalBalanceUsd(), 50.0);

      // Polygon has 0 USDC, must fail despite Base having 50.0
      await assert.rejects(
        async () => wallet.transferUsdc('polygon', whitelisted, 1.0),
        InsufficientBalanceError
      );

      // Base can spend its own funds
      const tx = await wallet.transferUsdc('base', whitelisted, 10.0);
      assert.match(tx, /^0x[0-9a-fA-F]{64}$/);
      assert.equal(await wallet.getBaseUsdcBalance(), 40.0);
    });

    it('should execute rapid sequential micro-transfers accurately without balance leakage', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      wallet.setMockBalance('base', 10.0);

      const NUM_TRANSFERS = 50;
      const TRANSFER_AMOUNT = 0.1; // 50 * 0.1 = 5.0

      for (let i = 0; i < NUM_TRANSFERS; i++) {
        await wallet.transferUsdc('base', whitelisted, TRANSFER_AMOUNT);
      }

      const remaining = await wallet.getBaseUsdcBalance();
      assert.equal(remaining, 5.0);

      const records = wallet.getMockTransfers();
      assert.equal(records.length, NUM_TRANSFERS);

      // Verify nonces and hashes are all distinct
      const hashes = new Set(records.map((r) => r.txHash));
      assert.equal(hashes.size, NUM_TRANSFERS);
    });

    it('should preserve balance atomically when network error is simulated', async () => {
      const whitelisted = DEFAULT_WHITELISTED_EXCHANGES[0].address;
      wallet.setMockBalance('base', 25.0);
      wallet.setSimulateError(true);

      // Transfer fails
      await assert.rejects(
        async () => wallet.transferUsdc('base', whitelisted, 10.0),
        NetworkError
      );

      // Balance must remain exactly 25.0, no partial deduction
      wallet.setSimulateError(false);
      assert.equal(await wallet.getBaseUsdcBalance(), 25.0);

      // Now it succeeds
      await wallet.transferUsdc('base', whitelisted, 10.0);
      assert.equal(await wallet.getBaseUsdcBalance(), 15.0);
    });
  });
});
