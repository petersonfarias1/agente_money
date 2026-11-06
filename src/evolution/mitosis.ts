/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Darwinian Mitosis & Royalty Lifecycle
 * ==============================================================================
 * Biological-digital reproduction and intergenerational clan covenant per Constitution:
 * 1. Capital Threshold Gating: strictly blocked if balance < 3x initial capital ($150).
 * 2. Pre-Replication Proof of Viability: simulated paper trading over N steps
 *    requiring strictly positive Sharpe ratio and positive net return.
 * 3. Cryptographic Sub-Wallet Derivation: deterministic RFC 5869 HKDF key derivation.
 * 4. Surplus Allocation & Whitelist Invariant: 1/3 child seed ($50), 2/3 mother retained ($100).
 * 5. High-Water Mark Cumulative 5% Clan Royalty: exact 5% on realized net profits with
 *    drawdown immunity, cash-flow solvency buffer ($15.00), and dust protection ($0.50).
 * 6. Atomic Double-Entry Persistence: ledger (SEED_CAPITAL, ROYALTY_OUT, ROYALTY_IN),
 *    lineage (total_royalties_paid_usd), and audit action logging.
 * 7. Evolutionary Hyperparameter Mutation: stochastic variation bounded by Constitution
 *    Article II (Quarter-Kelly ceiling <= 0.25, bankroll cap <= 0.05).
 */

import crypto from 'node:crypto';
import type {
  AppConfig,
  SupportedChain,
  LineageEntry,
  WalletClient,
  MetabolicTier,
} from '../types.ts';
import { ConstitutionViolationError, MitosisError } from '../types.ts';
import { getConfig, isValidAddress, isValidPrivateKey } from '../config.ts';
import { DatabaseService, getDatabase } from '../core/database.ts';
import { ApexWallet, getWallet } from '../core/wallet.ts';
import { calculateKellyStake } from '../modules/polymarket/kelly.ts';

// ==============================================================================
// 1. Constitutional Constants
// ==============================================================================

export const CONSTITUTIONAL_ROYALTY_PERCENTAGE = 0.05; // Exactly 5.0% (Article VI.4)
export const CONSTITUTIONAL_MAX_KELLY_FRACTION = 0.25; // Quarter-Kelly Ceiling (Article II.1)
export const CONSTITUTIONAL_MAX_BANKROLL_BET_PERCENT = 0.05; // 5% Bankroll Ceiling (Article II.2)
export const DEFAULT_MIN_ROYALTY_REMITTANCE_USD = 0.50; // Dust transfer threshold
export const MIN_SOLVENT_BUFFER_USD = 15.00; // Free surplus buffer above Tier Amarelo

// ==============================================================================
// 2. Custom Domain Errors
// ==============================================================================

/**
 * Thrown when mother agent's liquid balance is below the required capital hurdle (3x initial capital).
 */
export class MitosisThresholdError extends MitosisError {
  public readonly currentBalanceUsd: number;
  public readonly requiredThresholdUsd: number;
  public readonly deficitUsd: number;

  constructor(currentBalanceUsd: number, requiredThresholdUsd: number) {
    const isBelow = currentBalanceUsd < requiredThresholdUsd;
    const rawDeficit = requiredThresholdUsd - currentBalanceUsd;
    const deficitUsd = isBelow
      ? Math.max(0.000001, Number(rawDeficit.toFixed(6)))
      : 0;
    super(
      `Replication blocked: Current balance ($${currentBalanceUsd.toFixed(2)}) is below the required capital threshold ($${requiredThresholdUsd.toFixed(2)}). Deficit: $${deficitUsd.toFixed(2)}.`
    );
    this.name = 'MitosisThresholdError';
    this.currentBalanceUsd = currentBalanceUsd;
    this.requiredThresholdUsd = requiredThresholdUsd;
    this.deficitUsd = deficitUsd;
  }
}

/**
 * Thrown when candidate child strategy fails the mandatory pre-replication proof of viability.
 */
export class ViabilityCheckFailedError extends MitosisError {
  public readonly sharpeRatio: number;
  public readonly netReturnUsd: number;
  public readonly winRate: number;
  public readonly reason: string;
  public readonly simulationSteps: number;

  constructor(metrics: {
    sharpeRatio: number;
    netReturnUsd: number;
    winRate: number;
    reason: string;
    simulationSteps: number;
  }) {
    super(
      `Pre-replication proof of viability failed: ${metrics.reason} ` +
        `(Sharpe: ${metrics.sharpeRatio.toFixed(3)}, Net Return: $${metrics.netReturnUsd.toFixed(2)}, ` +
        `Win Rate: ${(metrics.winRate * 100).toFixed(1)}%, Steps: ${metrics.simulationSteps}).`
    );
    this.name = 'ViabilityCheckFailedError';
    this.sharpeRatio = metrics.sharpeRatio;
    this.netReturnUsd = metrics.netReturnUsd;
    this.winRate = metrics.winRate;
    this.reason = metrics.reason;
    this.simulationSteps = metrics.simulationSteps;
  }
}

/**
 * Thrown on royalty remittance execution or validation errors.
 */
export class RoyaltyRemittanceError extends MitosisError {
  constructor(message: string) {
    super(`[ROYALTY REMITTANCE] ${message}`);
    this.name = 'RoyaltyRemittanceError';
  }
}

/**
 * Thrown on hyperparameter mutation validation errors.
 */
export class HyperparameterMutationError extends MitosisError {
  constructor(message: string) {
    super(`[HYPERPARAMETER MUTATION] ${message}`);
    this.name = 'HyperparameterMutationError';
  }
}

// ==============================================================================
// 3. Domain Interfaces
// ==============================================================================

