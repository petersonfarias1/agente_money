/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Heartbeat Daemon & Main Entry Point
 * ==============================================================================
 * Orchestrates the autonomous cognitive lifecycle:
 * 1. Pre-inference liquid balance check (prevents phantom insolvency)
 * 2. Metabolic tier dynamic evaluation (Verde, Amarelo, Laranja, Vermelho)
 * 3. Immutable audit action logging in SQLite database
 * 4. Permadeath trigger on verified zero balance ($0.00 USD)
 * 5. Tier-gated task scheduling with dynamic intervals
 * 6. Graceful OS signal handling (SIGINT, SIGTERM)
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  AppConfig,
  MetabolicTier,
  WalletClient,
} from './types.ts';
import { getConfig } from './config.ts';
import { DatabaseService, getDatabase } from './core/database.ts';
import { ApexWallet, getWallet } from './core/wallet.ts';
import { evaluateTier } from './core/metabolism.ts';
import { executePermadeath, registerTeardownHook } from './core/death.ts';

export interface TickResult {
  success: boolean;
  cycle: number;
  tier: MetabolicTier;
  balanceUsd: number;
  heartbeatIntervalMs: number;
  reason?: string;
  error?: string;
}

export interface DaemonStatus {
  isRunning: boolean;
  cycleCount: number;
  lastTickTimestamp?: number;
  lastBalanceUsd?: number;
  currentTier?: MetabolicTier;
}

export interface HeartbeatDaemonOptions {
  config?: AppConfig;
  database?: DatabaseService;
  wallet?: WalletClient;
  maxCycles?: number;
  intervalOverrideMs?: number;
  autoStart?: boolean;
  onTickExecuted?: (result: TickResult) => Promise<void> | void;
}

export class HeartbeatDaemon {
  public cycleCount: number = 0;
  public isRunning: boolean = false;

  private config: AppConfig;
  private database: DatabaseService;
  private wallet: WalletClient;
  private maxCycles?: number;
  private intervalOverrideMs?: number;
  private onTickExecuted?: (result: TickResult) => Promise<void> | void;
  private timer?: NodeJS.Timeout;
  private lastTickTimestamp?: number;
  private lastBalanceUsd?: number;
  private currentTier?: MetabolicTier;

  constructor(options?: HeartbeatDaemonOptions) {
    this.config = options?.config ?? getConfig();
    this.database = options?.database ?? getDatabase();
    this.wallet = options?.wallet ?? getWallet();
    this.maxCycles = options?.maxCycles;
    this.intervalOverrideMs = options?.intervalOverrideMs;
    this.onTickExecuted = options?.onTickExecuted;

    // Register teardown hook to stop daemon cleanly on Permadeath
    registerTeardownHook(() => {
      this.stop('Permadeath initiated');
    });

    if (options?.autoStart) {
      this.start().catch((err) => {
        console.error('[HeartbeatDaemon] Auto-start error:', err);
      });
    }
  }

