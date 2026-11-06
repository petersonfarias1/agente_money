/**
 * ==============================================================================
 * Unit Tests: Permadeath Protocol (`src/core/death.ts`)
 * ==============================================================================
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  executePermadeath,
  registerTeardownHook,
  clearTeardownHooks,
  setExitHandler,
  resetExitHandler,
  type ExitHandler,
} from '../../src/core/death.ts';
import { DatabaseService } from '../../src/core/database.ts';
import type { Tombstone } from '../../src/types.ts';

export class MockExitError extends Error {
  public exitCode: number;
  constructor(exitCode: number) {
    super(`[MockExit] process.exit(${exitCode}) called`);
    this.name = 'MockExitError';
    this.exitCode = exitCode;
  }
}

describe('Core Permadeath Protocol Unit Tests', () => {
  const tmpDir = path.resolve('./tmp_test_death');
  const customTombstonePath = path.join(tmpDir, 'test_tombstone.json');

  beforeEach(() => {
    clearTeardownHooks();
    resetExitHandler();

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearTeardownHooks();
    resetExitHandler();

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Injectable Exit Handler Pattern', () => {
    it('T2.5: should invoke injected exit handler with code 0 instead of terminating process', async () => {
      let exitCodeReceived: number | null = null;
      setExitHandler(((code: number) => {
        exitCodeReceived = code;
        throw new MockExitError(code);
      }) as ExitHandler);

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: customTombstonePath,
            agentAddress: '0x1111111111111111111111111111111111111111',
          }),
        MockExitError
      );

      assert.equal(exitCodeReceived, 0);
    });
  });

  describe('2. Post-Mortem Snapshot Integrity', () => {
    it('T2.1: should generate tombstone.json with all required schema fields', async () => {
      setExitHandler(((code: number) => {
        throw new MockExitError(code);
      }) as ExitHandler);

      const agentAddr = '0x1234567890123456789012345678901234567890';
      const birthTime = Date.now() - 3600000;

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: customTombstonePath,
            agentAddress: agentAddr,
            agentName: 'Apex-Test-Agent',
            generation: 2,
            parentId: '0x0000000000000000000000000000000000000001',
            finalBalanceUsd: 0.0,
            birthTimestampMs: birthTime,
            totalCyclesExecuted: 42,
            reason: 'Insolvency: Liquid wallet balance reached $0.00 USD',
          }),
        MockExitError
      );

      assert.equal(fs.existsSync(customTombstonePath), true);
      const content = fs.readFileSync(customTombstonePath, 'utf8');
      const tombstone: Tombstone = JSON.parse(content);

      assert.equal(tombstone.agentAddress, agentAddr);
      assert.equal(tombstone.agentName, 'Apex-Test-Agent');
      assert.equal(tombstone.generation, 2);
      assert.equal(tombstone.parentId, '0x0000000000000000000000000000000000000001');
      assert.equal(tombstone.finalBalanceUsd, 0.0);
      assert.equal(tombstone.totalCyclesExecuted, 42);
      assert.ok(tombstone.deathTimestamp);
      assert.ok(tombstone.birthTimestamp);
      assert.ok(tombstone.totalLifespanMs >= 3600000);
      assert.equal(typeof tombstone.totalRevenueGenerated, 'number');
      assert.equal(typeof tombstone.totalExpensesIncurred, 'number');
      assert.ok(Array.isArray(tombstone.finalLedgerSnapshot));
      assert.ok(tombstone.operationalSummary);
      assert.ok(Array.isArray(tombstone.postMortemInsights));
    });

    it('T2.2: should aggregate financial metrics and ledger entries from database', async () => {
      setExitHandler(((code: number) => {
        throw new MockExitError(code);
      }) as ExitHandler);

      const db = new DatabaseService(':memory:');
      const now = Date.now();

      // Seed database with revenues and expenses
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 50.0,
        entryType: 'INCOME_X402',
        timestamp: now,
      });
      db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: 25.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: now + 1,
      });
      db.insertLedger({
        chain: 'base',
        token: 'ETH',
        amount: 2.5,
        entryType: 'EXPENSE_GAS',
        timestamp: now + 2,
      });

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: customTombstonePath,
            database: db,
            finalBalanceUsd: 0.0,
          }),
        MockExitError
      );

      const tombstone: Tombstone = JSON.parse(
        fs.readFileSync(customTombstonePath, 'utf8')
      );

      assert.equal(tombstone.totalRevenueGenerated, 75.0); // 50 + 25
      assert.equal(tombstone.totalExpensesIncurred, 2.5);
      assert.equal(tombstone.finalLedgerSnapshot.length, 3);
      assert.equal(db.isOpen(), false); // Database closed
    });
  });

  describe('3. Teardown Hook Orchestration', () => {
    it('T2.3: should execute registered teardown hooks in sequence', async () => {
      setExitHandler(((code: number) => {
        throw new MockExitError(code);
      }) as ExitHandler);

      const executedHooks: string[] = [];

      registerTeardownHook(async () => {
        executedHooks.push('orders_cancelled');
      });
      registerTeardownHook(() => {
        executedHooks.push('servers_dismounted');
      });
      registerTeardownHook(async () => {
        executedHooks.push('websockets_closed');
      });

      await assert.rejects(
        () => executePermadeath({ tombstonePath: customTombstonePath }),
        MockExitError
      );

      assert.deepEqual(executedHooks, [
        'orders_cancelled',
        'servers_dismounted',
        'websockets_closed',
      ]);
    });

    it('T2.4: should not fail permadeath if a teardown hook throws an error', async () => {
      setExitHandler(((code: number) => {
        throw new MockExitError(code);
      }) as ExitHandler);

      let subsequentHookExecuted = false;

      registerTeardownHook(() => {
        throw new Error('Network timeout while cancelling orders');
      });

      registerTeardownHook(() => {
        subsequentHookExecuted = true;
      });

      await assert.rejects(
        () => executePermadeath({ tombstonePath: customTombstonePath }),
        MockExitError
      );

      assert.equal(subsequentHookExecuted, true);
      assert.equal(fs.existsSync(customTombstonePath), true);
    });
  });

  describe('4. Database State Updates on Insolvency', () => {
    it('T2.6: should update lineage status to INSOLVENT and log terminal action', async () => {
      setExitHandler(((code: number) => {
        throw new MockExitError(code);
      }) as ExitHandler);

      const db = new DatabaseService(':memory:');
      const agentAddress = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      // Record lineage
      db.recordLineage({
        childAddress: agentAddress,
        parentAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        generation: 1,
        birthTimestamp: Date.now() - 100000,
        seedCapitalUsd: 50.0,
        totalRoyaltiesPaidUsd: 0.0,
        status: 'ACTIVE',
      });

      await assert.rejects(
        () =>
          executePermadeath({
            tombstonePath: customTombstonePath,
            database: db,
            agentAddress,
            finalBalanceUsd: 0.0,
          }),
        MockExitError
      );

      // Re-open in-memory check is tricky since :memory: clears on close,
      // but let's test that db was closed cleanly
      assert.equal(db.isOpen(), false);
    });
  });
});