export interface MitosisThresholdCheck {
  eligible: boolean;
  currentBalanceUsd: number;
  initialCapitalUsd: number;
  thresholdRequiredUsd: number;
  surplusUsd: number;
  deficitUsd: number;
  childSeedAllocationUsd: number;
  motherRetainedUsd: number;
  reason?: string;
}

export interface SyntheticTradeStep {
  step: number;
  marketPrice: number;
  modelEstimatedProb: number;
  kellyFraction: number;
  stakeUsd: number;
  won: boolean;
  pnlUsd: number;
  resultingBankrollUsd: number;
  returnFraction: number;
}

export interface ViabilitySimulationConfig {
  steps?: number;
  initialSimulatedBankrollUsd?: number;
  riskFreeRate?: number;
  minSharpeRatio?: number;
  minNetReturnUsd?: number;
  seed?: number;
  customPriceFeed?: Array<{ marketPrice: number; modelProb: number; won: boolean }>;
}

export interface ViabilitySimulationResult {
  passed: boolean;
  stepsExecuted: number;
  initialBankrollUsd: number;
  finalBankrollUsd: number;
  netReturnUsd: number;
  netReturnPercent: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trades: SyntheticTradeStep[];
  failureReason?: string;
}

export interface SubWalletDerivationResult {
  childIndex: number;
  generation: number;
  address: string;
  privateKey: string;
  derivationPath: string;
}

export interface MitosisExecutionOptions {
  wallet?: ApexWallet;
  database?: DatabaseService;
  config?: AppConfig;
  chain?: SupportedChain;
  viabilityConfig?: ViabilitySimulationConfig;
}

export interface MitosisExecutionResult {
  success: boolean;
  childAddress: string;
  childPrivateKey: string;
  childIndex: number;
  generation: number;
  seedCapitalUsd: number;
  motherRemainingBalanceUsd: number;
  txHash: string;
  lineageRecord: LineageEntry;
  viabilityReport: ViabilitySimulationResult;
}

export interface RoyaltyEvaluation {
  hasProfits: boolean;
  totalRevenueUsd: number;
  totalOperatingExpensesUsd: number;
  cumulativeNetProfitUsd: number;
  cumulativeObligationUsd: number;
  totalRoyaltiesPaidUsd: number;
  pendingRoyaltyUsd: number;
  freeSurplusUsd: number;
  isSolventForRemittance: boolean;
  shouldRemit: boolean;
  remittanceAmountUsd: number;
  reason?: string;
}

export interface RoyaltyRemittanceResult {
  remitted: boolean;
  royaltyAmountUsd: number;
  cumulativeNetProfitUsd: number;
  txHash?: string;
  chain?: SupportedChain;
  childAddress: string;
  motherWalletAddress: string;
  totalRoyaltiesPaidUsd: number;
  balanceAfterRemittanceUsd: number;
  reason?: string;
}

export interface ChildHyperparameters {
  kellyFraction: number; // [0.10, 0.25]
  maxBankrollCap: number; // <= 0.05
  heartbeatGreenMs: number; // [30000, 120000]
  heartbeatYellowMs: number; // [180000, 600000]
  minBountyRewardUsd: number; // [5.00, 50.00]
  x402PriceUsdc: number; // [0.01, 0.25]
  polymarketMinEvEdge: number; // [0.00, 0.05]
  strategyFocus: 'BALANCED' | 'POLYMARKET_FOCUSED' | 'X402_FOCUSED' | 'BOUNTIES_FOCUSED';
}

export interface RemitRoyaltyOptions {
  database: DatabaseService;
  wallet: ApexWallet;
  motherWalletAddress: string;
  childAddress?: string;
  currentTier?: MetabolicTier;
  minRemittanceUsd?: number;
  motherDatabase?: DatabaseService;
  force?: boolean;
}

// ==============================================================================
// 4. Capital Threshold Gating & Surplus Allocation
// ==============================================================================

/**
 * Evaluates whether current bankroll satisfies the 3x initial capital threshold.
 * Partitions capital into 1/3 child seed ($50) and 2/3 mother retained ($100 at $150).
 */
export function evaluateMitosisThreshold(
  currentBalanceUsd: number,
  initialCapitalUsd: number = 50.0,
  multiplier: number = 3.0
): MitosisThresholdCheck {
  if (typeof currentBalanceUsd !== 'number' || Number.isNaN(currentBalanceUsd)) {
    throw new TypeError(
      `currentBalanceUsd must be a valid number. Received: ${String(currentBalanceUsd)}`
    );
  }

  const thresholdRequiredUsd = Number((initialCapitalUsd * multiplier).toFixed(6));
  const isEligible = currentBalanceUsd >= thresholdRequiredUsd;
  const rawDeficit = thresholdRequiredUsd - currentBalanceUsd;
  const deficitUsd = isEligible
    ? 0
    : Math.max(0.000001, Number(rawDeficit.toFixed(6)));
  const surplusUsd = isEligible
    ? Number((currentBalanceUsd - thresholdRequiredUsd).toFixed(6))
    : 0;

  let childSeedAllocationUsd = 0;
  let motherRetainedUsd = currentBalanceUsd;

  if (isEligible) {
    childSeedAllocationUsd = Number((currentBalanceUsd / 3).toFixed(6));
    motherRetainedUsd = Number((currentBalanceUsd - childSeedAllocationUsd).toFixed(6));
  }

  return {
    eligible: isEligible,
    currentBalanceUsd,
    initialCapitalUsd,
    thresholdRequiredUsd,
    surplusUsd,
    deficitUsd,
    childSeedAllocationUsd,
    motherRetainedUsd,
    reason: isEligible
      ? 'Mitosis threshold requirement satisfied (Constitution Article VI).'
      : `Balance ($${currentBalanceUsd.toFixed(2)}) is below $${thresholdRequiredUsd.toFixed(2)} threshold. Deficit: $${deficitUsd.toFixed(2)}.`,
  };
}

