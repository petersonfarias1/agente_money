/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Canonical Domain Types & Contracts
 * ==============================================================================
 * Authoritative type definitions for Milestone 1 and system-wide modules:
 * - Governance, Invariants & Constitution
 * - Metabolic Engine & Energy Tiers
 * - Financial Ledger, Audit Actions & Lineage
 * - Polymarket & Kelly Criterion Risk Management
 * - x402 Micropayments & Bounties
 * - Permadeath & Tombstone Snapshot
 * - Immune System Sandbox & Git Self-Healing
 * - Darwinian Mitosis & Clan Royalties
 * - Configuration & Multi-Network Switching
 */

// ==============================================================================
// 1. Core Enums & Primitive Unions
// ==============================================================================

export type NetworkMode = 'mock' | 'testnet' | 'mainnet';

export type SupportedChain = 'base' | 'polygon';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type MetabolicTier = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO';

export type ModelClass = 'advanced' | 'economic' | 'survival';

export type InferenceMode = 'free' | 'paid';

export type InferenceProviderType = 'ollama' | 'openai';

export type LedgerEntryType =
  | 'INCOME_X402'
  | 'INCOME_POLYMARKET'
  | 'INCOME_BOUNTY'
  | 'EXPENSE_GAS'
  | 'EXPENSE_LLM'
  | 'ROYALTY_IN'
  | 'ROYALTY_OUT'
  | 'SEED_CAPITAL';

export type ActionStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export type LineageStatus = 'ACTIVE' | 'INSOLVENT';

export type OrderOutcome = 'YES' | 'NO';

export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type PositionStatus = 'OPEN' | 'WON' | 'LOST' | 'CANCELLED';

// ==============================================================================
// 2. Configuration & Network Interfaces
// ==============================================================================

export interface NetworkConfig {
  baseRpcUrl: string;
  polygonRpcUrl: string;
  baseUsdcAddress: string;
  polygonUsdcAddress: string;
  isMock: boolean;
}

export interface InferenceProviderConfig {
  id: string;
  type: InferenceProviderType;
  baseUrl: string;
  apiKey?: string;
  model: string;
  free: boolean;
}

export interface InferenceConfig {
  mode: InferenceMode;
  capPerTick: number;
  providers: InferenceProviderConfig[];
}

export interface AppConfig {
  nodeEnv: string;
  logLevel: LogLevel;
  networkMode: NetworkMode;
  network: NetworkConfig;
  privateKey: string;
  motherWalletAddress: string;
  initialCapitalUsd: number;
  tierThresholds: {
    green: number;
    yellow: number;
    orange: number;
    red: number;
  };
  heartbeatIntervals: {
    greenMs: number;
    yellowMs: number;
    orangeMs: number;
  };
  kelly: {
    fraction: number;
    maxBankrollCap: number;
  };
  polymarket: {
    clobApiUrl: string;
    apiKey?: string;
    apiSecret?: string;
    apiPassphrase?: string;
  };
  x402: {
    port: number;
    priceUsdc: number;
    settlementChain: SupportedChain;
  };
  bounties: {
    githubToken?: string;
    minRewardUsd: number;
  };
  evolution: {
    mitosisMultiplier: number;
    royaltyPercentage: number;
  };
  inference: InferenceConfig;
  mock: {
    useMockApis: boolean;
    initialBalanceUsd: number;
    simulateErrors: boolean;
  };
}

// ==============================================================================
// 3. Wallet & Blockchain Interfaces
// ==============================================================================

export interface WalletBalance {
  baseUsdc: number;
  polygonUsdc: number;
  totalUsd: number;
  baseEth?: number;
  polygonPol?: number;
  timestamp: number;
}

export interface WalletClient {
  getAddress(): string;
  getBaseUsdcBalance(): Promise<number>;
  getPolygonUsdcBalance(): Promise<number>;
  getTotalBalanceUsd(): Promise<number>;
  transferUsdc(chain: SupportedChain, recipient: string, amount: number): Promise<string>;
}