  /**
   * Starts the autonomous heartbeat cognitive loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.tick();
  }

  /**
   * Gracefully stops the heartbeat daemon and clears scheduled timers.
   */
  public async stop(reason: string = 'Graceful shutdown'): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.database && this.database.isOpen()) {
      try {
        this.database.recordAction({
          component: 'heartbeat',
          actionType: 'DAEMON_STOPPED',
          details: reason,
          tier: this.currentTier ?? 'VERDE',
          balanceUsd: this.lastBalanceUsd ?? 0,
          timestamp: Date.now(),
        });
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Executes a single cognitive heartbeat tick.
   */
  public async tick(): Promise<TickResult> {
    try {
      // 1. Pre-Inference Balance Verification (Article III)
      const balanceUsd = await this.wallet.getTotalBalanceUsd();
      this.lastBalanceUsd = balanceUsd;
      this.lastTickTimestamp = Date.now();

      // 2. Metabolic Tier Evaluation
      const tierStatus = evaluateTier(balanceUsd);
      this.currentTier = tierStatus.tier;

      // 3. SQLite Audit Record
      if (this.database && this.database.isOpen()) {
        this.database.recordAction({
          component: 'heartbeat',
          actionType: 'TICK_EVALUATED',
          details: JSON.stringify({
            cycle: this.cycleCount + 1,
            tier: tierStatus.tier,
            modelClass: tierStatus.modelClass,
            allowSpeculativeResearch: tierStatus.allowSpeculativeResearch,
            allowSelfModification: tierStatus.allowSelfModification,
          }),
          tier: tierStatus.tier,
          balanceUsd,
          timestamp: this.lastTickTimestamp,
        });
      }

      // 4. Terminal Insolvency Check (Article IV)
      if (tierStatus.tier === 'VERMELHO') {
        this.isRunning = false;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }

        await executePermadeath({
          database: this.database,
          wallet: this.wallet,
          finalBalanceUsd: balanceUsd,
          totalCyclesExecuted: this.cycleCount + 1,
          reason: tierStatus.reason,
        });

        return {
          success: false,
          cycle: this.cycleCount + 1,
          tier: 'VERMELHO',
          balanceUsd,
          heartbeatIntervalMs: 0,
          reason: 'Terminal Insolvency',
        };
      }

      // 5. Tier-Gated Workload Dispatch (Placeholder for Milestone 3/4 tasks)
      // VERDE: full exploration and high reasoning
      // AMARELO: conservative routine maintenance
      // LARANJA: survival liquidity harvesting only

      this.cycleCount++;

      const result: TickResult = {
        success: true,
        cycle: this.cycleCount,
        tier: tierStatus.tier,
        balanceUsd,
        heartbeatIntervalMs: tierStatus.heartbeatIntervalMs,
        reason: tierStatus.reason,
      };

      if (this.onTickExecuted) {
        await this.onTickExecuted(result);
      }

      // 6. Dynamic Rescheduling
      if (this.isRunning && (!this.maxCycles || this.cycleCount < this.maxCycles)) {
        const intervalMs = this.intervalOverrideMs ?? tierStatus.heartbeatIntervalMs;
        this.timer = setTimeout(() => {
          this.tick().catch((err) => {
            console.error('[HeartbeatDaemon] Uncaught tick error:', err);
          });
        }, intervalMs);
      } else if (this.maxCycles && this.cycleCount >= this.maxCycles) {
        this.isRunning = false;
      }

      return result;
    } catch (err) {
      // If terminal insolvency occurred, never swallow permadeath exit exception
      if (this.currentTier === 'VERMELHO') {
        throw err;
      }

      const errorMsg = (err as Error).message;

      if (this.database && this.database.isOpen()) {
        try {
          this.database.recordAction({
            component: 'heartbeat',
            actionType: 'TICK_FAILED',
            details: errorMsg,
            tier: this.currentTier ?? 'VERDE',
            balanceUsd: this.lastBalanceUsd ?? 0,
            timestamp: Date.now(),
          });
        } catch {
          // Ignored
        }
      }

      // Reschedule retry on transient errors
      if (this.isRunning && (!this.maxCycles || this.cycleCount < this.maxCycles)) {
        const retryDelay = this.intervalOverrideMs ?? 10000;
        this.timer = setTimeout(() => {
          this.tick().catch(() => {});
        }, retryDelay);
      }

      return {
        success: false,
        cycle: this.cycleCount,
        tier: this.currentTier ?? 'VERDE',
        balanceUsd: this.lastBalanceUsd ?? 0,
        heartbeatIntervalMs: 0,
        error: errorMsg,
      };
    }
  }

  public getStatus(): DaemonStatus {
    return {
      isRunning: this.isRunning,
      cycleCount: this.cycleCount,
      lastTickTimestamp: this.lastTickTimestamp,
      lastBalanceUsd: this.lastBalanceUsd,
      currentTier: this.currentTier,
    };
  }
}

// ==============================================================================
// 7. Signal Handling & CLI Bootstrap
// ==============================================================================

export function registerSignalHandlers(daemon: HeartbeatDaemon): void {
  const onSignal = async (sig: string) => {
    console.log(`[APEX AEA] Received ${sig}. Initiating graceful shutdown...`);
    await daemon.stop(`OS signal ${sig}`);
    process.exit(0);
  };

  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}

const isMainModule =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const daemon = new HeartbeatDaemon({ autoStart: true });
  registerSignalHandlers(daemon);
}

// ==============================================================================
// 8. Re-Export Triple Revenue Engine Modules
// ==============================================================================
export * from './modules/polymarket/kelly.ts';
export * from './modules/polymarket/scanner.ts';
export * from './modules/polymarket/order.ts';
export * from './modules/micropayments/server.ts';
export * from './modules/bounties/scanner.ts';