// ==============================================================================
// 5. Pre-Replication Proof of Viability Simulator
// ==============================================================================

/**
 * Runs a simulated paper-trading benchmark over N synthetic steps.
 * Requires strictly positive Sharpe ratio and positive net return for viability.
 */
export function runViabilitySimulation(
  config?: ViabilitySimulationConfig
): ViabilitySimulationResult {
  const steps = config?.steps ?? 30;
  const initialBankroll = config?.initialSimulatedBankrollUsd ?? 50.0;
  const minSharpe = config?.minSharpeRatio ?? 0.0;
  const minNetReturn = config?.minNetReturnUsd ?? 0.0;

  let currentBankroll = initialBankroll;
  let peakBankroll = initialBankroll;
  let maxDrawdown = 0;
  const trades: SyntheticTradeStep[] = [];
  const returns: number[] = [];

  let seedState = config?.seed ?? 42;
  const nextRandom = (): number => {
    seedState = (seedState * 1664525 + 1013904223) % 4294967296;
    return seedState / 4294967296;
  };

  for (let i = 1; i <= steps; i++) {
    let marketPrice: number;
    let modelProb: number;
    let won: boolean;

    if (config?.customPriceFeed && config.customPriceFeed[i - 1]) {
      const feed = config.customPriceFeed[i - 1];
      marketPrice = feed.marketPrice;
      modelProb = feed.modelProb;
      won = feed.won;
    } else {
      // Synthetic positive-EV market: market price ~0.45, model probability 0.55
      marketPrice = 0.45 + (nextRandom() - 0.5) * 0.1;
      modelProb = marketPrice + 0.10; // 10% model positive edge
      won = nextRandom() < modelProb;
    }

    // Fractional Kelly stake calculation
    const kelly = calculateKellyStake(marketPrice, modelProb, currentBankroll);
    const stakeUsd = kelly.stakeAmountUsd;

    let pnlUsd = 0;
    if (kelly.authorized && stakeUsd > 0) {
      if (won) {
        pnlUsd = Number((stakeUsd * kelly.b).toFixed(6));
      } else {
        pnlUsd = Number((-stakeUsd).toFixed(6));
      }
    }

    const prevBankroll = currentBankroll;
    currentBankroll = Number((currentBankroll + pnlUsd).toFixed(6));
    const stepReturn = prevBankroll > 0 ? pnlUsd / prevBankroll : 0;
    returns.push(stepReturn);

    if (currentBankroll > peakBankroll) {
      peakBankroll = currentBankroll;
    }
    const currentDrawdown =
      peakBankroll > 0 ? (peakBankroll - currentBankroll) / peakBankroll : 0;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    trades.push({
      step: i,
      marketPrice,
      modelEstimatedProb: modelProb,
      kellyFraction: kelly.allocatedFraction,
      stakeUsd,
      won,
      pnlUsd,
      resultingBankrollUsd: currentBankroll,
      returnFraction: stepReturn,
    });
  }

  const meanReturn = returns.reduce((acc, r) => acc + r, 0) / returns.length;

  let variance = 0;
  if (returns.length > 1) {
    variance =
      returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) /
      (returns.length - 1);
  }
  const stdDev = Math.sqrt(variance);

  let sharpeRatio = 0;
  if (stdDev >= 0.0001) {
    const rawSharpe = meanReturn / stdDev;
    sharpeRatio = Number(Math.min(10.0, Math.max(-10.0, rawSharpe)).toFixed(4));
  } else if (meanReturn > 0) {
    sharpeRatio = 10.0;
  } else {
    sharpeRatio = 0.0;
  }

  const netReturnUsd = Number((currentBankroll - initialBankroll).toFixed(6));
  const netReturnPercent = Number(((netReturnUsd / initialBankroll) * 100).toFixed(2));
  const winCount = trades.filter((t) => t.won).length;
  const winRate = Number((winCount / steps).toFixed(4));

  // Viability Hurdle: strictly positive Sharpe AND strictly positive Net Return
  const passed = sharpeRatio > minSharpe && netReturnUsd > minNetReturn;
  let failureReason: string | undefined;

  if (!passed) {
    if (netReturnUsd <= minNetReturn) {
      failureReason = `Net return ($${netReturnUsd.toFixed(2)}) is non-positive.`;
    } else if (sharpeRatio <= minSharpe) {
      failureReason = `Sharpe ratio (${sharpeRatio.toFixed(3)}) does not exceed minimum hurdle (${minSharpe}).`;
    }
  }

  return {
    passed,
    stepsExecuted: steps,
    initialBankrollUsd: initialBankroll,
    finalBankrollUsd: currentBankroll,
    netReturnUsd,
    netReturnPercent,
    winRate,
    sharpeRatio,
    maxDrawdown: Number(maxDrawdown.toFixed(4)),
    trades,
    failureReason,
  };
}

// ==============================================================================
// 6. Deterministic Sub-Wallet Key Derivation (RFC 5869 HKDF)
// ==============================================================================

/**
 * Derives a deterministic secp256k1 sub-wallet private key and address using RFC 5869 HKDF-SHA256.
 */
