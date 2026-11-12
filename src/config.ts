/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Secure Configuration Loader & Validator
 * ==============================================================================
 * Zero-dependency configuration loader supporting:
 * - Pure TypeScript parsing of .env files
 * - Multi-network mode switching ('mock' | 'testnet' | 'mainnet')
 * - Sensible deterministic defaults in mock mode
 * - Strict cryptographic validation for private keys and EVM addresses
 * - Constitutional invariant enforcement at load time (Quarter-Kelly, 5% cap)
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  AppConfig,
  NetworkConfig,
  NetworkMode,
  LogLevel,
  SupportedChain,
  InferenceConfig,
  InferenceMode,
  TokenPricing,
} from './types.ts';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`[ConfigValidationError] ${message}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Standard deterministic mock private key for offline testing.
 */
export const DEFAULT_MOCK_PRIVATE_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Zero-dependency parser for .env file contents.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const rawKey = line.slice(0, eqIndex).trim();
    const key = rawKey.replace(/^export\s+/, '');
    let val = line.slice(eqIndex + 1).trim();

    // 1. Strip inline comments outside of quotes
    let inQuote: '"' | "'" | null = null;
    let commentIndex = -1;

    for (let i = 0; i < val.length; i++) {
      const char = val[i];
      if (inQuote) {
        if (char === inQuote) {
          // Check if quote is escaped by an odd number of preceding backslashes
          let backslashCount = 0;
          let j = i - 1;
          while (j >= 0 && val[j] === '\\') {
            backslashCount++;
            j--;
          }
          if (backslashCount % 2 === 0) {
            inQuote = null;
          }
        }
      } else {
        if (char === '"' || char === "'") {
          inQuote = char;
        } else if (char === '#') {
          commentIndex = i;
          break;
        }
      }
    }

    if (commentIndex !== -1) {
      val = val.slice(0, commentIndex).trim();
    }

    // 2. Strip surrounding single or double quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Validates a 20-byte hexadecimal Ethereum address (with 0x or 0X prefix).
 */
export function isValidAddress(address: string): boolean {
  return /^0[xX][0-9a-fA-F]{40}$/.test(address);
}

/**
 * Validates a 32-byte hexadecimal private key (with 0x or 0X prefix).
 */
export function isValidPrivateKey(key: string): boolean {
  return /^0[xX][0-9a-fA-F]{64}$/.test(key);
}

/**
 * Checks if a private key is a known dummy/test key.
 */
export function isKnownMockPrivateKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === DEFAULT_MOCK_PRIVATE_KEY.toLowerCase() ||
    normalized ===
      '0x0000000000000000000000000000000000000000000000000000000000000001'
  );
}

/**
 * Parses the ordered LLM provider queue from a JSON array environment variable.
 */
export function parseInferenceProviders(raw: string | undefined): Array<{
  id: string;
  type: 'ollama' | 'openai';
  baseUrl: string;
  apiKey?: string;
  model: string;
  free: boolean;
} & TokenPricing> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ConfigValidationError(
      `Invalid INFERENCE_PROVIDERS: '${raw}'. Must be a JSON array of provider objects.`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigValidationError(
      `Invalid INFERENCE_PROVIDERS: '${raw}'. Must be a JSON array of provider objects.`
    );
  }

  return parsed.map((entry: unknown, index: number) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const type: 'ollama' | 'openai' = record.type === 'openai' ? 'openai' : 'ollama';
    return {
      id: String(record.id ?? `provider-${index}`),
      type,
      baseUrl: String(record.baseUrl ?? (type === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1')),
      apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
      model: String(record.model ?? (type === 'ollama' ? 'llama3' : 'gpt-4o-mini')),
      free: record.free === undefined ? type === 'ollama' : Boolean(record.free),
      ...(typeof record.priceInPerMTok === 'number' ? { priceInPerMTok: record.priceInPerMTok } : {}),
      ...(typeof record.priceOutPerMTok === 'number' ? { priceOutPerMTok: record.priceOutPerMTok } : {}),
    };
  });
}

/**
 * Values that look like template placeholders are treated as absent keys, so
 * a `.env` copied from `.env.example` never counts as a configured provider.
 */
export function isUsableApiKey(value: string | undefined): value is string {
  const key = (value ?? '').trim();
  if (!key) return false;
  return !/^(mock[-_].*|change[-_]?me.*|your[-_].*|placeholder.*|x{3,}|<.*>|sk-\.\.\..*|\.\.\.)$/i.test(key);
}

export type FreePresetId = 'openrouter' | 'groq' | 'gemini' | 'ollama';
export type PaidPresetId = 'anthropic' | 'gemini';

export const DEFAULT_FREE_ORDER: FreePresetId[] = ['openrouter', 'groq', 'gemini', 'ollama'];
export const DEFAULT_PAID_ORDER: PaidPresetId[] = ['anthropic', 'gemini'];

const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

function parsePresetOrder<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  variable: string
): T[] {
  const text = (raw ?? '').trim();
  if (!text) return [...allowed];
  const ids = text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const id of ids) {
    if (!allowed.includes(id as T)) {
      throw new ConfigValidationError(
        `Invalid ${variable}: unknown provider '${id}'. Allowed: ${allowed.join(', ')}.`
      );
    }
  }
  return [...new Set(ids)] as T[];
}

function parsePrice(raw: string | undefined, fallback: number, variable: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigValidationError(`Invalid ${variable}: '${raw}'. Must be a non-negative number (USD per 1M tokens).`);
  }
  return value;
}

type ProviderEntry = InferenceConfig['providers'][number];

interface PresetDefinition {
  /** Provider id written into the queue (Gemini differs per mode). */
  id: string;
  type: ProviderEntry['type'];
  /** Env variable holding the key; Ollama is keyless and keyed by its URL. */
  keyVar?: string;
  baseUrlVar: string;
  defaultBaseUrl?: string;
  modelVar: string;
  defaultModel: string;
  /** Paid presets only: env variables and defaults for per-token prices. */
  pricing?: { inVar: string; inDefault: number; outVar: string; outDefault: number };
}

const FREE_PRESETS: Record<FreePresetId, PresetDefinition> = {
  openrouter: {
    id: 'openrouter', type: 'openai', keyVar: 'OPENROUTER_API_KEY',
    baseUrlVar: 'OPENROUTER_BASE_URL', defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelVar: 'OPENROUTER_FREE_MODEL', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  groq: {
    id: 'groq', type: 'openai', keyVar: 'GROQ_API_KEY',
    baseUrlVar: 'GROQ_BASE_URL', defaultBaseUrl: 'https://api.groq.com/openai/v1',
    modelVar: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile',
  },
  gemini: {
    id: 'gemini-free', type: 'openai', keyVar: 'GEMINI_API_KEY',
    baseUrlVar: 'GEMINI_BASE_URL', defaultBaseUrl: GEMINI_OPENAI_BASE_URL,
    modelVar: 'GEMINI_FREE_MODEL', defaultModel: 'gemini-2.0-flash',
  },
  ollama: {
    id: 'ollama', type: 'ollama',
    baseUrlVar: 'OLLAMA_BASE_URL',
    modelVar: 'OLLAMA_MODEL', defaultModel: 'llama3.1',
  },
};

const PAID_PRESETS: Record<PaidPresetId, PresetDefinition> = {
  anthropic: {
    id: 'anthropic', type: 'openai', keyVar: 'ANTHROPIC_API_KEY',
    baseUrlVar: 'ANTHROPIC_BASE_URL', defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelVar: 'ANTHROPIC_MODEL', defaultModel: 'claude-haiku-4-5',
    pricing: { inVar: 'ANTHROPIC_PRICE_IN_PER_MTOK', inDefault: 1.0, outVar: 'ANTHROPIC_PRICE_OUT_PER_MTOK', outDefault: 5.0 },
  },
  gemini: {
    id: 'gemini-paid', type: 'openai', keyVar: 'GEMINI_API_KEY',
    baseUrlVar: 'GEMINI_BASE_URL', defaultBaseUrl: GEMINI_OPENAI_BASE_URL,
    modelVar: 'GEMINI_PAID_MODEL', defaultModel: 'gemini-2.5-flash',
    pricing: { inVar: 'GEMINI_PRICE_IN_PER_MTOK', inDefault: 0.3, outVar: 'GEMINI_PRICE_OUT_PER_MTOK', outDefault: 2.5 },
  },
};

/** Returns the provider entry for a preset, or null when its key/URL is absent. */
function resolvePreset(
  preset: PresetDefinition,
  env: Record<string, string | undefined>,
  free: boolean
): ProviderEntry | null {
  const envOrDefault = (name: string, fallback: string) => (env[name] ?? '').trim() || fallback;
  let apiKey: string | undefined;
  if (preset.keyVar) {
    if (!isUsableApiKey(env[preset.keyVar])) return null;
    apiKey = env[preset.keyVar]!.trim();
  }
  const baseUrl = envOrDefault(preset.baseUrlVar, preset.defaultBaseUrl ?? '');
  if (!baseUrl) return null; // keyless presets (Ollama) are opt-in through their URL
  return {
    id: preset.id,
    type: preset.type,
    free,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    model: envOrDefault(preset.modelVar, preset.defaultModel),
    ...(preset.pricing
      ? {
          priceInPerMTok: parsePrice(env[preset.pricing.inVar], preset.pricing.inDefault, preset.pricing.inVar),
          priceOutPerMTok: parsePrice(env[preset.pricing.outVar], preset.pricing.outDefault, preset.pricing.outVar),
        }
      : {}),
  };
}

/**
 * Builds the ordered provider queue for a mode from the keys present in the
 * environment. Providers whose key is missing or a placeholder are skipped;
 * Ollama is opt-in through OLLAMA_BASE_URL.
 */
export function buildPresetProviders(
  env: Record<string, string | undefined>,
  mode: InferenceMode
): InferenceConfig['providers'] {
  const queue: Array<PresetDefinition> = mode === 'free'
    ? parsePresetOrder(env.INFERENCE_FREE_ORDER, DEFAULT_FREE_ORDER, 'INFERENCE_FREE_ORDER').map((id) => FREE_PRESETS[id])
    : parsePresetOrder(env.INFERENCE_PAID_ORDER, DEFAULT_PAID_ORDER, 'INFERENCE_PAID_ORDER').map((id) => PAID_PRESETS[id]);
  return queue
    .map((preset) => resolvePreset(preset, env, mode === 'free'))
    .filter((entry): entry is ProviderEntry => entry !== null);
}

/**
 * Loads and validates application configuration.
 *
 * @param envOverrides Optional dictionary of environment variables to override process.env.
 * @returns Fully validated and strongly typed AppConfig.
 */
export function loadConfig(
  envOverrides?: Record<string, string | undefined>
): AppConfig {
  // 1. Try loading .env from process.cwd() if not already loaded
  const envFilePath = path.resolve(process.cwd(), '.env');
  const fileEnv: Record<string, string> = {};

  if (fs.existsSync(envFilePath)) {
    try {
      const content = fs.readFileSync(envFilePath, 'utf8');
      Object.assign(fileEnv, parseEnvFile(content));
    } catch {
      // Ignored if unreadable; fall back to process.env
    }
  }

  // Merged environment dictionary: fileEnv -> process.env -> envOverrides
  const env: Record<string, string | undefined> = {
    ...fileEnv,
    ...process.env,
    ...envOverrides,
  };

  // 2. Validate Network Mode
  const rawNetworkMode = (env.NETWORK_MODE || 'mock').trim().toLowerCase();
  if (
    rawNetworkMode !== 'mock' &&
    rawNetworkMode !== 'testnet' &&
    rawNetworkMode !== 'mainnet'
  ) {
    throw new ConfigValidationError(
      `Invalid NETWORK_MODE: '${env.NETWORK_MODE}'. Must be 'mock', 'testnet', or 'mainnet'.`
    );
  }
  const networkMode: NetworkMode = rawNetworkMode as NetworkMode;

  // 3. System & Runtime Configuration
  const nodeEnv = (env.NODE_ENV || 'development').trim();
  const rawLogLevel = (env.LOG_LEVEL || 'info').trim().toLowerCase();
  const validLogLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const logLevel: LogLevel = validLogLevels.includes(rawLogLevel as LogLevel)
    ? (rawLogLevel as LogLevel)
    : 'info';
  const databasePath = (env.DATABASE_PATH || './data/agent.db').trim();

  // 4. Private Key & Wallet Validation
  let privateKey = env.PRIVATE_KEY || env.AGENT_PRIVATE_KEY || '';

  if (networkMode === 'mock') {
    if (!privateKey) {
      privateKey = DEFAULT_MOCK_PRIVATE_KEY;
    } else if (!isValidPrivateKey(privateKey)) {
      throw new ConfigValidationError(
        `Invalid PRIVATE_KEY format in mock mode: must be 64 hex characters with 0x prefix.`
      );
    }
  } else if (networkMode === 'testnet') {
    if (!privateKey) {
      throw new ConfigValidationError(
        `Missing required environment variable: PRIVATE_KEY for testnet mode.`
      );
    }
    if (!isValidPrivateKey(privateKey)) {
      throw new ConfigValidationError(
        `Invalid PRIVATE_KEY format for testnet: must be a 32-byte hex string starting with 0x.`
      );
    }
  } else if (networkMode === 'mainnet') {
    if (!privateKey) {
      throw new ConfigValidationError(
        `Missing required environment variable: PRIVATE_KEY for mainnet mode.`
      );
    }
    if (!isValidPrivateKey(privateKey)) {
      throw new ConfigValidationError(
        `Invalid PRIVATE_KEY format for mainnet: must be a 32-byte hex string starting with 0x.`
      );
    }
    if (isKnownMockPrivateKey(privateKey)) {
      throw new ConfigValidationError(
        `Mock/dummy private key cannot be used in mainnet mode.`
      );
    }
  }

  // Mother Clan Wallet validation
  const motherWalletAddress = (
    env.MOTHER_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000'
  ).trim();
  if (!isValidAddress(motherWalletAddress)) {
    throw new ConfigValidationError(
      `Invalid MOTHER_WALLET_ADDRESS format: '${motherWalletAddress}'. Must be a 20-byte hex address with 0x prefix.`
    );
  }

  // 5. Network RPC & Contract Configuration
  let baseRpcUrl: string;
  let polygonRpcUrl: string;
  let baseUsdcAddress: string;
  let polygonUsdcAddress: string;
  const isMock = networkMode === 'mock';

  if (networkMode === 'mock') {
    baseRpcUrl = (env.BASE_RPC_URL || 'http://localhost:8545').trim();
    polygonRpcUrl = (env.POLYGON_RPC_URL || 'http://localhost:8545').trim();
    baseUsdcAddress = (
      env.BASE_USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    ).trim();
    polygonUsdcAddress = (
      env.POLYGON_USDC_ADDRESS || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'
    ).trim();
  } else if (networkMode === 'testnet') {
    baseRpcUrl = (env.BASE_RPC_URL || 'https://sepolia.base.org').trim();
    polygonRpcUrl = (
      env.POLYGON_RPC_URL || 'https://rpc-amoy.polygon.technology'
    ).trim();
    baseUsdcAddress = (
      env.BASE_USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    ).trim();
    polygonUsdcAddress = (
      env.POLYGON_USDC_ADDRESS || '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'
    ).trim();
  } else {
    // mainnet
    baseRpcUrl = (env.BASE_RPC_URL || 'https://mainnet.base.org').trim();
    polygonRpcUrl = (env.POLYGON_RPC_URL || 'https://polygon-rpc.com').trim();
    baseUsdcAddress = (
      env.BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    ).trim();
    polygonUsdcAddress = (
      env.POLYGON_USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
    ).trim();
  }

  if (!isValidAddress(baseUsdcAddress)) {
    throw new ConfigValidationError(
      `Invalid BASE_USDC_ADDRESS: '${baseUsdcAddress}'.`
    );
  }
  if (!isValidAddress(polygonUsdcAddress)) {
    throw new ConfigValidationError(
      `Invalid POLYGON_USDC_ADDRESS: '${polygonUsdcAddress}'.`
    );
  }

  const network: NetworkConfig = {
    baseRpcUrl,
    polygonRpcUrl,
    baseUsdcAddress,
    polygonUsdcAddress,
    isMock,
  };

  // 6. Financial Capital & Metabolic Thresholds
  const initialCapitalUsd = Number.parseFloat(
    env.INITIAL_CAPITAL_USD || '50.00'
  );
  if (Number.isNaN(initialCapitalUsd) || initialCapitalUsd <= 0) {
    throw new ConfigValidationError(
      `INITIAL_CAPITAL_USD must be a positive number. Received: '${env.INITIAL_CAPITAL_USD}'.`
    );
  }

  const greenThreshold = Number.parseFloat(
    env.TIER_GREEN_THRESHOLD || '50.00'
  );
  const yellowThreshold = Number.parseFloat(
    env.TIER_YELLOW_THRESHOLD || '10.00'
  );
  const orangeThreshold = Number.parseFloat(
    env.TIER_ORANGE_THRESHOLD || '2.00'
  );
  const redThreshold = Number.parseFloat(env.TIER_RED_THRESHOLD || '0.00');

  if (
    Number.isNaN(greenThreshold) ||
    Number.isNaN(yellowThreshold) ||
    Number.isNaN(orangeThreshold) ||
    Number.isNaN(redThreshold)
  ) {
    throw new ConfigValidationError(
      `All metabolic tier thresholds must be valid numbers.`
    );
  }

  if (
    greenThreshold <= yellowThreshold ||
    yellowThreshold < orangeThreshold ||
    orangeThreshold <= redThreshold ||
    redThreshold < 0
  ) {
    throw new ConfigValidationError(
      `Invalid metabolic thresholds hierarchy: must satisfy Green (${greenThreshold}) > Yellow (${yellowThreshold}) >= Orange (${orangeThreshold}) > Red (${redThreshold}) >= 0.`
    );
  }

  // 7. Heartbeat Intervals
  const baseIntervalMs = Number.parseInt(
    env.HEARTBEAT_INTERVAL_MS || '60000',
    10
  );
  const greenMs = Number.parseInt(
    env.HEARTBEAT_INTERVAL_GREEN_MS || String(baseIntervalMs),
    10
  );
  const yellowMs = Number.parseInt(
    env.HEARTBEAT_INTERVAL_YELLOW_MS || '300000',
    10
  );
  const orangeMs = Number.parseInt(
    env.HEARTBEAT_INTERVAL_ORANGE_MS || String(baseIntervalMs),
    10
  );

  if (
    Number.isNaN(greenMs) ||
    Number.isNaN(yellowMs) ||
    Number.isNaN(orangeMs) ||
    greenMs <= 0 ||
    yellowMs <= 0 ||
    orangeMs <= 0
  ) {
    throw new ConfigValidationError(
      `Heartbeat intervals must be positive integers.`
    );
  }

  // 8. Risk Management & Kelly Criterion
  const kellyFraction = Number.parseFloat(env.KELLY_FRACTION || '0.25');
  if (
    Number.isNaN(kellyFraction) ||
    kellyFraction <= 0 ||
    kellyFraction > 1.0
  ) {
    throw new ConfigValidationError(
      `KELLY_FRACTION must be a number between 0 and 1. Received: '${env.KELLY_FRACTION}'.`
    );
  }

  const maxBankrollBetPercent = Number.parseFloat(
    env.MAX_BANKROLL_BET_PERCENT || '0.05'
  );
  if (
    Number.isNaN(maxBankrollBetPercent) ||
    maxBankrollBetPercent <= 0 ||
    maxBankrollBetPercent > 0.05
  ) {
    throw new ConfigValidationError(
      `MAX_BANKROLL_BET_PERCENT cannot exceed 0.05 (5%) per Constitution Article II. Received: '${env.MAX_BANKROLL_BET_PERCENT}'.`
    );
  }

  // 9. x402 Micropayments Protocol
  const portX402 = Number.parseInt(env.PORT_X402 || '4020', 10);
  if (Number.isNaN(portX402) || portX402 < 1024 || portX402 > 65535) {
    throw new ConfigValidationError(
      `PORT_X402 must be an unprivileged integer between 1024 and 65535. Received: '${env.PORT_X402}'.`
    );
  }

  const x402PriceUsdc = Number.parseFloat(env.X402_PRICE_USDC || '0.05');
  if (Number.isNaN(x402PriceUsdc) || x402PriceUsdc <= 0) {
    throw new ConfigValidationError(
      `X402_PRICE_USDC must be a positive number.`
    );
  }

  const rawChain = (env.X402_SETTLEMENT_CHAIN || 'base').trim().toLowerCase();
  const settlementChain: SupportedChain =
    rawChain === 'polygon' ? 'polygon' : 'base';

  // 10. Bounties & Mitosis
  const minBountyRewardUsd = Number.parseFloat(
    env.BOUNTIES_MIN_REWARD_USD || '10.00'
  );
  const mitosisMultiplier = Number.parseFloat(
    env.MITOSIS_CAPITAL_MULTIPLIER || '3.0'
  );
  if (Number.isNaN(mitosisMultiplier) || mitosisMultiplier < 1.0) {
    throw new ConfigValidationError(
      `MITOSIS_CAPITAL_MULTIPLIER must be >= 1.0.`
    );
  }

  const royaltyPercentage = Number.parseFloat(
    env.ROYALTY_PERCENTAGE || '0.05'
  );
  if (
    Number.isNaN(royaltyPercentage) ||
    royaltyPercentage <= 0 ||
    royaltyPercentage > 1.0
  ) {
    throw new ConfigValidationError(
      `ROYALTY_PERCENTAGE must be between 0 and 1. Received: '${env.ROYALTY_PERCENTAGE}'.`
    );
  }

  // 11. Mock & Simulation Controls
  let useMockApis =
    env.USE_MOCK_APIS !== undefined
      ? env.USE_MOCK_APIS.trim().toLowerCase() === 'true'
      : networkMode === 'mock';

  if (networkMode === 'mainnet' && useMockApis) {
    throw new ConfigValidationError(
      `USE_MOCK_APIS cannot be enabled in mainnet mode.`
    );
  }

  const mockBalanceUsd = Number.parseFloat(
    env.MOCK_WALLET_BALANCE_USD || '75.00'
  );
  const simulateErrors =
    env.MOCK_SIMULATE_ERRORS !== undefined &&
    env.MOCK_SIMULATE_ERRORS.trim().toLowerCase() === 'true';

  // 11.5 Inference Mode & LLM Provider Queue (free | paid, deterministic fallback)
  const rawInferenceMode = (env.INFERENCE_MODE || 'free').trim().toLowerCase();
  if (rawInferenceMode !== 'free' && rawInferenceMode !== 'paid') {
    throw new ConfigValidationError(
      `Invalid INFERENCE_MODE: '${env.INFERENCE_MODE}'. Must be 'free' or 'paid'.`
    );
  }
  const inferenceMode: InferenceMode = rawInferenceMode;

  const rawInferenceCapText = env.INFERENCE_CAP_PER_TICK || '5';
  const rawInferenceCap = Number(rawInferenceCapText);
  if (!/^\d+$/.test(rawInferenceCapText) || !Number.isSafeInteger(rawInferenceCap) || rawInferenceCap <= 0) {
    throw new ConfigValidationError(
      `Invalid INFERENCE_CAP_PER_TICK: '${env.INFERENCE_CAP_PER_TICK}'. Must be a positive integer.`
    );
  }

  // Advanced override: a non-empty INFERENCE_PROVIDERS JSON queue wins;
  // otherwise the queue is assembled from the provider keys present in .env.
  // A paid ceiling also carries the free queue: below VERDE the engine steps
  // down to it (AD-003). The engine filters the queue by the effective mode.
  const explicitProviders = parseInferenceProviders(env.INFERENCE_PROVIDERS);
  const inference: InferenceConfig = {
    mode: inferenceMode,
    capPerTick: rawInferenceCap,
    providers: explicitProviders.length > 0
      ? explicitProviders
      : inferenceMode === 'paid'
        ? [...buildPresetProviders(env, 'paid'), ...buildPresetProviders(env, 'free')]
        : buildPresetProviders(env, 'free'),
  };

  // 12. Final AppConfig assembly
  const appConfig: AppConfig = {
    nodeEnv,
    logLevel,
    networkMode,
    network,
    privateKey,
    motherWalletAddress,
    initialCapitalUsd,
    tierThresholds: {
      green: greenThreshold,
      yellow: yellowThreshold,
      orange: orangeThreshold,
      red: redThreshold,
    },
    heartbeatIntervals: {
      greenMs,
      yellowMs,
      orangeMs,
    },
    kelly: {
      fraction: kellyFraction,
      maxBankrollCap: maxBankrollBetPercent,
    },
    polymarket: {
      clobApiUrl: (
        env.POLYMARKET_CLOB_API_URL || 'https://clob.polymarket.com'
      ).trim(),
      apiKey: env.POLYMARKET_API_KEY?.trim(),
      apiSecret: env.POLYMARKET_API_SECRET?.trim(),
      apiPassphrase: env.POLYMARKET_API_PASSPHRASE?.trim(),
    },
    x402: {
      port: portX402,
      priceUsdc: x402PriceUsdc,
      settlementChain,
    },
    bounties: {
      githubToken: env.GITHUB_TOKEN?.trim(),
      minRewardUsd: Number.isNaN(minBountyRewardUsd) ? 10.0 : minBountyRewardUsd,
    },
    evolution: {
      mitosisMultiplier,
      royaltyPercentage,
    },
    inference,
    mock: {
      useMockApis,
      initialBalanceUsd: Number.isNaN(mockBalanceUsd) ? 75.0 : mockBalanceUsd,
      simulateErrors,
    },
  };

  return appConfig;
}

/**
 * Singleton cached configuration.
 */
let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
