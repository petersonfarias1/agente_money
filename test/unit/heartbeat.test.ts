/**
 * ==============================================================================
 * Unit Tests: Heartbeat Daemon & Lifecycle (`src/index.ts`)
 * ==============================================================================
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HeartbeatDaemon } from '../../src/index.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet } from '../../src/core/wallet.ts';
import { setExitHandler, resetExitHandler, clearTeardownHooks } from '../../src/core/death.ts';
import { loadConfig } from '../../src/config.ts';

export class MockDaemonExitError extends Error {
  public exitCode: number;
  constructor(exitCode: number) {
    super(`[MockDaemonExit] process.exit(${exitCode}) called`);
    this.name = 'MockDaemonExitError';
    this.exitCode = exitCode;
  }
}

describe('Core HeartbeatDaemon Unit Tests', () => {
  let db: DatabaseService;
  let wallet: ApexWallet;
  const tmpTombstone = path.resolve('./tmp_test_daemon_tombstone.json');

  beforeEach(() => {
    resetExitHandler();
    clearTeardownHooks();

    const config = loadConfig({
      NETWORK_MODE: 'mock',
      MOCK_WALLET_BALANCE_USD: '75.00',
    });

    db = new DatabaseService(':memory:');
    wallet = new ApexWallet(config);
  });

  afterEach(() => {
    resetExitHandler();
    clearTeardownHooks();

    if (db.isOpen()) {
      db.close();
    }

    if (fs.existsSync(tmpTombstone)) {
      fs.rmSync(tmpTombstone, { force: true });
    }
  });

  describe('1. Multi-Cycle Execution & Control', () => {
    it('T3.1: should execute exact number of cycles when maxCycles is specified', async () => {
      const executedCycles: number[] = [];

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        maxCycles: 3,
        intervalOverrideMs: 5,
        onTickExecuted: (res) => {
          executedCycles.push(res.cycle);
        },
      });

      await daemon.start();

      // Wait a short time for 3 cycles with 5ms interval to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(daemon.cycleCount, 3);
      assert.equal(daemon.isRunning, false);
      assert.deepEqual(executedCycles, [1, 2, 3]);

      // Check actions in database
      const actions = db.getActions(10, 'heartbeat');
      assert.equal(actions.length, 3);
      assert.equal(actions[0].actionType, 'TICK_EVALUATED');
      assert.equal(actions[0].tier, 'VERDE');
    });

    it('T3.5: should stop loop immediately when stop() is called', async () => {
      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        intervalOverrideMs: 100,
      });

      await daemon.start();
      assert.equal(daemon.cycleCount, 1);
      assert.equal(daemon.isRunning, true);

      await daemon.stop('User stopped test');
      assert.equal(daemon.isRunning, false);

      const status = daemon.getStatus();
      assert.equal(status.isRunning, false);
      assert.equal(status.cycleCount, 1);
    });
  });

  describe('2. Dynamic Metabolism Integration', () => {
    it('T3.2: should adapt tier and parameters when wallet balance changes', async () => {
      const results: string[] = [];

      wallet.setMockBalances({ base: 50.0, polygon: 50.0 }); // $100.00 -> VERDE

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        maxCycles: 2,
        intervalOverrideMs: 5,
        onTickExecuted: (res) => {
          results.push(res.tier);
          // Drop balance to $20.00 for next cycle -> AMARELO
          wallet.setMockBalances({ base: 10.0, polygon: 10.0 });
        },
      });

      await daemon.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(results.length, 2);
      assert.equal(results[0], 'VERDE');
      assert.equal(results[1], 'AMARELO');
    });
  });

  describe('3. Terminal Insolvency Trigger', () => {
    it('T3.3: should trigger executePermadeath and stop daemon when balance reaches $0.00', async () => {
      wallet.setMockBalances({ base: 0.0, polygon: 0.0 }); // $0.00 -> VERMELHO

      let exitCalled = false;
      setExitHandler(((code: number) => {
        exitCalled = true;
        throw new MockDaemonExitError(code);
      }) as any);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        tombstonePath: tmpTombstone,
        intervalOverrideMs: 5,
      });

      await assert.rejects(
        () => daemon.tick(),
        MockDaemonExitError
      );

      assert.equal(exitCalled, true);
      assert.equal(daemon.isRunning, false);
    });
  });

  describe('4. Fault Tolerance & Error Recovery', () => {
    it('T3.4: should catch wallet query errors and log TICK_FAILED without crashing daemon', async () => {
      wallet.setSimulateError(true);

      const daemon = new HeartbeatDaemon({
        database: db,
        wallet,
        maxCycles: 1,
        intervalOverrideMs: 5,
      });

      const result = await daemon.tick();
      assert.equal(result.success, false);
      assert.ok(result.error);

      const actions = db.getActions(10, 'heartbeat');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'TICK_FAILED');
    });
  });
});