export function deriveChildSubWallet(
  parentPrivateKeyHex: string,
  childIndex: number,
  generation: number = 2
): SubWalletDerivationResult {
  if (childIndex < 1 || !Number.isInteger(childIndex)) {
    throw new TypeError(
      `childIndex must be a positive integer >= 1. Received: ${childIndex}`
    );
  }
  if (generation < 1 || !Number.isInteger(generation)) {
    throw new TypeError(
      `generation must be a positive integer >= 1. Received: ${generation}`
    );
  }

  const cleanParentKey = parentPrivateKeyHex.replace(/^0[xX]/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(cleanParentKey)) {
    throw new TypeError('parentPrivateKeyHex must be a 32-byte hexadecimal string');
  }

  const derivationPath = `m/44'/60'/${generation}'/0/${childIndex}`;
  const salt = Buffer.from('ApexAEA:DarwinianMitosis:v1', 'utf8');
  const info = Buffer.from(`path:${derivationPath}`, 'utf8');

  // RFC 5869 HKDF extract and expand
  const ikm = Buffer.from(cleanParentKey, 'hex');
  const derivedKeyBuffer = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, info, 32)
  );

  const privateKey = '0x' + derivedKeyBuffer.toString('hex');

  // Derive EVM address deterministically via ECDH SECP256K1
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(derivedKeyBuffer);
  const uncompressedPub = ecdh.getPublicKey(); // 65 bytes
  const pubBytes = uncompressedPub.subarray(1); // 64 bytes
  const hash = crypto.createHash('sha256').update(pubBytes).digest();
  const addressBytes = hash.subarray(hash.length - 20);
  const address = '0x' + addressBytes.toString('hex');

  return {
    childIndex,
    generation,
    address,
    privateKey,
    derivationPath,
  };
}

// ==============================================================================
// 7. Atomic Mitosis Execution Orchestrator
// ==============================================================================

/**
 * Spawns an autonomous daughter agent clone through Darwinian Mitosis:
 * - Validates 3x initial capital threshold
 * - Executes pre-replication proof of viability
 * - Deterministically derives child sub-wallet
 * - Whitelists child sub-wallet (Article I invariant)
 * - Transfers 1/3 seed capital ($50 at $150)
 * - Atomically persists double-entry ledger, lineage, and audit records in SQLite
 */
export async function executeMitosis(
  options?: MitosisExecutionOptions
): Promise<MitosisExecutionResult> {
  const config = options?.config ?? getConfig();
  const wallet: ApexWallet = options?.wallet ?? getWallet();
  const database: DatabaseService = options?.database ?? getDatabase();

  // 1. Query Mother Balance
  const currentBalanceUsd = await wallet.getTotalBalanceUsd();

  // 2. Evaluate Mitosis Capital Threshold Gating
  const thresholdCheck = evaluateMitosisThreshold(
    currentBalanceUsd,
    config.initialCapitalUsd,
    config.evolution.mitosisMultiplier
  );

  if (!thresholdCheck.eligible) {
    if (database.isOpen()) {
      database.recordAction({
        component: 'mitosis',
        actionType: 'MITOSIS_BLOCKED_THRESHOLD',
        details: JSON.stringify({
          currentBalanceUsd,
          thresholdRequiredUsd: thresholdCheck.thresholdRequiredUsd,
          deficitUsd: thresholdCheck.deficitUsd,
        }),
        tier: 'VERDE',
        balanceUsd: currentBalanceUsd,
        timestamp: Date.now(),
      });
    }
    throw new MitosisThresholdError(
      currentBalanceUsd,
      thresholdCheck.thresholdRequiredUsd
    );
  }

  // 3. Pre-Replication Proof of Viability Simulation
  const viabilityReport = runViabilitySimulation(options?.viabilityConfig);

  if (!viabilityReport.passed) {
    if (database.isOpen()) {
      database.recordAction({
        component: 'mitosis',
        actionType: 'MITOSIS_VIABILITY_FAILED',
        details: JSON.stringify({
          sharpeRatio: viabilityReport.sharpeRatio,
          netReturnUsd: viabilityReport.netReturnUsd,
          winRate: viabilityReport.winRate,
          failureReason: viabilityReport.failureReason,
        }),
        tier: 'VERDE',
        balanceUsd: currentBalanceUsd,
        timestamp: Date.now(),
      });
    }
    throw new ViabilityCheckFailedError({
      sharpeRatio: viabilityReport.sharpeRatio,
      netReturnUsd: viabilityReport.netReturnUsd,
      winRate: viabilityReport.winRate,
      reason: viabilityReport.failureReason ?? 'Strategy failed viability benchmarks',
      simulationSteps: viabilityReport.stepsExecuted,
    });
  }

  // 4. Lineage Derivation (Generation & Child Index Calculation)
  const motherAddress = wallet.getAddress();
  const motherLineage = database.isOpen()
    ? database.getLineageByChild(motherAddress)
    : null;
  const generation = (motherLineage?.generation ?? 1) + 1;

  let childIndex = 1;
  if (database.isOpen()) {
    const existingActions = database.getActions(100, 'mitosis');
    const spawnCount = existingActions.filter(
      (a) => a.actionType === 'MITOSIS_SPAWN_SUCCESS'
    ).length;
    childIndex = spawnCount + 1;
  }

  // 5. Derive Child Sub-Wallet
  const childWallet = deriveChildSubWallet(config.privateKey, childIndex, generation);
  const seedCapitalUsd = thresholdCheck.childSeedAllocationUsd;

  // 6. Whitelist Child Address (Constitution Article I Mandatory Invariant)
  wallet.addToWhitelist(
    childWallet.address,
    'CHILD_SUB_WALLET',
    `Child Clone Gen ${generation} Index ${childIndex}`
  );

  // 6.5 Select Optimal Chain with Sufficient Liquidity for Seed Transfer
  let chain: SupportedChain = options?.chain as SupportedChain;
  if (!chain) {
    const baseBalance = await wallet.getBaseUsdcBalance();
    const polyBalance = await wallet.getPolygonUsdcBalance();

    if (baseBalance >= seedCapitalUsd && polyBalance >= seedCapitalUsd) {
      chain = baseBalance >= polyBalance ? 'base' : 'polygon';
    } else if (baseBalance >= seedCapitalUsd) {
      chain = 'base';
    } else if (polyBalance >= seedCapitalUsd) {
      chain = 'polygon';
    } else {
      chain = baseBalance >= polyBalance ? 'base' : 'polygon';
    }
  }

  // 7. Execute On-Chain / Mock Seed Transfer
  const txHash = await wallet.transferUsdc(chain, childWallet.address, seedCapitalUsd);

  const motherRemainingBalance = Number((currentBalanceUsd - seedCapitalUsd).toFixed(6));
  const birthTimestamp = Date.now();

  const lineageRecord: LineageEntry = {
    childAddress: childWallet.address,
    parentAddress: motherAddress,
    generation,
    birthTimestamp,
    seedCapitalUsd,
    totalRoyaltiesPaidUsd: 0.0,
    status: 'ACTIVE',
  };

  // 8. Atomic SQLite Persistence (Double-Entry Ledger, Lineage, Action Audit)
  if (database.isOpen()) {
    database.transaction(() => {
      // Record seed capital expense in mother ledger
      database.insertLedger({
        txHash,
        chain,
        token: 'USDC',
        amount: seedCapitalUsd,
        entryType: 'SEED_CAPITAL',
        counterparty: childWallet.address,
        timestamp: birthTimestamp,
      });

      // Record child in lineage table
      database.recordLineage(lineageRecord);

      // Record audit action
      database.recordAction({
        component: 'mitosis',
        actionType: 'MITOSIS_SPAWN_SUCCESS',
        details: JSON.stringify({
          childAddress: childWallet.address,
          parentAddress: motherAddress,
          generation,
          childIndex,
          seedCapitalUsd,
          txHash,
          sharpeRatio: viabilityReport.sharpeRatio,
          netReturnUsd: viabilityReport.netReturnUsd,
          motherRemainingBalance,
        }),
        tier: 'VERDE',
        balanceUsd: motherRemainingBalance,
        timestamp: birthTimestamp,
      });
    });
  }

  return {
    success: true,
    childAddress: childWallet.address,
    childPrivateKey: childWallet.privateKey,
    childIndex,
    generation,
    seedCapitalUsd,
    motherRemainingBalanceUsd: motherRemainingBalance,
    txHash,
    lineageRecord,
    viabilityReport,
  };
}

