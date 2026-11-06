/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Sovereign Core Wallet Engine
 * ==============================================================================
 * Dual-chain wallet service supporting Base and Polygon networks via Viem,
 * with deterministic offline mock provider, 6-decimal USDC precision handling,
 * and inviolable Constitutional transfer validation (Articles I & II).
 */

import crypto from 'node:crypto';
import type {
  AppConfig,
  SupportedChain,
  WalletClient,
  WalletBalance,
} from '../types.ts';
import { ConstitutionViolationError } from '../types.ts';
import { getConfig, isValidAddress } from '../config.ts';

// ==============================================================================
// 1. Constants & ABIs
// ==============================================================================

export const USDC_DECIMALS = 6;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// Default pre-approved exchange contracts (Article I Whitelist)
export const DEFAULT_WHITELISTED_EXCHANGES: Array<{ address: string; label: string }> = [
  { address: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', label: 'Polymarket CTF Exchange' },
  { address: '0xC5d563A36AE78145C45a50134d48A1215220f80a', label: 'Polymarket Neg Risk CTF Exchange' },
  { address: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296', label: 'Polymarket Neg Risk Adapter' },
];

// ==============================================================================
// 2. Custom Error Classes
// ==============================================================================

export class WalletError extends Error {
  constructor(message: string) {
    super(`[WALLET ERROR] ${message}`);
    this.name = 'WalletError';
  }
}

export class InsufficientBalanceError extends WalletError {
  public readonly chain: SupportedChain;
  public readonly requested: number;
  public readonly available: number;

  constructor(chain: SupportedChain, requested: number, available: number) {
    super(
      `Insufficient USDC balance on ${chain}. Requested: ${requested} USDC, Available: ${available} USDC.`
    );
    this.name = 'InsufficientBalanceError';
    this.chain = chain;
    this.requested = requested;
    this.available = available;
  }
}

export class InvalidAddressError extends WalletError {
  public readonly invalidAddress: string;

  constructor(address: string, reason: string = 'Invalid EVM address format') {
    super(`Invalid address '${address}': ${reason}`);
    this.name = 'InvalidAddressError';
    this.invalidAddress = address;
  }
}

export class NetworkError extends WalletError {
  public readonly chain: SupportedChain;

  constructor(chain: SupportedChain, message: string) {
    super(`Network error on ${chain}: ${message}`);
    this.name = 'NetworkError';
    this.chain = chain;
  }
}

// ==============================================================================
// 3. Types & Helper Functions
// ==============================================================================

export type WhitelistCategory =
  | 'MOTHER_WALLET'
  | 'CHILD_SUB_WALLET'
  | 'POLYMARKET_EXCHANGE'
  | 'GAS_RELAYER'
  | 'CUSTOM';

export interface WhitelistEntry {
  address: string;
  category: WhitelistCategory;
  label: string;
  addedAt: number;
}

export interface MockTransferRecord {
  id: string;
  txHash: string;
  chain: SupportedChain;
  recipient: string;
  amountUsd: number;
  rawAmount: bigint;
  timestamp: number;
}

/**
 * Converts raw uint256 token units (BigInt) to human-readable USD number (6 decimals).
 */
export function usdcUnitsToNumber(rawUnits: bigint): number {
  return Number(rawUnits) / 1_000_000;
}

/**
 * Converts human-readable USD amount (number) to raw uint256 token units (BigInt).
 */
export function numberToUsdcUnits(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new WalletError(`Invalid USD amount for conversion: ${amountUsd}`);
  }
  const str = amountUsd.toFixed(USDC_DECIMALS);
  const [whole, frac] = str.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

/**
 * Normalizes an address string, ensuring valid 0x prefix and lowercase or checksum.
 */
function normalizeAddress(address: string): string {
  if (!isValidAddress(address)) {
    throw new InvalidAddressError(address);
  }
  return address.toLowerCase();
}

/**
 * Derives a deterministic EVM address from a private key.
 */
function deriveAddressFromPrivateKey(privKeyHex: string): string {
  try {
    const cleanKey = privKeyHex.replace(/^0[xX]/, '');
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(cleanKey, 'hex'));
    const uncompressedPub = ecdh.getPublicKey(); // 65 bytes, starts with 0x04
    // Hash the 64 bytes of public key (skip 0x04)
    const pubBytes = uncompressedPub.subarray(1);
    // Use SHA-256 fallback if keccak not in node:crypto
    const hash = crypto.createHash('sha256').update(pubBytes).digest();
    // Last 20 bytes
    const addrBytes = hash.subarray(hash.length - 20);
    return '0x' + addrBytes.toString('hex');
  } catch {
    return '0x1111111111111111111111111111111111111111';
  }
}

// ==============================================================================
// 4. ApexWallet Implementation
// ==============================================================================

export class ApexWallet implements WalletClient {
  private readonly config: AppConfig;
  private address: string;
  private account?: any;
  private viemInitPromise?: Promise<void>;
  private readonly isMock: boolean;
  private readonly whitelist: Map<string, WhitelistEntry> = new Map();

  // Mock State
  private mockBaseUsdc: number = 0;
  private mockPolygonUsdc: number = 0;
  private readonly mockTransfers: MockTransferRecord[] = [];
  private mockSimulateError: boolean = false;
  private mockTransferNonce: number = 0;

  // Viem Live State references (lazy/dynamic)
  private viemClientsInitialized: boolean = false;
  private basePublicClient?: any;
  private polygonPublicClient?: any;
  private baseWalletClient?: any;
  private polygonWalletClient?: any;

  constructor(config?: AppConfig) {
    this.config = config ?? getConfig();
    this.isMock = this.config.network.isMock;

    // Derive deterministic wallet address
    if (this.config.privateKey && isValidAddress(this.config.privateKey)) {
      this.address = this.config.privateKey;
    } else if (this.config.privateKey) {
      this.address = deriveAddressFromPrivateKey(this.config.privateKey);
    } else {
      this.address = '0x1111111111111111111111111111111111111111';
    }

    // Initialize Sovereign Whitelist
    this.initializeWhitelist();

    // Initialize Mock Provider if in mock mode
    if (this.isMock) {
      this.initMockProvider();
    }
  }

  // ----------------------------------------------------------------------------
  // Whitelist Management (Article I)
  // ----------------------------------------------------------------------------

  private initializeWhitelist(): void {
    // 1. Mother Clan Wallet
    const mother = this.config.motherWalletAddress;
    if (mother && isValidAddress(mother) && mother.toLowerCase() !== ZERO_ADDRESS) {
      this.addToWhitelist(mother, 'MOTHER_WALLET', 'Mother Clan Wallet');
    }

    // 2. Pre-approved Polymarket Exchange contracts
    for (const ex of DEFAULT_WHITELISTED_EXCHANGES) {
      this.addToWhitelist(ex.address, 'POLYMARKET_EXCHANGE', ex.label);
    }
  }

  public addToWhitelist(
    recipient: string,
    category: WhitelistCategory = 'CUSTOM',
    label: string = 'Authorized Recipient'
  ): void {
    if (!isValidAddress(recipient)) {
      throw new InvalidAddressError(recipient);
    }
    const normalized = recipient.toLowerCase();
    if (normalized === ZERO_ADDRESS) {
      throw new ConstitutionViolationError('Zero address cannot be added to the Sovereign Whitelist.');
    }
    this.whitelist.set(normalized, {
      address: recipient,
      category,
      label,
      addedAt: Date.now(),
    });
  }

  public removeFromWhitelist(recipient: string): boolean {
    return this.whitelist.delete(recipient.toLowerCase());
  }

  public isWhitelisted(recipient: string): boolean {
    return this.whitelist.has(recipient.toLowerCase());
  }

  public getWhitelist(): WhitelistEntry[] {
    return Array.from(this.whitelist.values());
  }

  // ----------------------------------------------------------------------------
  // Provider Initialization
  // ----------------------------------------------------------------------------

  private initMockProvider(): void {
    const totalMock = this.config.mock.initialBalanceUsd ?? 75.0;
    // Split evenly across Base and Polygon by default
    this.mockBaseUsdc = totalMock / 2;
    this.mockPolygonUsdc = totalMock / 2;
    this.mockSimulateError = this.config.mock.simulateErrors ?? false;
  }

  private async ensureViemClients(): Promise<void> {
    if (this.viemClientsInitialized) return;
    if (this.viemInitPromise) return this.viemInitPromise;

    this.viemInitPromise = (async () => {
      try {
        const viem = await import('viem');
        const viemAccounts = await import('viem/accounts');
        const viemChains = await import('viem/chains');

        const formattedKey = (
          this.config.privateKey.startsWith('0X')
            ? '0x' + this.config.privateKey.slice(2)
            : this.config.privateKey
        ) as `0x${string}`;

        const account = viemAccounts.privateKeyToAccount(formattedKey);
        this.account = account;
        this.address = account.address;

        const isTestnet = this.config.networkMode === 'testnet';

        const baseChain = isTestnet ? viemChains.baseSepolia : viemChains.base;
        const polygonChain = isTestnet ? viemChains.polygonAmoy : viemChains.polygon;

        this.basePublicClient = viem.createPublicClient({
          chain: baseChain,
          transport: viem.http(this.config.network.baseRpcUrl),
        });

        this.polygonPublicClient = viem.createPublicClient({
          chain: polygonChain,
          transport: viem.http(this.config.network.polygonRpcUrl),
        });

        this.baseWalletClient = viem.createWalletClient({
          account,
          chain: baseChain,
          transport: viem.http(this.config.network.baseRpcUrl),
        });

        this.polygonWalletClient = viem.createWalletClient({
          account,
          chain: polygonChain,
          transport: viem.http(this.config.network.polygonRpcUrl),
        });

        this.viemClientsInitialized = true;
      } catch (err) {
        throw new WalletError(
          `Failed to initialize live Viem client. Ensure 'viem' dependency is installed: ${(err as Error).message}`
        );
      }
    })();

    return this.viemInitPromise;
  }

  // ----------------------------------------------------------------------------
  // Core WalletClient API Methods
  // ----------------------------------------------------------------------------

  public getAddress(): string {
    return this.address;
  }

  public async getBaseUsdcBalance(): Promise<number> {
    if (this.isMock) {
      if (this.mockSimulateError) throw new NetworkError('base', 'Simulated network failure on Base RPC');
      return this.mockBaseUsdc;
    }

    await this.ensureViemClients();
    try {
      const balance = await this.basePublicClient.readContract({
        address: this.config.network.baseUsdcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.address as `0x${string}`],
      });
      return usdcUnitsToNumber(balance as bigint);
    } catch (err) {
      throw new NetworkError('base', `Failed to query Base USDC balance: ${(err as Error).message}`);
    }
  }

  public async getPolygonUsdcBalance(): Promise<number> {
    if (this.isMock) {
      if (this.mockSimulateError) throw new NetworkError('polygon', 'Simulated network failure on Polygon RPC');
      return this.mockPolygonUsdc;
    }

    await this.ensureViemClients();
    try {
      const balance = await this.polygonPublicClient.readContract({
        address: this.config.network.polygonUsdcAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.address as `0x${string}`],
      });
      return usdcUnitsToNumber(balance as bigint);
    } catch (err) {
      throw new NetworkError('polygon', `Failed to query Polygon USDC balance: ${(err as Error).message}`);
    }
  }

  public async getTotalBalanceUsd(): Promise<number> {
    const [baseBal, polyBal] = await Promise.all([
      this.getBaseUsdcBalance(),
      this.getPolygonUsdcBalance(),
    ]);
    return Number((baseBal + polyBal).toFixed(USDC_DECIMALS));
  }

  public async getBalanceBreakdown(): Promise<WalletBalance> {
    const [baseUsdc, polygonUsdc] = await Promise.all([
      this.getBaseUsdcBalance(),
      this.getPolygonUsdcBalance(),
    ]);
    return {
      baseUsdc,
      polygonUsdc,
      totalUsd: Number((baseUsdc + polygonUsdc).toFixed(USDC_DECIMALS)),
      timestamp: Date.now(),
    };
  }

  public async getUsdcBalance(chain: SupportedChain): Promise<number> {
    if (chain === 'base') return this.getBaseUsdcBalance();
    if (chain === 'polygon') return this.getPolygonUsdcBalance();
    throw new WalletError(`Unsupported chain '${chain}'. Must be 'base' or 'polygon'.`);
  }

  // ----------------------------------------------------------------------------
  // Transfer Execution & Constitutional Validation (Articles I & II)
  // ----------------------------------------------------------------------------

  public async transferUsdc(
    chain: SupportedChain,
    recipient: string,
    amount: number
  ): Promise<string> {
    // Stage 1: Sanity & Format Validation
    if (chain !== 'base' && chain !== 'polygon') {
      throw new WalletError(`Unsupported chain '${chain}'. Must be 'base' or 'polygon'.`);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new WalletError(`Transfer amount must be a positive finite number. Received: ${amount}`);
    }

    if (amount < 0.000001) {
      throw new WalletError(`Transfer amount ${amount} is below minimum atomic USDC unit (0.000001).`);
    }

    if (!isValidAddress(recipient)) {
      throw new InvalidAddressError(recipient, 'Address failed 20-byte EVM format check.');
    }

    // Stage 2: Zero Address Prohibition (Constitution Article I, Section 2)
    const normalizedRecipient = recipient.toLowerCase();
    if (normalizedRecipient === ZERO_ADDRESS) {
      throw new ConstitutionViolationError(
        'Transfer to zero address is strictly prohibited by Article I, Section 2 of the Constitution.'
      );
    }

    // Stage 3: Sovereign Whitelist Enforcement (Constitution Article I, Section 2 & 3)
    if (!this.isWhitelisted(normalizedRecipient)) {
      throw new ConstitutionViolationError(
        `Transfer recipient '${recipient}' is not on the Sovereign Whitelist (Article I, Section 2). Transaction aborted.`
      );
    }

    // Stage 4: Solvency & Balance Check (Constitution Article I & II)
    const currentBalance = await this.getUsdcBalance(chain);
    if (amount > currentBalance) {
      throw new InsufficientBalanceError(chain, amount, currentBalance);
    }

    // Stage 5: Execution
    if (this.isMock) {
      return this.executeMockTransfer(chain, recipient, amount);
    } else {
      return this.executeViemTransfer(chain, recipient, amount);
    }
  }

  private executeMockTransfer(
    chain: SupportedChain,
    recipient: string,
    amount: number
  ): string {
    if (this.mockSimulateError) {
      throw new NetworkError(chain, 'Simulated transaction submission failure in mock mode');
    }

    // Deduct balance
    if (chain === 'base') {
      this.mockBaseUsdc = Number((this.mockBaseUsdc - amount).toFixed(USDC_DECIMALS));
    } else {
      this.mockPolygonUsdc = Number((this.mockPolygonUsdc - amount).toFixed(USDC_DECIMALS));
    }

    this.mockTransferNonce++;
    const nonce = this.mockTransferNonce;
    const rawUnits = numberToUsdcUnits(amount);

    // Generate deterministic 32-byte txHash (0x + 64 hex characters)
    const seed = `${chain}:${recipient.toLowerCase()}:${amount.toFixed(6)}:${nonce}`;
    let hashNum = 0;
    for (let i = 0; i < seed.length; i++) {
      hashNum = (hashNum << 5) - hashNum + seed.charCodeAt(i);
      hashNum |= 0;
    }
    const hexHash = Math.abs(hashNum).toString(16).padStart(8, '0');
    const nonceHex = nonce.toString(16).padStart(8, '0');
    const txHash = `0x${hexHash}${nonceHex}${'def0'.repeat(12)}`;

    const record: MockTransferRecord = {
      id: `mock-tx-${nonce}`,
      txHash,
      chain,
      recipient,
      amountUsd: amount,
      rawAmount: rawUnits,
      timestamp: Date.now(),
    };
    this.mockTransfers.push(record);

    return txHash;
  }

  private async executeViemTransfer(
    chain: SupportedChain,
    recipient: string,
    amount: number
  ): Promise<string> {
    await this.ensureViemClients();
    const rawUnits = numberToUsdcUnits(amount);
    const client = chain === 'base' ? this.baseWalletClient : this.polygonWalletClient;
    const usdcAddress =
      chain === 'base'
        ? (this.config.network.baseUsdcAddress as `0x${string}`)
        : (this.config.network.polygonUsdcAddress as `0x${string}`);

    try {
      const txHash = await client.writeContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [recipient as `0x${string}`, rawUnits],
      });
      return txHash;
    } catch (err) {
      throw new NetworkError(chain, `On-chain transfer failed: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------------------------
  // Mock Control & Test Ergonomics (Available when isMock=true)
  // ----------------------------------------------------------------------------

  public setMockBalance(
    chain: SupportedChain,
    amountUsd: number,
    options?: { allowDeficit?: boolean } | boolean
  ): void {
    if (!this.isMock) throw new WalletError('Cannot set mock balance in live mode');
    if (!Number.isFinite(amountUsd)) {
      throw new WalletError(`Invalid mock balance amount: ${amountUsd}`);
    }
    const allowDeficit = typeof options === 'boolean' ? options : options?.allowDeficit ?? false;
    if (amountUsd < 0 && !allowDeficit) {
      throw new WalletError('Balance cannot be negative');
    }
    if (chain === 'base') {
      this.mockBaseUsdc = Number(amountUsd.toFixed(USDC_DECIMALS));
    } else {
      this.mockPolygonUsdc = Number(amountUsd.toFixed(USDC_DECIMALS));
    }
  }

  public setMockBalances(
    balances: { base?: number; polygon?: number },
    options?: { allowDeficit?: boolean } | boolean
  ): void {
    if (balances.base !== undefined) this.setMockBalance('base', balances.base, options);
    if (balances.polygon !== undefined) this.setMockBalance('polygon', balances.polygon, options);
  }

  public setMockDeficit(chain: SupportedChain, deficitUsd: number): void {
    const amount = -Math.abs(deficitUsd);
    this.setMockBalance(chain, amount, true);
  }

  public getMockTransfers(): MockTransferRecord[] {
    return [...this.mockTransfers];
  }

  public clearMockTransfers(): void {
    this.mockTransfers.length = 0;
  }

  public setSimulateError(shouldSimulate: boolean): void {
    this.mockSimulateError = shouldSimulate;
  }

  public resetMockState(): void {
    this.initMockProvider();
    this.clearMockTransfers();
  }
}

// ==============================================================================
// 5. Factory Functions
// ==============================================================================

export function createApexWallet(config?: AppConfig): ApexWallet {
  return new ApexWallet(config);
}

let cachedWallet: ApexWallet | null = null;

export function getWallet(): ApexWallet {
  if (!cachedWallet) {
    cachedWallet = createApexWallet();
  }
  return cachedWallet;
}

export function resetWallet(): void {
  cachedWallet = null;
}