export interface TransferResult {
  txHash: string;
  chain: SupportedChain;
  amount: number;
  recipient: string;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

// ==============================================================================
// 4. Metabolic Engine Interfaces
// ==============================================================================

export interface TierStatus {
  tier: MetabolicTier;
  balanceUsd: number;
  heartbeatIntervalMs: number;
  allowSpeculativeResearch: boolean;
  allowSelfModification: boolean;
  modelClass: ModelClass;
  reason?: string;
}

// ==============================================================================
// 5. Database & Persistence Interfaces
// ==============================================================================

export interface LedgerEntry {
  id?: number;
  txHash?: string;
  chain: SupportedChain;
  token: string;
  amount: number;
  entryType: LedgerEntryType;
  counterparty?: string;
  timestamp: number;
}

export interface ActionEntry {
  id?: number;
  component: string;
  actionType: string;
  details: string;
  tier: string;
  balanceUsd: number;
  timestamp: number;
}

export interface LineageEntry {
  childAddress: string;
  parentAddress: string;
  generation: number;
  birthTimestamp: number;
  seedCapitalUsd: number;
  totalRoyaltiesPaidUsd: number;
  status: LineageStatus;
}

// ==============================================================================
// 6. Risk Management & Polymarket Interfaces
// ==============================================================================

export interface KellyCalculation {
  authorized: boolean;
  b: number; // net odds: (1 - Pm) / Pm = (Payout / Stake) - 1
  p: number; // estimated true probability
  q: number; // 1 - p
  expectedValue: number; // b * p - q
  rawKellyFraction: number; // (b * p - q) / b
  quarterKellyFraction: number; // 0.25 * rawKellyFraction
  allocatedFraction: number; // min(quarterKellyFraction, 0.05) clamped
  stakeAmountUsd: number; // allocatedFraction * totalBankroll
  rejectionReason?: string;
}

export interface PolymarketMarket {
  id: string;
  conditionId: string;
  question: string;
  slug?: string;
  outcomes: [string, string] | string[];
  outcomePrices: [number, number] | number[];
  impliedProbability: number;
  liquidityUsd: number;
  volume24hUsd: number;
  endDate?: string;
  active: boolean;
  closed: boolean;
}

export interface PolymarketOrder {
  orderId?: string;
  marketId: string;
  conditionId: string;
  outcome: OrderOutcome;
  side: OrderSide;
  price: number;
  size: number;
  stakeUsd: number;
  status: OrderStatus;
  txHash?: string;
  timestamp: number;
}

export interface PolymarketPosition {
  id?: number;
  marketId: string;
  conditionId?: string;
  question: string;
  outcome: OrderOutcome;
  odds: number;
  estimatedProb: number;
  quarterKellyFraction: number;
  stakeUsd: number;
  status: PositionStatus;
  payoutUsd?: number;
  openedAt: string;
  resolvedAt?: string;
}

// ==============================================================================
// 7. x402 Micropayments & Bounties Interfaces
// ==============================================================================

export interface X402PaymentRequest {
  endpoint: string;
  priceUsdc: number;
  recipientAddress: string;
  chain: SupportedChain;
  tokenAddress: string;
  nonce: string;
  description: string;
}

export interface X402VerificationResult {
  verified: boolean;
  payerAddress?: string;
  txHash?: string;
  amountUsdc?: number;
  error?: string;
}

export interface BountyTask {
  id: string;
  platform: 'github' | 'algora' | 'gitcoin';
  url: string;
  title: string;
  description: string;
  rewardUsd: number;
  difficulty: 'micro' | 'easy' | 'medium' | 'hard';
  tags: string[];
  status: 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
}

export interface BountySubmission {
  bountyId: string;
  prUrl: string;
  branchName: string;
  submittedAt: number;
  rewardClaimed: boolean;
}

// ==============================================================================
// 8. Permadeath & Tombstone Interfaces
// ==============================================================================

export interface Tombstone {
  agentAddress: string;
  agentName?: string;
  generation?: number;
  parentId?: string | null;
  deathTimestamp: string;
  birthTimestamp?: string;
  finalBalanceUsd: number;
  peakBalanceUsd?: number;
  totalLifespanMs: number;
  totalCyclesExecuted: number;
  totalRevenueGenerated: number;
  totalExpensesIncurred: number;
  finalLedgerSnapshot: LedgerEntry[];
  reason: string;
  operationalSummary?: {
    polymarketBetsCount: number;
    polymarketWinRate: number;
    x402RequestsServed: number;
    bountiesCompleted: number;
  };
  postMortemInsights?: string[];
}

// ==============================================================================
// 9. Immune System & Evolution Interfaces
// ==============================================================================

export interface ImmuneCheckResult {
  passed: boolean;
  output: string;
  exitCode?: number;
  durationMs?: number;
  error?: string;
}

export interface MitosisEvaluation {
  canReproduce: boolean;
  currentBalance: number;
  initialBalance: number;
  thresholdRequired: number; // 3 * initialBalance
  paperTradingPassed: boolean;
  paperTradingWinRate?: number;
  reason?: string;
}

export interface SpawnedChild {
  address: string;
  privateKey: string;
  childIndex: number;
  seedCapitalUsd: number;
  generation: number;
}

// ==============================================================================
// 10. Canonical Domain Error Classes
// ==============================================================================

export class ConstitutionViolationError extends Error {
  constructor(message: string) {
    super(`[CONSTITUTION VIOLATION] ${message}`);
    this.name = 'ConstitutionViolationError';
  }
}

export class InsolvencyError extends Error {
  constructor(message: string = 'Agent has reached zero balance and is insolvent') {
    super(`[INSOLVENCY] ${message}`);
    this.name = 'InsolvencyError';
  }
}

export class KellyRiskError extends Error {
  constructor(message: string) {
    super(`[KELLY RISK] ${message}`);
    this.name = 'KellyRiskError';
  }
}

export class ImmuneCheckError extends Error {
  constructor(message: string) {
    super(`[IMMUNE CHECK] ${message}`);
    this.name = 'ImmuneCheckError';
  }
}

export class MitosisError extends Error {
  constructor(message: string) {
    super(`[MITOSIS] ${message}`);
    this.name = 'MitosisError';
  }
}