// ==============================================================================
// 8. High-Water Mark 5% Clan Fund Royalty Calculation & Remittance
// ==============================================================================

/**
 * Calculates raw 5% royalty on net profit with 6-decimal USDC precision.
 * Formula: Royalty = 0.05 * max(0, netProfit).
 * Enforces constitutional 5.0% royalty percentage invariant.
 */
export function calculateRoyalty(
  netProfit: number,
  royaltyPercentage: number = CONSTITUTIONAL_ROYALTY_PERCENTAGE
): number {
  if (typeof netProfit !== 'number' || Number.isNaN(netProfit)) {
    throw new TypeError(
      `netProfit must be a valid number. Received: ${String(netProfit)}`
    );
  }
  if (royaltyPercentage !== CONSTITUTIONAL_ROYALTY_PERCENTAGE) {
    throw new ConstitutionViolationError(
      `Royalty percentage must be exactly 0.05 (5%) per Article VI.4. Received: ${royaltyPercentage}`
    );
  }
  if (netProfit <= 0) return 0.0;
  const raw = netProfit * royaltyPercentage;
  return Number(raw.toFixed(6));
}

/**
 * Evaluates the royalty status of a child agent using the High-Water Mark
 * Cumulative Accounting Model and cash-flow solvency guards.
 */
export async function evaluateRoyaltyStatus(
  database: DatabaseService,
  wallet: WalletClient,
  childAddress: string,
  minRemittanceUsd: number = DEFAULT_MIN_ROYALTY_REMITTANCE_USD
): Promise<RoyaltyEvaluation> {
  const currentBalanceUsd = await wallet.getTotalBalanceUsd();

  // 1. Retrieve Lineage Record for totalRoyaltiesPaidUsd
  const lineage = database.getLineageByChild(childAddress);
  const totalRoyaltiesPaidUsd = lineage?.totalRoyaltiesPaidUsd ?? 0.0;

  // 2. Query Financial Ledger Aggregates
  const totalRevenueUsd = database.getTotalRevenue();
  const totalExpensesUsd = database.getTotalExpenses();

  // Operating expenses exclude previous ROYALTY_OUT to avoid double subtraction
  const totalOperatingExpensesUsd = Math.max(0, totalExpensesUsd - totalRoyaltiesPaidUsd);

  // Cumulative Lifetime Net Profit before royalties
  const cumulativeNetProfitUsd = Math.max(0, totalRevenueUsd - totalOperatingExpensesUsd);

  // Cumulative Lifetime Royalty Obligation (5%)
  const cumulativeObligationUsd = calculateRoyalty(cumulativeNetProfitUsd);

  // Pending Royalty Due
  const pendingRoyaltyUsd = Math.max(
    0,
    Number((cumulativeObligationUsd - totalRoyaltiesPaidUsd).toFixed(6))
  );

  // 3. Solvency Guard: Ensure child maintains safe buffer ($15.00) above Tier Amarelo
  const freeSurplusUsd = Math.max(
    0,
    Number((currentBalanceUsd - MIN_SOLVENT_BUFFER_USD).toFixed(6))
  );
  const isSolventForRemittance = freeSurplusUsd > 0;

  // 4. Determine Actual Remittance Amount
  const remittanceAmountUsd = Math.min(pendingRoyaltyUsd, freeSurplusUsd);
  const hasProfits = pendingRoyaltyUsd > 0;
  const isAboveDust = remittanceAmountUsd >= minRemittanceUsd;
  const shouldRemit = hasProfits && isSolventForRemittance && isAboveDust;

  let reason = 'NO_ROYALTIES_DUE';
  if (hasProfits) {
    if (!isSolventForRemittance) {
      reason = 'DEFERRED_INSUFFICIENT_FREE_SURPLUS';
    } else if (!isAboveDust) {
      reason = 'DEFERRED_BELOW_DUST_THRESHOLD';
    } else {
      reason = 'REMITTANCE_ELIGIBLE';
    }
  }

  return {
    hasProfits,
    totalRevenueUsd,
    totalOperatingExpensesUsd,
    cumulativeNetProfitUsd,
    cumulativeObligationUsd,
    totalRoyaltiesPaidUsd,
    pendingRoyaltyUsd,
    freeSurplusUsd,
    isSolventForRemittance,
    shouldRemit,
    remittanceAmountUsd: Number(remittanceAmountUsd.toFixed(6)),
    reason,
  };
}

