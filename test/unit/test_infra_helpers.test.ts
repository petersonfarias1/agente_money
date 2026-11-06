/**
 * ==============================================================================
 * Unit Tests: E2E Test Infrastructure Helpers (`test/unit/test_infra_helpers.test.ts`)
 * ==============================================================================
 * Validates correctness of all 6 shared test helpers:
 * - E2ETestContext (hermetic sandbox lifecycle)
 * - MockWalletHarness (balance & transfer mutator)
 * - MockHttpClient (native node:http client)
 * - DeterministicClock (virtual time travel)
 * - MockPolymarketClob (in-memory CLOB orderbook)
 * - ConstitutionalAssert (invariant verification)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  E2ETestContext,
  MockWalletHarness,
  MockHttpClient,
  DeterministicClock,
  MockPolymarketClob,
  ConstitutionalAssert,
} from '../e2e/helpers/index.ts';

import { getExitHandler } from '../../src/core/death.ts';
import type { PolymarketMarket, PolymarketOrder, MetabolicTier } from '../../src/types.ts';

describe('E2E Test Infrastructure Helpers', () => {
  describe('1. E2ETestContext', () => {
    let ctx: E2ETestContext;

    beforeEach(() => {
      ctx = new E2ETestContext({
        MOCK_WALLET_BALANCE_USD: '100.00',
      });
    });

    afterEach(async () => {
      await ctx.teardown();
    });

    it('should initialize hermetic environment with in-memory DB and temp directory', () => {
      assert.ok(ctx.id, 'Context should have a unique ID');
      assert.ok(fs.existsSync(ctx.tempDir), 'Temp directory must exist');
      assert.ok(ctx.db.isOpen(), 'In-memory database must be initialized and open');
    });

    it('should trap process.exit via exit handler without terminating runner', () => {
      const exit = getExitHandler();
      assert.throws(() => {
        exit(0);
      }, /\[PERMADEATH_EXIT_CODE_0\]/);
      assert.equal(ctx.getExitCode(), 0);
      assert.equal(ctx.isDead(), true);
    });

    it('should cleanly remove temp directory and close DB on teardown', async () => {
      const tempPath = ctx.tempDir;
      assert.ok(fs.existsSync(tempPath));
      await ctx.teardown();
      assert.strictEqual(fs.existsSync(tempPath), false, 'Temp directory should be removed');
      assert.strictEqual(ctx.db.isOpen(), false, 'Database should be closed');
    });
  });

  describe('2. MockWalletHarness', () => {
    let ctx: E2ETestContext;
    let harness: MockWalletHarness;

    beforeEach(() => {
      ctx = new E2ETestContext();
      harness = new MockWalletHarness(ctx.wallet);
    });

    afterEach(async () => {
      await ctx.teardown();
    });

    it('should split balance evenly across Base and Polygon', async () => {
      harness.setBalance(80.0);
      const balance = await ctx.wallet.getBalanceBreakdown();
      assert.equal(balance.baseUsdc, 40.0);
      assert.equal(balance.polygonUsdc, 40.0);
      assert.equal(balance.totalUsd, 80.0);
    });

    it('should set chain-specific balance', async () => {
      harness.setChainBalance('base', 25.0);
      const baseBal = await ctx.wallet.getUsdcBalance('base');
      assert.equal(baseBal, 25.0);
    });

    it('should simulate terminal insolvency with 0.00 USD balance', async () => {
      harness.simulateInsolvency();
      const total = await harness.getTotalBalance();
      assert.equal(total, 0.0);
    });

    it('should simulate deficit and record executed transfers', async () => {
      harness.simulateDeficit(5.0);
      const baseBal = await ctx.wallet.getUsdcBalance('base');
      assert.equal(baseBal, -5.0);

      // Perform a transfer to whitelisted mother address
      harness.setChainBalance('base', 50.0);
      const mother = ctx.config.motherWalletAddress;
      if (mother && mother !== '0x0000000000000000000000000000000000000000') {
        await ctx.wallet.transferUsdc('base', mother, 10.0);
        const transfers = harness.getExecutedTransfers();
        assert.equal(transfers.length, 1);
        assert.equal(transfers[0].amountUsd, 10.0);
        harness.clearTransfers();
        assert.equal(harness.getExecutedTransfers().length, 0);
      }
    });
  });

  describe('3. MockHttpClient', () => {
    let server: http.Server;
    let pipePath: string;

    beforeEach(async () => {
      pipePath =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\apex-mock-http-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : `/tmp/apex-mock-http-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;

      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          if (req.url === '/test-get') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'get-ok' }));
          } else if (req.url === '/test-post') {
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: JSON.parse(body || '{}') }));
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(pipePath, () => {
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('should perform GET request and parse JSON response', async () => {
      const res = await MockHttpClient.get('http://localhost/test-get', undefined, pipePath);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: 'get-ok' });
    });

    it('should perform POST request with payload and custom headers', async () => {
      const payload = { item: 'alpha-signal', value: 42 };
      const res = await MockHttpClient.post(
        'http://localhost/test-post',
        payload,
        { 'X-Custom': 'apex-test' },
        pipePath
      );
      assert.equal(res.statusCode, 201);
      assert.deepEqual(res.body, { received: payload });
    });
  });

  describe('4. DeterministicClock', () => {
    it('should initialize with default epoch and advance by increments', () => {
      const clock = new DeterministicClock(1735689600000); // 2025-01-01T00:00:00Z
      assert.equal(clock.now(), 1735689600000);
      assert.equal(clock.toISOString(), '2025-01-01T00:00:00.000Z');

      clock.advance(5000);
      assert.equal(clock.now(), 1735689605000);

      clock.advanceSeconds(10);
      assert.equal(clock.now(), 1735689615000);

      clock.advanceMinutes(1);
      assert.equal(clock.now(), 1735689675000);

      clock.advanceCycles(2, 60000);
      assert.equal(clock.now(), 1735689795000);

      clock.advanceDays(1);
      assert.equal(clock.now(), 1735689795000 + 86400000);
    });
  });

  describe('5. MockPolymarketClob', () => {
    let clob: MockPolymarketClob;

    beforeEach(() => {
      clob = new MockPolymarketClob();
    });

    it('should register markets, place orders, and reject on closed markets', () => {
      const sampleMarket: PolymarketMarket = {
        id: 'poly-test-1',
        conditionId: '0x1234567890123456789012345678901234567890123456789012345678901234',
        question: 'Will ETH 2.0 staking exceed 35M?',
        outcomes: ['YES', 'NO'],
        outcomePrices: [0.45, 0.55],
        impliedProbability: 0.45,
        liquidityUsd: 150000,
        volume24hUsd: 25000,
        active: true,
        closed: false,
      };

      clob.registerMarket(sampleMarket);
      assert.equal(clob.getAllMarkets().length, 1);
      assert.deepEqual(clob.getMarket('poly-test-1'), sampleMarket);

      const order: PolymarketOrder = {
        marketId: 'poly-test-1',
        conditionId: sampleMarket.conditionId,
        outcome: 'YES',
        side: 'BUY',
        price: 0.45,
        size: 50,
        stakeUsd: 22.5,
        status: 'PENDING',
        timestamp: Date.now(),
      };

      const fillResult = clob.placeOrder(order);
      assert.equal(fillResult.status, 'FILLED');
      assert.equal(clob.getOrders().length, 1);

      // Resolve market
      const res = clob.resolveMarket('poly-test-1', 'YES');
      assert.equal(res.payoutMultiplier, 1.0);
      assert.equal(clob.getMarket('poly-test-1')?.closed, true);

      // Order on closed market should be rejected
      const rejResult = clob.placeOrder(order);
      assert.equal(rejResult.status, 'REJECTED');
    });
  });

  describe('6. ConstitutionalAssert', () => {
    it('should validate Quarter-Kelly 5% bankroll cap', () => {
      // 5% of 100 is 5.00
      assert.doesNotThrow(() => {
        ConstitutionalAssert.assertQuarterKellyCap(5.00, 100.0);
      });
      assert.doesNotThrow(() => {
        ConstitutionalAssert.assertQuarterKellyCap(2.50, 100.0);
      });
      assert.throws(() => {
        ConstitutionalAssert.assertQuarterKellyCap(5.50, 100.0);
      }, /Constitutional Violation/);
    });

    it('should validate strictly positive EV hurdle', () => {
      // b=1.5, p=0.6, q=0.4 => ev = 1.5 * 0.6 - 0.4 = 0.5 > 0
      assert.doesNotThrow(() => {
        ConstitutionalAssert.assertStrictPositiveEv(1.5, 0.6, 0.4);
      });
      // ev <= 0
      assert.throws(() => {
        ConstitutionalAssert.assertStrictPositiveEv(1.0, 0.5, 0.5); // ev = 0.0
      }, /Constitutional Violation/);
    });

    it('should validate metabolic tier bounds', () => {
      assert.doesNotThrow(() => ConstitutionalAssert.assertTierInvariants('VERDE', 75.0));
      assert.doesNotThrow(() => ConstitutionalAssert.assertTierInvariants('AMARELO', 25.0));
      assert.doesNotThrow(() => ConstitutionalAssert.assertTierInvariants('LARANJA', 5.0));
      assert.doesNotThrow(() => ConstitutionalAssert.assertTierInvariants('VERMELHO', 0.0));

      assert.throws(() => ConstitutionalAssert.assertTierInvariants('VERDE', 45.0));
      assert.throws(() => ConstitutionalAssert.assertTierInvariants('AMARELO', 5.0));
      assert.throws(() => ConstitutionalAssert.assertTierInvariants('LARANJA', 15.0));
      assert.throws(() => ConstitutionalAssert.assertTierInvariants('VERMELHO', 1.0));
    });

    it('should validate tombstone snapshots', () => {
      const tempTombstonePath = path.resolve(process.cwd(), '.tmp_test_tombstone.json');
      const tombstoneData = {
        agentAddress: '0x1111111111111111111111111111111111111111',
        finalBalanceUsd: 0.0,
        deathTimestamp: new Date().toISOString(),
        totalLifespanMs: 120000,
        totalCyclesExecuted: 5,
        totalRevenueGenerated: 10.0,
        totalExpensesIncurred: 10.0,
        finalLedgerSnapshot: [],
        reason: 'Terminal insolvency',
      };
      fs.writeFileSync(tempTombstonePath, JSON.stringify(tombstoneData));

      try {
        const loaded = ConstitutionalAssert.assertTombstoneSnapshot(tempTombstonePath);
        assert.equal(loaded.finalBalanceUsd, 0.0);
        assert.equal(loaded.agentAddress, tombstoneData.agentAddress);
      } finally {
        if (fs.existsSync(tempTombstonePath)) fs.unlinkSync(tempTombstonePath);
      }
    });

    it('should validate mitosis capital threshold (3x initial)', () => {
      assert.doesNotThrow(() => {
        ConstitutionalAssert.assertMitosisThreshold(150.0, 50.0, 3.0);
      });
      assert.doesNotThrow(() => {
        ConstitutionalAssert.assertMitosisThreshold(200.0, 50.0, 3.0);
      });
      assert.throws(() => {
        ConstitutionalAssert.assertMitosisThreshold(149.99, 50.0, 3.0);
      }, /Mitosis requires balance >= 150/);
    });
  });
});
