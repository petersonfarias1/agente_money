/**
 * ==============================================================================
 * Unit Test Suite: Polymarket Scanner & Order Management Subsystem
 * ==============================================================================
 * Target:
 * - src/modules/polymarket/scanner.ts
 * - src/modules/polymarket/order.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet, InsufficientBalanceError } from '../../src/core/wallet.ts';
import {
  PolymarketScanner,
  getStandardMockMarkets,
} from '../../src/modules/polymarket/scanner.ts';
import { OrderManager } from '../../src/modules/polymarket/order.ts';
import { KellyRiskError } from '../../src/types.ts';
import { calculateKellyStake } from '../../src/modules/polymarket/kelly.ts';

describe('Polymarket Scanner & Order Manager', () => {
  let db: DatabaseService;
  let wallet: ApexWallet;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    wallet = new ApexWallet();
    wallet.resetMockState();
    wallet.setMockBalance('base', 50.0);
    wallet.setMockBalance('polygon', 50.0);
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  describe('1. Polymarket Scanner Market Ingestion & Filtering', () => {
    it('should filter out inactive, closed, low-liquidity, and expired markets', async () => {
      const scanner = new PolymarketScanner('https://clob.polymarket.com', true);
      const markets = await scanner.fetchMarkets({ minLiquidityUsd: 500.0, minVolume24hUsd: 100.0 });

      // All returned markets must be active and not closed
      for (const m of markets) {
        assert.strictEqual(m.active, true);
        assert.strictEqual(m.closed, false);
        assert.ok(m.liquidityUsd >= 500.0);
        assert.ok(m.volume24hUsd >= 100.0);
        if (m.endDate) {
          assert.ok(new Date(m.endDate).getTime() > Date.now());
        }
      }

      // Check specific discarded mock markets
      const marketIds = markets.map((m) => m.id);
      assert.ok(!marketIds.includes('market-low-liquidity-trap'), 'Low liquidity market must be excluded');
      assert.ok(!marketIds.includes('market-closed-settled'), 'Closed market must be excluded');
      assert.ok(!marketIds.includes('market-past-end-date'), 'Expired market must be excluded');
      assert.ok(marketIds.includes('market-eth-upgrade-q4'), 'Valid open market must be included');
    });

    it('should scan and identify high-conviction opportunities sorted by edge', async () => {
      const scanner = new PolymarketScanner('https://clob.polymarket.com', true);
      const bankroll = 100.0;

      // Custom probability estimator providing defined edges
      const estimator = async (m: any) => {
        if (m.id === 'market-eth-upgrade-q4') {
          return { pYes: 0.65, pNo: 0.35 }; // Market is [0.40, 0.60] -> YES edge = 0.25
        }
        if (m.id === 'market-cpi-above-target') {
          return { pYes: 0.40, pNo: 0.60 }; // Market is [0.70, 0.30] -> NO edge = 0.30
        }
        if (m.id === 'market-btc-150k-month') {
          return { pYes: 0.45, pNo: 0.55 }; // Market is [0.50, 0.50] -> NO edge = 0.05
        }
        return null;
      };

      const opportunities = await scanner.scanOpportunities(bankroll, estimator);

      assert.ok(opportunities.length >= 2, 'Should discover at least 2 opportunities');
      // Opportunities should be sorted by edge descending
      for (let i = 0; i < opportunities.length - 1; i++) {
        assert.ok(opportunities[i].edge >= opportunities[i + 1].edge);
      }

      // All returned opportunities must have Kelly authorization
      for (const op of opportunities) {
        assert.strictEqual(op.kelly.authorized, true);
        assert.ok(op.kelly.stakeAmountUsd >= 1.00);
        assert.ok(op.edge > 0);
      }
    });

    it('should ignore negative EV opportunities', async () => {
      const scanner = new PolymarketScanner('https://clob.polymarket.com', true);
      // Estimator predicts lower probability than market for both outcomes
      const estimator = async () => ({ pYes: 0.30, pNo: 0.50 });

      const opportunities = await scanner.scanOpportunities(100.0, estimator);
      // No opportunities should be found because EV is non-positive
      const ethOpp = opportunities.find((op) => op.market.id === 'market-eth-upgrade-q4');
      assert.strictEqual(ethOpp, undefined);
    });
  });

  describe('2. Order Execution & Position Persistence', () => {
    it('should place a paper-trading order and persist it into SQLite', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0]; // eth upgrade: Pm = 0.40
      const kelly = calculateKellyStake(0.40, 0.60, 100.0); // Authorized

      const opportunity = {
        market: mockMarket,
        outcome: 'YES' as const,
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      };

      const position = await orderManager.placeOrder(opportunity, { paperTrading: true });

      assert.ok(position.id !== undefined);
      assert.strictEqual(position.status, 'OPEN');
      assert.strictEqual(position.outcome, 'YES');
      assert.strictEqual(position.avgPrice, 0.40);
      assert.strictEqual(position.stakeUsd, kelly.stakeAmountUsd);
      assert.strictEqual(position.shares, Number((kelly.stakeAmountUsd / 0.40).toFixed(6)));

      // Verify persistence in SQLite
      const fetched = db.getPositionById(position.id!);
      assert.ok(fetched !== null);
      assert.strictEqual(fetched.status, 'OPEN');
      assert.strictEqual(fetched.question, mockMarket.question);

      // Verify audit action recorded
      const actions = db.getActions(1, 'polymarket');
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].actionType, 'ORDER_PLACED');
    });

    it('should reject order when opportunity Kelly calculation is unauthorized', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const unauthorizedKelly = calculateKellyStake(0.60, 0.40, 100.0); // Negative EV

      const opportunity = {
        market: mockMarket,
        outcome: 'YES' as const,
        marketPrice: 0.60,
        estimatedProb: 0.40,
        edge: -0.20,
        kelly: unauthorizedKelly,
      };

      await assert.rejects(
        async () => {
          await orderManager.placeOrder(opportunity);
        },
        KellyRiskError
      );
    });

    it('should reject order when stake exceeds liquid wallet balance', async () => {
      wallet.setMockBalance('base', 0.0);
      wallet.setMockBalance('polygon', 2.0); // Balance = $2.00
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      // Kelly stake for $1000 bankroll would be $50.00, exceeding $2.00
      const kelly = calculateKellyStake(0.40, 0.80, 1000.0);

      const opportunity = {
        market: mockMarket,
        outcome: 'YES' as const,
        marketPrice: 0.40,
        estimatedProb: 0.80,
        edge: 0.40,
        kelly,
      };

      await assert.rejects(
        async () => {
          await orderManager.placeOrder(opportunity);
        },
        InsufficientBalanceError
      );
    });
  });

  describe('3. Position Resolution & Financial Ledger Realization', () => {
    it('should resolve position as WON, record payout, and update financial ledger', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const kelly = calculateKellyStake(0.40, 0.60, 100.0); // stake = $5.00 (5% cap)

      const position = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });

      const initialRevenue = db.getTotalRevenue();

      // Resolve as WON
      const resolved = orderManager.resolvePosition(position.id!, 'YES');

      assert.strictEqual(resolved.status, 'WON');
      const expectedPayout = Number((position.shares * 1.0).toFixed(6));
      assert.strictEqual(resolved.payoutUsd, expectedPayout);
      assert.ok(resolved.closedAt !== undefined);

      // Verify financial ledger entry (INCOME_POLYMARKET)
      const ledgerEntries = db.getLedgerEntries(1);
      assert.strictEqual(ledgerEntries.length, 1);
      assert.strictEqual(ledgerEntries[0].entryType, 'INCOME_POLYMARKET');
      assert.strictEqual(ledgerEntries[0].amount, expectedPayout);
      assert.strictEqual(ledgerEntries[0].chain, 'polygon');

      // Verify revenue increment
      assert.strictEqual(db.getTotalRevenue(), initialRevenue + expectedPayout);
    });

    it('should resolve position as LOST with $0 payout and no ledger income', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const kelly = calculateKellyStake(0.40, 0.60, 100.0);

      const position = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });

      const initialLedgerCount = db.getLedgerEntries(100).length;

      // Resolve as LOST (winning outcome is NO)
      const resolved = orderManager.resolvePosition(position.id!, 'NO');

      assert.strictEqual(resolved.status, 'LOST');
      assert.strictEqual(resolved.payoutUsd, 0.0);

      // No ledger entry created for lost bet
      assert.strictEqual(db.getLedgerEntries(100).length, initialLedgerCount);
    });

    it('should cancel position on market refund or invalidation', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const kelly = calculateKellyStake(0.40, 0.60, 100.0);

      const position = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });

      const cancelled = orderManager.cancelPosition(position.id!, 'Market invalidated');
      assert.strictEqual(cancelled.status, 'CANCELLED');
    });
  });

  describe('4. Track Record Aggregation & Permadeath Teardown', () => {
    it('should aggregate accurate win rate and financial track record summary', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const kelly = calculateKellyStake(0.40, 0.60, 100.0);

      // Place 3 orders
      const pos1 = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });
      const pos2 = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });
      const pos3 = await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });

      // pos1: WON, pos2: LOST, pos3: remaining OPEN
      orderManager.resolvePosition(pos1.id!, 'YES');
      orderManager.resolvePosition(pos2.id!, 'NO');

      const summary = orderManager.getPositionSummary();

      assert.strictEqual(summary.totalPositions, 3);
      assert.strictEqual(summary.openPositions, 1);
      assert.strictEqual(summary.wonPositions, 1);
      assert.strictEqual(summary.lostPositions, 1);
      assert.strictEqual(summary.cancelledPositions, 0);
      // win rate = 1 won / (1 won + 1 lost) = 0.50 (50%)
      assert.strictEqual(summary.winRate, 0.50);
      assert.ok(summary.totalStakedUsd > 0);
      assert.ok(summary.totalPayoutUsd > 0);
    });

    it('should cancel all open orders on emergency liquidation / Permadeath', async () => {
      const orderManager = new OrderManager(db, wallet, true);
      const mockMarket = getStandardMockMarkets()[0];
      const kelly = calculateKellyStake(0.40, 0.60, 100.0);

      // Place 2 orders
      await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'YES',
        marketPrice: 0.40,
        estimatedProb: 0.60,
        edge: 0.20,
        kelly,
      });
      await orderManager.placeOrder({
        market: mockMarket,
        outcome: 'NO',
        marketPrice: 0.60,
        estimatedProb: 0.80,
        edge: 0.20,
        kelly,
      });

      const cancelledCount = orderManager.cancelAllOpenOrders('Permadeath initiated');
      assert.strictEqual(cancelledCount, 2);

      const openPositions = db.getPositions(10, 'OPEN');
      assert.strictEqual(openPositions.length, 0);
    });
  });
});