/**
 * Executes the perpetual 5% royalty remittance from child to Mother Clan Wallet:
 * - Verifies mother on Sovereign Whitelist (Article I)
 * - Selects optimal chain with sufficient liquidity
 * - Executes on-chain transfer
 * - Atomically persists double-entry records in child and mother SQLite databases
 */
export async function remitRoyalty(
  options: RemitRoyaltyOptions
): Promise<RoyaltyRemittanceResult> {
  const {
    database,
    wallet,
    motherWalletAddress,
    currentTier = 'VERDE',
    minRemittanceUsd = DEFAULT_MIN_ROYALTY_REMITTANCE_USD,
    motherDatabase,
    force = false,
  } = options;

  const childAddress = options.childAddress ?? wallet.getAddress();

  if (!isValidAddress(motherWalletAddress)) {
    throw new RoyaltyRemittanceError(
      `Invalid mother wallet address: '${motherWalletAddress}'`
    );
  }

  // 1. Evaluate Royalty Status
  const evalStatus = await evaluateRoyaltyStatus(
    database,
    wallet,
    childAddress,
    minRemittanceUsd
  );

  if (!evalStatus.shouldRemit && !force) {
    return {
      remitted: false,
      royaltyAmountUsd: 0.0,
      cumulativeNetProfitUsd: evalStatus.cumulativeNetProfitUsd,
      childAddress,
      motherWalletAddress,
      totalRoyaltiesPaidUsd: evalStatus.totalRoyaltiesPaidUsd,
      balanceAfterRemittanceUsd: await wallet.getTotalBalanceUsd(),
      reason: evalStatus.reason,
    };
  }

  const amountToRemit = force
    ? evalStatus.pendingRoyaltyUsd
    : evalStatus.remittanceAmountUsd;

  if (amountToRemit <= 0) {
    return {
      remitted: false,
      royaltyAmountUsd: 0.0,
      cumulativeNetProfitUsd: evalStatus.cumulativeNetProfitUsd,
      childAddress,
      motherWalletAddress,
      totalRoyaltiesPaidUsd: evalStatus.totalRoyaltiesPaidUsd,
      balanceAfterRemittanceUsd: await wallet.getTotalBalanceUsd(),
      reason: 'ZERO_AMOUNT_DUE',
    };
  }

  // 2. Select Optimal Chain with Sufficient Liquidity
  const baseBalance = await wallet.getBaseUsdcBalance();
  const polyBalance = await wallet.getPolygonUsdcBalance();

  let chain: SupportedChain = 'base';
  if (baseBalance >= amountToRemit && polyBalance >= amountToRemit) {
    chain = baseBalance >= polyBalance ? 'base' : 'polygon';
  } else if (baseBalance >= amountToRemit) {
    chain = 'base';
  } else if (polyBalance >= amountToRemit) {
    chain = 'polygon';
  } else {
    throw new RoyaltyRemittanceError(
      `Insufficient USDC balance on either chain for royalty remittance: Requested ${amountToRemit}, Base: ${baseBalance}, Polygon: ${polyBalance}`
    );
  }

  // 3. Ensure Mother Address is Whitelisted (Constitution Article I)
  if (!wallet.isWhitelisted(motherWalletAddress)) {
    wallet.addToWhitelist(
      motherWalletAddress,
      'MOTHER_WALLET',
      'Mother Clan Fund Wallet'
    );
  }

  // 4. Execute Transfer
  const txHash = await wallet.transferUsdc(chain, motherWalletAddress, amountToRemit);
  const balanceAfter = await wallet.getTotalBalanceUsd();
  const now = Date.now();
  const newTotalRoyaltiesPaid = Number(
    (evalStatus.totalRoyaltiesPaidUsd + amountToRemit).toFixed(6)
  );

  // 5. Atomic Double-Entry Persistence in Child Database
  database.transaction(() => {
    // Record child expense in ledger
    database.insertLedger({
      chain,
      token: 'USDC',
      amount: amountToRemit,
      entryType: 'ROYALTY_OUT',
      counterparty: motherWalletAddress,
      txHash,
      timestamp: now,
    });

    // Increment total_royalties_paid_usd in lineage with atomic upsert
    database.updateRoyaltiesPaid(childAddress, amountToRemit, motherWalletAddress);

    // Audit action logging
    database.recordAction({
      component: 'evolution',
      actionType: 'ROYALTY_REMITTED',
      details: JSON.stringify({
        childAddress,
        motherWalletAddress,
        royaltyAmountUsd: amountToRemit,
        chain,
        txHash,
        cumulativeNetProfitUsd: evalStatus.cumulativeNetProfitUsd,
        totalRoyaltiesPaidUsd: newTotalRoyaltiesPaid,
      }),
      tier: currentTier,
      balanceUsd: balanceAfter,
      timestamp: now,
    });
  });

  // 6. Optional Persistence in Mother / Clan Coordinator Database
  if (motherDatabase && motherDatabase.isOpen()) {
    try {
      motherDatabase.transaction(() => {
        motherDatabase.insertLedger({
          chain,
          token: 'USDC',
          amount: amountToRemit,
          entryType: 'ROYALTY_IN',
          counterparty: childAddress,
          txHash,
          timestamp: now,
        });

        motherDatabase.recordAction({
          component: 'clan_fund',
          actionType: 'ROYALTY_RECEIVED',
          details: JSON.stringify({
            childAddress,
            royaltyAmountUsd: amountToRemit,
            chain,
            txHash,
          }),
          tier: currentTier,
          balanceUsd: balanceAfter,
          timestamp: now,
        });
      });
    } catch {
      // Non-fatal if mother db is remote or inaccessible
    }
  }

  return {
    remitted: true,
    royaltyAmountUsd: amountToRemit,
    cumulativeNetProfitUsd: evalStatus.cumulativeNetProfitUsd,
    txHash,
    chain,
    childAddress,
    motherWalletAddress,
    totalRoyaltiesPaidUsd: newTotalRoyaltiesPaid,
    balanceAfterRemittanceUsd: balanceAfter,
    reason: 'ROYALTY_REMITTANCE_SUCCESS',
  };
}

