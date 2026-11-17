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
  InferenceMode,
  MetabolicTier,
  WalletClient,
} from './types.ts';
import { getConfig } from './config.ts';
import { DatabaseService, getDatabase } from './core/database.ts';
import type { InferenceUsageRecord } from './modules/monitor/types.ts';
import { ApexWallet, getWallet } from './core/wallet.ts';
import { evaluateTier } from './core/metabolism.ts';
import { executePermadeath, registerTeardownHook } from './core/death.ts';
import { InferenceEngine } from './modules/inference/engine.ts';
import { createInferenceProvider } from './modules/inference/provider.ts';
import type { InferenceEngineOptions, InferenceProvider } from './modules/inference/types.ts';
import { NoLLMAvailableError, runInferencePreflight, type PreflightResult } from './modules/inference/preflight.ts';
import { defaultProbabilityEstimator, PolymarketScanner } from './modules/polymarket/scanner.ts';
import { OrderManager } from './modules/polymarket/order.ts';
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
  tombstonePath?: string;
  maxCycles?: number;
  intervalOverrideMs?: number;
  autoStart?: boolean;
  inference?: InferenceEngine;
  /** Provider queue already vetted by the startup preflight (overrides config). */
  inferenceProviders?: InferenceProvider[];
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
  private tombstonePath?: string;
  private inference?: InferenceEngine;
  private onTickExecuted?: (result: TickResult) => Promise<void> | void;
  private timer?: NodeJS.Timeout;
  private lastTickTimestamp?: number;
  private lastBalanceUsd?: number;
  private currentTier?: MetabolicTier;
  private tickPromise: Promise<TickResult> | null = null;
  private x402Server?: X402Server;
  private orderManager?: OrderManager;
  private readonly evaluatedBounties = new Map<string, number>();
  private stopRequested = false;
  private immuneProposalGenerator?: (failure: string) => Promise<ModificationProposal | null>;
  private pendingImmuneFailure?: string;

  constructor(options?: HeartbeatDaemonOptions) {
    this.config = options?.config ?? getConfig();
    this.database = options?.database ?? getDatabase();
    this.wallet = options?.wallet ?? getWallet();
    this.maxCycles = options?.maxCycles;
    this.intervalOverrideMs = options?.intervalOverrideMs;
    this.tombstonePath = options?.tombstonePath;
    this.inference = options?.inference ?? new InferenceEngine({
      mode: this.config.inference.mode,
      capPerTick: this.config.inference.capPerTick,
      providers: options?.inferenceProviders ?? this.config.inference.providers.map(
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
    if (process.env.AGENT_CONTROL_FILE) {
      try { fs.writeFileSync(process.env.AGENT_CONTROL_FILE, `${process.pid}\n`); } catch { /* dashboard owns reservation */ }
    }
    if (process.env.AGENT_CONTROL_FILE && process.send) {
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
    mode: InferenceMode;
    ceilingMode: InferenceMode;
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
    // Append-only monitor index: one row per inference status event (provider
    // walkthrough + fallback), so the daemon keeps a full history without
    // touching the read-only actions/audit trail.
    try {
      this.database.recordInferenceUsage({
        tickAt: Date.now(),
        mode: event.mode,
        ceilingMode: event.ceilingMode,
        providerId: event.providerId,
        providerModel: event.providerModel,
        callsUsed: event.callsUsed,
        capPerTick: event.capPerTick,
        source: event.source,
        fallbackReason: event.fallbackReason,
        recordedAt: Date.now(),
      });
    } catch { /* the monitor index must never stall inference */ }
  }

  /** Records the tier-driven step down (or restore) of the inference mode (AD-003). */
  private recordInferenceModeChange(
    transition: { from: InferenceMode; to: InferenceMode },
    tier: MetabolicTier,
    balanceUsd: number
  ): void {
    if (!this.database?.isOpen()) return;
    try {
      this.database.recordAction({
        component: 'inference',
        actionType: transition.to === 'free' ? 'INFERENCE_MODE_DOWNGRADED' : 'INFERENCE_MODE_RESTORED',
        details: JSON.stringify({ ...transition, ceilingMode: this.inference?.ceilingMode ?? transition.from, tier }),
        tier,
        balanceUsd,
        timestamp: Date.now(),
      });
    } catch { /* the engine already switched; persistence is best effort */ }
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
      // 2.1 The tier can only step the inference mode down from the ceiling (AD-003).
      const modeChange = this.inference?.applyTier(tierStatus.tier) ?? null;
      if (modeChange) this.recordInferenceModeChange(modeChange, tierStatus.tier, balanceUsd);

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
          tombstonePath: this.tombstonePath,
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
            if (!this.orderManager) {
              this.orderManager = new OrderManager(
                this.database,
                this.wallet,
                this.config.network.isMock
              );
            }
            const openMarketIds = new Set(
              this.database.getPositions(100, 'OPEN').map((p) => p.marketId)
            );
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
              if (opportunity.kelly.authorized && !openMarketIds.has(opportunity.market.id)) {
                try {
                  await this.orderManager.placeOrder(opportunity, {
                    paperTrading: this.config.networkMode !== 'mainnet',
                  });
                  openMarketIds.add(opportunity.market.id);
                } catch (orderErr) {
                  this.recordDispatchFailure(
                    'POLYMARKET_ORDER_FAILED',
                    (orderErr as Error).message
                  );
                }
              }
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
          const now = Date.now();
          const REEVAL_TTL_MS = 15 * 60 * 1000;
          for (const task of tasks) {
            const lastEvalAt = this.evaluatedBounties.get(task.id);
            if (lastEvalAt !== undefined && now - lastEvalAt < REEVAL_TTL_MS) {
              continue;
            }
            const deterministic = () =>
              BountyEvaluator.evaluate(task, { minRewardUsd: this.config.bounties.minRewardUsd }).score;
            const outcome = tierStatus.tier === 'LARANJA'
              ? { source: 'deterministic' as const, score: deterministic() }
              : await this.inference!.evaluateBounty(task, deterministic);
            bounties.evaluateBounty(task, {
              modelScore: outcome.score,
              inferenceOrigin: outcome.source,
            });
            this.evaluatedBounties.set(task.id, now);
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

/** Exit code used when the agent refuses to start (EX_CONFIG). */
export const START_REFUSED_EXIT_CODE = 78;

export interface BootstrapDeps {
  config?: AppConfig;
  database?: DatabaseService;
  providers?: InferenceProvider[];
  preflightTimeoutMs?: number;
  /** IPC channel to the dashboard controller (defaults to process.send). */
  send?: (message: unknown, callback?: () => void) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  createDaemon?: (options: HeartbeatDaemonOptions) => HeartbeatDaemon;
}

function recordStartupAction(
  database: DatabaseService | undefined,
  actionType: string,
  details: unknown
): void {
  if (!database?.isOpen()) return;
  try {
    database.recordAction({
      component: 'inference',
      actionType,
      details: JSON.stringify(details),
      tier: 'VERDE',
      balanceUsd: 0,
      timestamp: Date.now(),
    });
  } catch { /* the console and IPC still carry the result */ }
}

/**
 * Process entry point: loads configuration, runs the blocking LLM preflight
 * for the configured inference mode and only then starts the heartbeat.
 * When no provider answers, the reason is persisted, sent to the dashboard
 * over IPC, and the process exits with START_REFUSED_EXIT_CODE.
 */
export async function bootstrapAgent(deps: BootstrapDeps = {}): Promise<HeartbeatDaemon | null> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const send = deps.send ?? (process.send ? process.send.bind(process) as BootstrapDeps['send'] : undefined);
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const refuse = (reason: string): null => {
    log(`[APEX AEA] Start refused: ${reason}`);
    if (send) {
      let exited = false;
      // Never hang if the IPC channel does not acknowledge.
      const ackTimer = setTimeout(() => done(), 1000);
      ackTimer.unref?.();
      const done = () => {
        if (exited) return;
        exited = true;
        clearTimeout(ackTimer);
        exit(START_REFUSED_EXIT_CODE);
      };
      try {
        send({ type: 'agent-start-failed', reason }, done);
      } catch {
        done();
      }
    } else {
      exit(START_REFUSED_EXIT_CODE);
    }
    return null;
  };

  let config: AppConfig;
  try {
    config = deps.config ?? getConfig();
  } catch (error) {
    return refuse((error as Error).message);
  }

  let database: DatabaseService | undefined = deps.database;
  if (!database) {
    try { database = getDatabase(); } catch { database = undefined; }
  }

  const providers = deps.providers ?? config.inference.providers.map((providerConfig) =>
    createInferenceProvider(providerConfig)
  );

  log(`[APEX AEA] Inference preflight: mode=${config.inference.mode}, providers=${providers.length}`);
  let preflight: PreflightResult;
  try {
    preflight = await runInferencePreflight(providers, config.inference.mode, {
      timeoutMs: deps.preflightTimeoutMs,
    });
  } catch (error) {
    const reason = (error as Error).message;
    recordStartupAction(database, 'INFERENCE_PREFLIGHT_FAILED', {
      mode: config.inference.mode,
      reason,
      failed: error instanceof NoLLMAvailableError ? error.failed : [],
    });
    return refuse(reason);
  }

  for (const failure of preflight.failed) {
    recordStartupAction(database, 'INFERENCE_PROVIDER_UNAVAILABLE', { mode: preflight.mode, ...failure });
  }
  recordStartupAction(database, 'INFERENCE_PREFLIGHT_OK', {
    mode: preflight.mode,
    passed: preflight.passed,
    failed: preflight.failed,
  });
  log(
    `[APEX AEA] Inference ready: ${preflight.passed.map((p) => `${p.id}(${p.model})`).join(', ')}` +
      (preflight.failed.length ? ` | dropped: ${preflight.failed.map((f) => f.id).join(', ')}` : '')
  );

  // A paid ceiling steps down to free below VERDE (AD-003). The free queue is
  // vetted too, but only as a warning: it never blocks the start.
  let stepDownProviders: InferenceProvider[] = [];
  if (preflight.mode === 'paid') {
    try {
      const free = await runInferencePreflight(providers, 'free', { timeoutMs: deps.preflightTimeoutMs });
      stepDownProviders = free.healthy;
      recordStartupAction(database, 'INFERENCE_FREE_PREFLIGHT_OK', { mode: 'free', passed: free.passed, failed: free.failed });
      log(`[APEX AEA] Free step-down ready: ${free.passed.map((p) => p.id).join(', ')}`);
    } catch (error) {
      const reason = (error as Error).message;
      recordStartupAction(database, 'INFERENCE_FREE_PREFLIGHT_FAILED', {
        mode: 'free',
        reason,
        failed: error instanceof NoLLMAvailableError ? error.failed : [],
      });
      log(`[APEX AEA] Warning: no free step-down below VERDE (${reason}); AMARELO will use the deterministic estimator`);
    }
  }

  const daemonOptions: HeartbeatDaemonOptions = {
    config,
    database,
    inferenceProviders: [...preflight.healthy, ...stepDownProviders],
    autoStart: true,
  };
  const daemon = deps.createDaemon ? deps.createDaemon(daemonOptions) : new HeartbeatDaemon(daemonOptions);
  registerSignalHandlers(daemon);
  return daemon;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  if (!process.env.AGENT_CONTROL_FILE) {
    process.env.AGENT_CONTROL_FILE = path.resolve(process.cwd(), '.agent.pid');
  }
  if (!process.env.AGENT_STOP_FILE) {
    process.env.AGENT_STOP_FILE = path.resolve(process.cwd(), '.agent.stop');
  }
  bootstrapAgent().catch((error) => {
    console.error('[APEX AEA] Fatal bootstrap error:', error);
    process.exit(1);
  });
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

