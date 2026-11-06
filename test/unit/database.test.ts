/**
 * ==============================================================================
 * Unit Tests: SQLite Persistence Service (`src/core/database.ts`)
 * ==============================================================================
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService, getDatabase, resetDatabase } from '../../src/core/database.ts';
import type { LedgerEntry, ActionEntry, LineageEntry } from '../../src/types.ts';

describe('Core DatabaseService Unit Tests', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
    resetDatabase();
  });

  describe('1. Initialization & Schema Setup', () => {
    it('should initialize database in memory and report isOpen() true', () => {
      assert.equal(db.isOpen(), true);
    });

    it('should throw error when calling methods on closed database', () => {
      db.close();
      assert.equal(db.isOpen(), false);
      assert.throws(
        () => db.getTotalRevenue(),
        /Database is closed or uninitialized/
      );
    });

    it('should create directory automatically when given a file path', () => {
      const testDir = path.resolve('./tmp_test_data');
      const testDbPath = path.join(testDir, 'subfolder', 'test.db');

      try {
        const fileDb = new DatabaseService(testDbPath);
        assert.equal(fileDb.isOpen(), true);
        assert.equal(fs.existsSync(path.dirname(testDbPath)), true);
        fileDb.close();
      } finally {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('2. Ledger Entries & Financial Aggregations', () => {
    it('should insert ledger entries and retrieve them with camelCase mapping', () => {
      const now = Date.now();
      const id1 = db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 50.0,
        entryType: 'SEED_CAPITAL',
        counterparty: '0x1111111111111111111111111111111111111111',
        timestamp: now,
      });

      const id2 = db.insertLedger({
        txHash: '0xabc123',
        chain: 'polygon',
        token: 'USDC',
        amount: 15.5,
        entryType: 'INCOME_POLYMARKET',
        counterparty: '0x2222222222222222222222222222222222222222',
        timestamp: now + 1000,
      });

      assert.equal(id1, 1);
      assert.equal(id2, 2);

      const entries = db.getLedgerEntries();
      assert.equal(entries.length, 2);
      // Ordered by timestamp desc, id desc
      assert.equal(entries[0].id, 2);
      assert.equal(entries[0].txHash, '0xabc123');
      assert.equal(entries[0].chain, 'polygon');
      assert.equal(entries[0].amount, 15.5);
      assert.equal(entries[0].entryType, 'INCOME_POLYMARKET');

      assert.equal(entries[1].id, 1);
      assert.equal(entries[1].txHash, undefined);
      assert.equal(entries[1].chain, 'base');
    });

    it('should calculate total revenue and total expenses correctly', () => {
      const now = Date.now();
      // Revenues: INCOME_X402, INCOME_POLYMARKET, INCOME_BOUNTY, ROYALTY_IN
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 25.0,
        entryType: 'INCOME_X402',
        timestamp: now,
      });
      db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: 40.0,
        entryType: 'INCOME_POLYMARKET',
        timestamp: now + 1,
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 100.0,
        entryType: 'INCOME_BOUNTY',
        timestamp: now + 2,
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 5.0,
        entryType: 'ROYALTY_IN',
        timestamp: now + 3,
      });

      // Capital injection (not revenue)
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 50.0,
        entryType: 'SEED_CAPITAL',
        timestamp: now + 4,
      });

      // Expenses: EXPENSE_GAS, EXPENSE_LLM, ROYALTY_OUT
      db.insertLedger({
        chain: 'base',
        token: 'ETH',
        amount: 1.25,
        entryType: 'EXPENSE_GAS',
        timestamp: now + 5,
      });
      db.insertLedger({
        chain: 'base',
        token: 'USDC',
        amount: 3.5,
        entryType: 'EXPENSE_LLM',
        timestamp: now + 6,
      });
      db.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: 2.0,
        entryType: 'ROYALTY_OUT',
        timestamp: now + 7,
      });

      assert.equal(db.getTotalRevenue(), 170.0); // 25 + 40 + 100 + 5
      assert.equal(db.getTotalExpenses(), 6.75); // 1.25 + 3.5 + 2.0
      assert.equal(db.getLedgerSnapshot(3).length, 3);
    });

    it('should reject invalid chain or entryType per CHECK constraints', () => {
      assert.throws(() => {
        db.insertLedger({
          chain: 'arbitrum' as any,
          token: 'USDC',
          amount: 10,
          entryType: 'INCOME_X402',
          timestamp: Date.now(),
        });
      });

      assert.throws(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 10,
          entryType: 'INVALID_TYPE' as any,
          timestamp: Date.now(),
        });
      });

      assert.throws(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: -5, // amount >= 0 constraint
          entryType: 'INCOME_X402',
          timestamp: Date.now(),
        });
      });
    });
  });

  describe('3. Action Auditing', () => {
    it('should record actions and retrieve with component filter', () => {
      const now = Date.now();
      db.recordAction({
        component: 'metabolism',
        actionType: 'TIER_EVALUATED',
        details: JSON.stringify({ tier: 'VERDE', balance: 75.0 }),
        tier: 'VERDE',
        balanceUsd: 75.0,
        timestamp: now,
      });

      db.recordAction({
        component: 'wallet',
        actionType: 'BALANCE_CHECK',
        details: 'Checked balance on Base and Polygon',
        tier: 'VERDE',
        balanceUsd: 75.0,
        timestamp: now + 1,
      });

      const allActions = db.getActions();
      assert.equal(allActions.length, 2);

      const metabolismActions = db.getActions(10, 'metabolism');
      assert.equal(metabolismActions.length, 1);
      assert.equal(metabolismActions[0].component, 'metabolism');
      assert.equal(metabolismActions[0].actionType, 'TIER_EVALUATED');
      assert.equal(metabolismActions[0].balanceUsd, 75.0);
    });
  });

  describe('4. Lineage Management', () => {
    it('should record lineage and update royalties and status', () => {
      const child: LineageEntry = {
        childAddress: '0x1234567890123456789012345678901234567890',
        parentAddress: '0x9999999999999999999999999999999999999999',
        generation: 2,
        birthTimestamp: 1700000000000,
        seedCapitalUsd: 50.0,
        totalRoyaltiesPaidUsd: 0.0,
        status: 'ACTIVE',
      };

      db.recordLineage(child);

      const record = db.getLineageByChild(child.childAddress);
      assert.ok(record);
      assert.equal(record.childAddress, child.childAddress);
      assert.equal(record.parentAddress, child.parentAddress);
      assert.equal(record.generation, 2);
      assert.equal(record.seedCapitalUsd, 50.0);
      assert.equal(record.totalRoyaltiesPaidUsd, 0.0);
      assert.equal(record.status, 'ACTIVE');

      db.updateRoyaltiesPaid(child.childAddress, 2.5);
      const updated = db.getLineageByChild(child.childAddress);
      assert.equal(updated?.totalRoyaltiesPaidUsd, 2.5);

      db.updateLineageStatus(child.childAddress, 'INSOLVENT');
      const insolvent = db.getLineageByChild(child.childAddress);
      assert.equal(insolvent?.status, 'INSOLVENT');
    });

    it('should return null for non-existent child lineage', () => {
      assert.equal(db.getLineageByChild('0x0000000000000000000000000000000000000000'), null);
    });
  });

  describe('5. System Config Key-Value Store', () => {
    it('should set and get config values with upsert behavior', () => {
      assert.equal(db.getConfig('runtime_mode'), null);

      db.setConfig('runtime_mode', 'autonomous');
      assert.equal(db.getConfig('runtime_mode'), 'autonomous');

      db.setConfig('runtime_mode', 'quarantined');
      assert.equal(db.getConfig('runtime_mode'), 'quarantined');
    });
  });

  describe('6. Polymarket Positions Persistence', () => {
    it('should save and update polymarket positions', () => {
      const id = db.savePosition({
        conditionId: '0xcond123',
        marketId: '0xmkt456',
        question: 'Will ETH exceed $4000 by Q4?',
        outcome: 'YES',
        shares: 100,
        avgPrice: 0.45,
        currentValue: 45.0,
        stakeUsd: 45.0,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
      });

      assert.equal(id, 1);

      const pos = db.getPositionById(id);
      assert.ok(pos);
      assert.equal(pos.conditionId, '0xcond123');
      assert.equal(pos.outcome, 'YES');
      assert.equal(pos.status, 'OPEN');

      db.updatePositionStatus(id, 'WON', 100.0, new Date().toISOString());

      const resolved = db.getPositionById(id);
      assert.equal(resolved?.status, 'WON');
      assert.equal(resolved?.payoutUsd, 100.0);
      assert.ok(resolved?.closedAt);

      const wonList = db.getPositions(10, 'WON');
      assert.equal(wonList.length, 1);
      assert.equal(wonList[0].id, id);
    });
  });

  describe('7. Transaction Management (Nested Savepoints)', () => {
    it('should commit all operations in successful transaction', () => {
      db.transaction(() => {
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 10,
          entryType: 'INCOME_X402',
          timestamp: 1000,
        });
        db.setConfig('test_tx', 'value1');
      });

      assert.equal(db.getLedgerEntries().length, 1);
      assert.equal(db.getConfig('test_tx'), 'value1');
    });

    it('should rollback outer transaction on error', () => {
      assert.throws(() => {
        db.transaction(() => {
          db.insertLedger({
            chain: 'base',
            token: 'USDC',
            amount: 10,
            entryType: 'INCOME_X402',
            timestamp: 1000,
          });
          throw new Error('Transaction abort');
        });
      }, /Transaction abort/);

      assert.equal(db.getLedgerEntries().length, 0);
    });

    it('should support nested savepoints with partial rollback', () => {
      db.transaction(() => {
        // Outer operation
        db.insertLedger({
          chain: 'base',
          token: 'USDC',
          amount: 10,
          entryType: 'INCOME_X402',
          timestamp: 1000,
        });

        // Nested operation that fails and is handled
        try {
          db.transaction(() => {
            db.insertLedger({
              chain: 'polygon',
              token: 'USDC',
              amount: 5,
              entryType: 'INCOME_POLYMARKET',
              timestamp: 1001,
            });
            throw new Error('Nested failure');
          });
        } catch (err: any) {
          assert.equal(err.message, 'Nested failure');
        }

        // Another outer operation
        db.setConfig('outer_key', 'outer_val');
      });

      const entries = db.getLedgerEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].chain, 'base');
      assert.equal(db.getConfig('outer_key'), 'outer_val');
    });
  });

  describe('8. Singleton Helper getDatabase', () => {
    it('should create and cache singleton instance', () => {
      const d1 = getDatabase(':memory:');
      const d2 = getDatabase(':memory:');
      assert.strictEqual(d1, d2);
      resetDatabase();
    });
  });
});