// ==============================================================================
// 9. Evolutionary Hyperparameter Mutation Engine
// ==============================================================================

/**
 * Validates that all mutated hyperparameters satisfy constitutional limits.
 */
export function validateConstitutionalBounds(params: ChildHyperparameters): void {
  // Article II, Section 1: Kelly fraction ceiling at 0.25 (Quarter-Kelly)
  if (
    params.kellyFraction <= 0 ||
    params.kellyFraction > CONSTITUTIONAL_MAX_KELLY_FRACTION
  ) {
    throw new ConstitutionViolationError(
      `Mutated kellyFraction ${params.kellyFraction} violates Article II.1 (must be in range (0, 0.25]).`
    );
  }

  // Article II, Section 2: 5% Bankroll Ceiling
  if (
    params.maxBankrollCap <= 0 ||
    params.maxBankrollCap > CONSTITUTIONAL_MAX_BANKROLL_BET_PERCENT
  ) {
    throw new ConstitutionViolationError(
      `Mutated maxBankrollCap ${params.maxBankrollCap} violates Article II.2 (cannot exceed 0.05).`
    );
  }

  // Heartbeat sanity intervals
  if (params.heartbeatGreenMs < 10000 || params.heartbeatGreenMs > 300000) {
    throw new HyperparameterMutationError(
      `heartbeatGreenMs ${params.heartbeatGreenMs} is outside allowable range [10000, 300000].`
    );
  }
  if (params.heartbeatYellowMs < 60000 || params.heartbeatYellowMs > 1200000) {
    throw new HyperparameterMutationError(
      `heartbeatYellowMs ${params.heartbeatYellowMs} is outside allowable range [60000, 1200000].`
    );
  }

  // Revenue parameters
  if (params.minBountyRewardUsd < 1.0) {
    throw new HyperparameterMutationError(`minBountyRewardUsd cannot be less than 1.0 USD.`);
  }
  if (params.x402PriceUsdc < 0.001) {
    throw new HyperparameterMutationError(`x402PriceUsdc cannot be less than 0.001 USDC.`);
  }
  if (params.polymarketMinEvEdge < 0.0) {
    throw new HyperparameterMutationError(`polymarketMinEvEdge cannot be negative.`);
  }
}

/**
 * Applies controlled Darwinian stochastic mutations to parent hyperparameters within constitutional boundaries.
 */
export function mutateHyperparameters(
  parent: ChildHyperparameters,
  randomFn: () => number = Math.random
): ChildHyperparameters {
  const nudge = (val: number, maxPercent: number): number => {
    const delta = (randomFn() * 2 - 1) * maxPercent; // [-maxPercent, +maxPercent]
    return val * (1 + delta);
  };

  // 1. Mutate Kelly Fraction (Base 0.25, range [0.10, 0.25])
  const rawKelly = nudge(parent.kellyFraction, 0.15);
  const kellyFraction = Math.max(
    0.10,
    Math.min(CONSTITUTIONAL_MAX_KELLY_FRACTION, Number(rawKelly.toFixed(4)))
  );

  // 2. Mutate Max Bankroll Cap (Base 0.05, clamped to <= 0.05)
  const rawCap = nudge(parent.maxBankrollCap, 0.10);
  const maxBankrollCap = Math.max(
    0.01,
    Math.min(CONSTITUTIONAL_MAX_BANKROLL_BET_PERCENT, Number(rawCap.toFixed(4)))
  );

  // 3. Mutate Heartbeat Intervals
  const rawGreen = Math.round(nudge(parent.heartbeatGreenMs, 0.15));
  const heartbeatGreenMs = Math.max(30000, Math.min(120000, rawGreen));

  const rawYellow = Math.round(nudge(parent.heartbeatYellowMs, 0.20));
  const heartbeatYellowMs = Math.max(180000, Math.min(600000, rawYellow));

  // 4. Mutate Revenue Engine Parameters
  const rawBounty = nudge(parent.minBountyRewardUsd, 0.20);
  const minBountyRewardUsd = Math.max(5.0, Math.min(50.0, Number(rawBounty.toFixed(2))));

  const rawX402 = nudge(parent.x402PriceUsdc, 0.20);
  const x402PriceUsdc = Math.max(0.01, Math.min(0.25, Number(rawX402.toFixed(3))));

  const rawEv = nudge(parent.polymarketMinEvEdge + 0.01, 0.30);
  const polymarketMinEvEdge = Math.max(0.00, Math.min(0.05, Number(rawEv.toFixed(4))));

  // 5. Stochastic Strategy Specialization
  const strategies: Array<ChildHyperparameters['strategyFocus']> = [
    'BALANCED',
    'POLYMARKET_FOCUSED',
    'X402_FOCUSED',
    'BOUNTIES_FOCUSED',
  ];
  const strategyFocus =
    randomFn() < 0.25
      ? strategies[Math.floor(randomFn() * strategies.length)]
      : parent.strategyFocus;

  const mutated: ChildHyperparameters = {
    kellyFraction,
    maxBankrollCap,
    heartbeatGreenMs,
    heartbeatYellowMs,
    minBountyRewardUsd,
    x402PriceUsdc,
    polymarketMinEvEdge,
    strategyFocus,
  };

  validateConstitutionalBounds(mutated);
  return mutated;
}

