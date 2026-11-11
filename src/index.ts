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
import { InferenceEngine } from './modules/inference/engine.ts';
import { createInferenceProvider } from './modules/inference/provider.ts';
import type { InferenceEngineOptions } from './modules/inference/types.ts';
import { defaultProbabilityEstimator, PolymarketScanner } from './modules/polymarket/scanner.ts';
import { X402Server } from './modules/micropayments/server.ts';
import { executeMitosisLifecycleTick } from './evolution/mitosis.ts';
import fs from 'node:fs';
import { BountiesScanner, BountyEvaluator } from './modules/bounties/scanner.ts';
import { ImmuneSystem, type ModificationProposal } from './evolution/immune_system.ts';

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
  inference?: InferenceEngine;
  immuneProposalGenerator?: (failure: string) => Promise<ModificationProposal | null>;
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
  private inference?: InferenceEngine;
  private onTickExecuted?: (result: TickResult) => Promise<void> | void;
  private timer?: NodeJS.Timeout;
  private lastTickTimestamp?: number;
  private lastBalanceUsd?: number;
  private currentTier?: MetabolicTier;
  private tickPromise: Promise<TickResult> | null = null;
  private x402Server?: X402Server;
  private stopRequested = false;
  private immuneProposalGenerator?: (failure: string) => Promise<ModificationProposal | null>;
  private pendingImmuneFailure?: string;

  constructor(options?: HeartbeatDaemonOptions) {
    this.config = options?.config ?? getConfig();
    this.database = options?.database ?? getDatabase();
    this.wallet = options?.wallet ?? getWallet();
    this.maxCycles = options?.maxCycles;
    this.intervalOverrideMs = options?.intervalOverrideMs;
    this.inference = options?.inference ?? new InferenceEngine({
      mode: this.config.inference.mode,
      capPerTick: this.config.inference.capPerTick,
      providers: this.config.inference.providers.map(
        (providerConfig) => createInferenceProvider(providerConfig)
      ),
      fallback: defaultProbabilityEstimator,
      onFallback: (event) => this.recordInferenceFallback(event),
      onInvalidProbability: (event) => this.recordInferenceInvalid(event),
      onInvalidScore: (event) => this.recordInferenceInvalidScore(event),
      onExpense: (event) => this.recordInferenceExpense(event),
      onStatus: (event) => this.recordInferenceStatus(event),
    });
    this.onTickExecuted = options?.onTickExecuted;
    this.immuneProposalGenerator = options?.immuneProposalGenerator;

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
    if (process.env.AGENT_CONTROL_FILE && process.send) {
      try { fs.writeFileSync(process.env.AGENT_CONTROL_FILE, `${process.pid}\n`); } catch { /* dashboard owns reservation */ }
      process.send('agent-ready');
    }
    await this.tick();
  }

  /**
   * Gracefully stops the heartbeat daemon and clears scheduled timers.
   */
  public async stop(reason: string = 'Graceful shutdown'): Promise<void> {
    this.stopRequested = true;
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
    if (this.x402Server) await this.x402Server.stop();
    if (process.env.AGENT_CONTROL_FILE) {
      try { fs.unlinkSync(process.env.AGENT_CONTROL_FILE); } catch { /* already removed */ }
    }
    if (process.env.AGENT_STOP_FILE) {
      try { fs.unlinkSync(process.env.AGENT_STOP_FILE); } catch { /* already removed */ }
    }
  }

  private recordInferenceFallback(event: { reason: string; providerId?: string; marketId?: string }): void {
    if (!this.database || !this.database.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'inference',
        actionType: 'INFERENCE_FALLBACK',
        details: JSON.stringify({
          reason: event.reason,
          providerId: event.providerId ?? null,
          marketId: event.marketId ?? null,
        }),
        tier: this.currentTier ?? 'VERDE',
        balanceUsd: this.lastBalanceUsd ?? 0,
        timestamp: Date.now(),
      });
    } catch {
      // Ignored
    }
  }

  private recordInferenceInvalid(event: { value: { pYes?: number; pNo?: number }; providerId?: string; marketId?: string }): void {
    if (!this.database || !this.database.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'inference',
        actionType: 'INFERENCE_INVALID_PROBABILITY',
        details: JSON.stringify({
          value: event.value,
          providerId: event.providerId ?? null,
          marketId: event.marketId ?? null,
        }),
        tier: this.currentTier ?? 'VERDE',
        balanceUsd: this.lastBalanceUsd ?? 0,
        timestamp: Date.now(),
      });
    } catch {
      // Ignored
    }
  }

  private recordInferenceExpense(event: { costUsd: number; providerId: string }): void {
    if (!this.database || !this.database.isOpen()) return;
    try {
      this.database.insertLedger({
        txHash: `llm_${event.providerId}_${Date.now()}`,
        chain: 'base',
        token: 'USDC',
        amount: event.costUsd,
        entryType: 'EXPENSE_LLM',
        counterparty: event.providerId,
        timestamp: Date.now(),
      });
    } catch {
      // Ignored
    }
  }

  private recordInferenceStatus(event: {
    mode: 'free' | 'paid';
    providerId: string | null;
    providerModel: string | null;
    callsUsed: number;
    capPerTick: number;
    source: 'provider' | 'deterministic';
    fallbackReason: string | null;
  }): void {
    if (!this.database?.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'inference',
        actionType: 'INFERENCE_STATUS',
        details: JSON.stringify(event),
        tier: this.currentTier ?? 'VERDE',
        balanceUsd: this.lastBalanceUsd ?? 0,
        timestamp: Date.now(),
      });
    } catch { /* inference must continue if status persistence is unavailable */ }
  }

  private recordInferenceInvalidScore(event: { value: unknown; providerId?: string; taskId: string }): void {
    if (!this.database?.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'inference',
        actionType: 'INFERENCE_INVALID_SCORE',
        details: JSON.stringify(event),
        tier: this.currentTier ?? 'VERDE',
        balanceUsd: this.lastBalanceUsd ?? 0,
        timestamp: Date.now(),
      });
    } catch { /* invalid output logging must not interrupt the tick */ }
  }

  /**
   * Executes a single cognitive heartbeat tick.
   */
  public async tick(): Promise<TickResult> {
    if (this.tickPromise) return this.tickPromise;
    this.tickPromise = this.runTick();
    try { return await this.tickPromise; } finally { this.tickPromise = null; }
  }

  private async runTick(): Promise<TickResult> {
    try {
      // 0. Reset the per-tick inference call counter (mode/queue/cap policy)
      this.inference?.resetTick();
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

      if (tierStatus.tier === 'VERDE') {
        try {
          await executeMitosisLifecycleTick({
            database: this.database,
            wallet: this.wallet as ApexWallet,
            config: this.config,
            currentTier: tierStatus.tier,
            cycleCount: this.cycleCount + 1,
            isChildAgent: Boolean(process.env.AGENT_PARENT_ADDRESS),
          });
        } catch (error) {
          this.recordDispatchFailure('MITOSIS_TICK_FAILED', (error as Error).message);
        }
      }

      // Start the revenue endpoint once per daemon lifetime; a bind failure is
      // recorded but does not interrupt the remaining economic workload.
      if (this.isRunning && !this.x402Server) {
        this.x402Server = new X402Server({ config: this.config, database: this.database, wallet: this.wallet });
        try {
          await this.x402Server.start();
        } catch (error) {
          this.recordDispatchFailure('X402_START_FAILED', (error as Error).message);
          this.x402Server = undefined;
        }
      }

      if (tierStatus.tier === 'VERDE' || tierStatus.tier === 'AMARELO') {
        try {
          const scanner = new PolymarketScanner(
            this.config.polymarket.clobApiUrl,
            this.config.network.isMock
          );
          const opportunities = await scanner.scanOpportunities(
            balanceUsd,
            async (market) => {
              const outcome = await this.inference!.estimate(market);
              return outcome.estimate
                ? { pYes: outcome.estimate.pYes, pNo: outcome.estimate.pNo }
                : null;
            }
          );
          if (this.database?.isOpen()) {
            for (const opportunity of opportunities) {
              this.database.recordAction({
                component: 'polymarket',
                actionType: 'OPPORTUNITY_EVALUATED',
                details: JSON.stringify({
                  marketId: opportunity.market.id,
                  outcome: opportunity.outcome,
                  estimatedProb: opportunity.estimatedProb,
                  edge: opportunity.edge,
                  kellyStakeUsd: opportunity.kelly.stakeAmountUsd,
                  inferenceSource: this.inference?.status.source,
                }),
                tier: tierStatus.tier,
                balanceUsd,
                timestamp: Date.now(),
              });
            }
          }
        } catch (error) {
          this.recordDispatchFailure('POLYMARKET_SCAN_FAILED', (error as Error).message);
        }
      }

      if (tierStatus.tier !== 'VERMELHO') {
        try {
          const bounties = new BountiesScanner({ config: this.config, database: this.database });
          const tasks = await bounties.scanBounties();
          for (const task of tasks) {
            const deterministic = () =>
              BountyEvaluator.evaluate(task, { minRewardUsd: this.config.bounties.minRewardUsd }).score;
            const outcome = tierStatus.tier === 'LARANJA'
              ? { source: 'deterministic' as const, score: deterministic() }
              : await this.inference!.evaluateBounty(task, deterministic);
            bounties.evaluateBounty(task, {
              modelScore: outcome.score,
              inferenceOrigin: outcome.source,
            });
          }
        } catch (error) {
          this.recordDispatchFailure('BOUNTY_SCAN_FAILED', (error as Error).message);
        }
      }

      // The immune gate runs after revenue and inference dispatch. It only
      // receives a proposal when a new failure episode exists and the tree is clean.
      await this.dispatchImmuneProposal(tierStatus.tier, balanceUsd);

      // 5. Tier-Gated Inference Dispatch (LLM estimates within the per-tick cap;
      //    the deterministic estimator is always the last degrau — Constitution Article III)
      // VERDE: full exploration and high reasoning — LLM-backed estimates within INFERENCE_CAP_PER_TICK
      // AMARELO: conservative routine maintenance — deterministic fallback
      // LARANJA: survival liquidity harvesting only — deterministic fallback

      this.cycleCount++;
      this.pendingImmuneFailure = undefined;

      const controlFile = process.env.AGENT_STOP_FILE;
      if (this.stopRequested || (controlFile && fs.existsSync(controlFile))) {
        await this.stop('Dashboard requested graceful stop');
      }

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
        if (this.x402Server) await this.x402Server.stop();
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
      if (this.currentTier === 'VERDE' && !this.pendingImmuneFailure) {
        this.pendingImmuneFailure = errorMsg;
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

  private recordDispatchFailure(actionType: string, reason: string): void {
    if (!this.database?.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'heartbeat', actionType, details: reason,
        tier: this.currentTier ?? 'VERDE', balanceUsd: this.lastBalanceUsd ?? 0, timestamp: Date.now(),
      });
    } catch { /* dispatch failures remain non-fatal */ }
  }

  private async dispatchImmuneProposal(tier: MetabolicTier, balanceUsd: number): Promise<void> {
    if (tier !== 'VERDE' || !this.pendingImmuneFailure) return;
    const record = (actionType: string, details: string) => {
      if (!this.database?.isOpen()) return;
      this.database.recordAction({
        component: 'immune_system', actionType, details,
        tier, balanceUsd, timestamp: Date.now(),
      });
    };
    try {
      const immune = new ImmuneSystem({ database: this.database, wallet: this.wallet });
      const preProposalFiles = await immune.getModifiedFiles();
      if (preProposalFiles.length > 0) {
        record('IMMUNE_PROPOSAL_REFUSED_DIRTY_TREE', JSON.stringify({ failure: this.pendingImmuneFailure, files: preProposalFiles }));
        return;
      }
      if (!this.immuneProposalGenerator) {
        record('IMMUNE_PROPOSAL_UNAVAILABLE', JSON.stringify({ failure: this.pendingImmuneFailure }));
        return;
      }
      const proposal = await this.immuneProposalGenerator(this.pendingImmuneFailure);
      if (!proposal?.description || !proposal.commitMessage || !proposal.targetFiles?.length) {
        record('IMMUNE_PROPOSAL_REFUSED', JSON.stringify({ reason: 'Incomplete proposal', failure: this.pendingImmuneFailure }));
        return;
      }
      const actualFiles = await immune.getModifiedFiles();
      const declaredFiles = [...proposal.targetFiles].map((file) => file.replace(/\\/g, '/')).sort();
      if (JSON.stringify([...actualFiles].sort()) !== JSON.stringify(declaredFiles)) {
        record('IMMUNE_PROPOSAL_REFUSED_DIRTY_TREE', JSON.stringify({ reason: 'Changed files differ from proposal targets', actualFiles, declaredFiles }));
        return;
      }
      await immune.validateModification(proposal);
    } catch (error) {
      record('IMMUNE_DISPATCH_FAILED', (error as Error).message);
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

// ==============================================================================
// 9. Re-Export Evolution Modules
// ==============================================================================
export * from './evolution/immune_system.ts';
export * from './evolution/mitosis.ts';