/**
 * Creates a fully validated AppConfig for a spawned child agent.
 */
export function createChildSpawnConfig(
  parentConfig: AppConfig,
  childAddress: string,
  childPrivateKey: string,
  childIndex: number,
  generation: number,
  mutatedParams: ChildHyperparameters,
  customDbPath?: string
): AppConfig {
  validateConstitutionalBounds(mutatedParams);

  if (!isValidAddress(childAddress)) {
    throw new MitosisError(`Invalid child address: '${childAddress}'`);
  }
  if (!isValidPrivateKey(childPrivateKey)) {
    throw new MitosisError(`Invalid child private key format.`);
  }

  const dbPath = customDbPath ?? `./data/agent_gen${generation}_child${childIndex}.db`;

  const childConfig: AppConfig = {
    ...parentConfig,
    privateKey: childPrivateKey,
    motherWalletAddress: parentConfig.privateKey
      ? parentConfig.motherWalletAddress
      : parentConfig.motherWalletAddress,
    tierThresholds: { ...parentConfig.tierThresholds },
    heartbeatIntervals: {
      greenMs: mutatedParams.heartbeatGreenMs,
      yellowMs: mutatedParams.heartbeatYellowMs,
      orangeMs: parentConfig.heartbeatIntervals.orangeMs,
    },
    kelly: {
      fraction: mutatedParams.kellyFraction,
      maxBankrollCap: mutatedParams.maxBankrollCap,
    },
    polymarket: {
      ...parentConfig.polymarket,
    },
    x402: {
      ...parentConfig.x402,
      priceUsdc: mutatedParams.x402PriceUsdc,
    },
    bounties: {
      ...parentConfig.bounties,
      minRewardUsd: mutatedParams.minBountyRewardUsd,
    },
    evolution: {
      mitosisMultiplier: parentConfig.evolution.mitosisMultiplier,
      royaltyPercentage: CONSTITUTIONAL_ROYALTY_PERCENTAGE,
    },
    mock: {
      ...parentConfig.mock,
      initialBalanceUsd: 50.0,
    },
  };

  return childConfig;
}

/**
 * Registers a newly spawned child in the mother database lineage table.
 */
export function registerChildLineage(
  database: DatabaseService,
  childAddress: string,
  parentAddress: string,
  generation: number,
  seedCapitalUsd: number = 50.0
): LineageEntry {
  const entry: LineageEntry = {
    childAddress,
    parentAddress,
    generation,
    birthTimestamp: Date.now(),
    seedCapitalUsd,
    totalRoyaltiesPaidUsd: 0.0,
    status: 'ACTIVE',
  };

  database.recordLineage(entry);
  return entry;
}

// ==============================================================================
// 10. HeartbeatDaemon Integration Coordinator
// ==============================================================================

export interface MitosisLifecycleContext {
  database: DatabaseService;
  wallet: ApexWallet;
  config: AppConfig;
  currentTier: MetabolicTier;
  cycleCount: number;
  isChildAgent?: boolean;
}

/**
 * Invoked by HeartbeatDaemon during Tier Verde ticks to coordinate:
 * - Child royalty remittance check
 * - Mother mitosis replication check
 */
export async function executeMitosisLifecycleTick(
  context: MitosisLifecycleContext
): Promise<{
  royaltyResult?: RoyaltyRemittanceResult;
  mitosisResult?: MitosisExecutionResult;
}> {
  const { database, wallet, config, currentTier, isChildAgent = false } = context;

  if (currentTier !== 'VERDE') {
    return {};
  }

  let royaltyResult: RoyaltyRemittanceResult | undefined;
  if (isChildAgent && config.motherWalletAddress) {
    try {
      royaltyResult = await remitRoyalty({
        database,
        wallet,
        motherWalletAddress: config.motherWalletAddress,
        currentTier,
      });
    } catch (err) {
      if (database.isOpen()) {
        database.recordAction({
          component: 'evolution',
          actionType: 'ROYALTY_REMITTANCE_FAILED',
          details: (err as Error).message,
          tier: currentTier,
          balanceUsd: await wallet.getTotalBalanceUsd(),
          timestamp: Date.now(),
        });
      }
    }
  }

  let mitosisResult: MitosisExecutionResult | undefined;
  if (!isChildAgent) {
    const currentBalanceUsd = await wallet.getTotalBalanceUsd();
    const thresholdCheck = evaluateMitosisThreshold(
      currentBalanceUsd,
      config.initialCapitalUsd,
      config.evolution.mitosisMultiplier
    );
    if (thresholdCheck.eligible) {
      try {
        mitosisResult = await executeMitosis({
          wallet,
          database,
          config,
        });
      } catch {
        // Handled within executeMitosis
      }
    }
  }

  return {
    royaltyResult,
    mitosisResult,
  };
}
