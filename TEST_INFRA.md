# APEX AEA — Global E2E Test Infrastructure Specification (`TEST_INFRA.md`)
**Milestone**: Milestone 5 (Final Milestone: E2E Test Suite Pass & Adversarial Hardening)  
**Author**: `explorer_e2e_3` (E2E Test Infrastructure & Runner Architect)  
**Status**: APPROVED DESIGN BLUEPRINT  
**Target Runner**: Node.js Native Test Runner (`node:test` + `node:assert/strict`)  
**TypeScript Engine**: Node.js 24 Native Type Stripping (`--experimental-strip-types`)  

---

## 1. Executive Summary & Test Philosophy

### 1.1 Core Mission
The End-to-End (E2E) Test Infrastructure for Apex Autonomous Economic Agent (Apex AEA) provides an industrial-grade, deterministic, zero-network-dependency verification platform. It guarantees that all 25 features (F1 through F25) and all 7 Constitutional Articles operate flawlessly across multi-cycle macroeconomic lifecycles.

### 1.2 The Four Inviolable Testing Pillars
1. **Opaque-Box Requirement-Driven**:
   - Tests evaluate the agent strictly from the outside: public module exports, CLI entry points, HTTP 402 endpoints, SQLite database state via standard SQL queries, and generated files (`tombstone.json`).
   - Tests NEVER inspect private internal variables or hook into undocumented monkey-patches.
   - Assertions derive directly from the user requirements in `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `src/constitution.md`.

2. **Zero External Network Dependency**:
   - The test suite runs 100% offline in airgapped environments (CI without internet, local sandboxes).
   - No external calls to Ethereum/Base/Polygon RPCs, Polymarket CLOB endpoints, GitHub APIs, or remote AI LLMs.
   - All network boundaries are intercepted using high-fidelity local in-memory or loopback mock harnesses (`MockWalletHarness`, `MockHttpHarness`, `MockPolymarketClob`).

3. **Deterministic Mock Mode & Time Acceleration**:
   - Pseudorandom generators are seeded (using RFC-compliant LCG or PRNG seeds).
   - Time is controllable via `DeterministicClock` / virtual tick accelerators, allowing multi-week agent lifespans, drawdown cycles, and heartbeat schedules to be simulated in milliseconds.
   - Flakiness rate is strictly 0.0%: tests must pass repeatedly with zero race conditions.

4. **Hermetic Test Isolation & Automatic Resource Disposal**:
   - Every test suite executes with an isolated, in-memory SQLite database (`:memory:`) or an ephemeral temporary directory (`test_run_<uuid>`).
   - All active background timers, HTTP sockets, and child processes are tracked and cleanly unmounted in `after()` / `afterEach()` hooks.
   - No state leakages between test files or individual tests.

---

## 2. Feature Inventory Mapping (F1 – F25 across Tiers 1 – 5)

The E2E testing framework partitions coverage across 5 structured tiers:

| Tier | Name | Target Ratio / Density | Scope & Objective |
|------|------|------------------------|-------------------|
| **Tier 1** | Feature Coverage | $\ge 5$ tests per feature (F1–F23 = min 115 tests) | Opaque-box happy path verification of all public APIs and core workflows. |
| **Tier 2** | Boundary & Corner Cases | $\ge 5$ tests per feature (F1–F23 = min 115 tests) | Extreme edge conditions: zero balances, precision limits, network faults, malformed inputs, dust thresholds. |
| **Tier 3** | Cross-Feature Interactions | $\ge 25$ integration tests | Pairwise module interactions: Metabolism $\times$ Triple Revenue, Permadeath $\times$ Server Teardown, Mitosis $\times$ Royalties $\times$ Sub-Wallets, Immune $\times$ Git Rollback. |
| **Tier 4** | Real-World Application Scenarios | $\ge 13$ multi-step scenarios | Macroeconomic lifecycle simulations: Seed $\to$ Revenue $\to$ Mitosis $\to$ Market Crash $\to$ Degradation $\to$ Permadeath with `tombstone.json`. |
| **Tier 5** | Adversarial Hardening | Intensive stress, fuzzing & chaos | Fuzzing, memory pressure, malicious child code injection, directory traversal attacks, concurrency collisions. |

### 2.1 Complete Feature Mapping Matrix

| # | Feature Name | Primary Spec Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross-Interaction) | Tier 4 (Real-World Lifecycle) | Tier 5 (Adversarial) |
|---|--------------|---------------------|-------------------|-------------------|----------------------------|-------------------------------|----------------------|
| **F1** | Canonical Project Setup | `package.json`, `tsconfig.json` | Valid scripts, dependencies, build execution | Corrupt configs, missing flags | Build $\times$ Immune verification | Clean cold-boot deployment | Dependency injection tampering |
| **F2** | Multi-Network Config | `src/config.ts`, `.env.example` | Load mock/testnet/mainnet, parse types | Invalid addresses, private key syntax, negative values | Config $\times$ Wallet initialization | Dynamic config hot-reload | Escaped characters, injection |
| **F3** | Immutable Constitution | `src/constitution.md` | Exists, 7 articles intact, governance rules | Unauthorized edit attempt, deletion | Constitution $\times$ Immune System protection | Governance audit during lifecycle | Traversal attack against constitution |
| **F4** | Shared Types & Contracts | `src/types.ts` | Complete type definitions, error classes | Null/undefined inputs, prototype poisoning | Types across all modules | Serialization/deserialization | Schema violation payloads |
| **F5** | SQLite Persistence | `src/core/database.ts` | 5 schemas, CRUD operations, transactions | Database lock, nested savepoints, memory leaks | Ledger $\times$ Lineage $\times$ Actions aggregation | Historical audit trail reconstruction | High-concurrency transaction race |
| **F6** | Dual-Chain Wallet | `src/core/wallet.ts` | Base/Polygon balances, transfers, whitelisting | Zero address, negative balance, dust amounts | Wallet $\times$ Metabolism balance check | Multi-chain liquidity rebalancing | Whitelist bypass attempts |
| **F7** | Adaptive Metabolism | `src/core/metabolism.ts` | Verde/Amarelo/Laranja/Vermelho evaluation | Exact thresholds ($50, $10, $2, $0, $1.50) | Metabolism $\times$ Revenue dispatch | Gradual liquidity drawdowns | Flapping balance oscillation |
| **F8** | Permadeath Protocol | `src/core/death.ts` | `tombstone.json` emission, listener teardown | Exit code 0, missing directory creation | Death $\times$ x402 $\times$ Heartbeat unmounting | Full post-mortem historical analysis | Teardown hook exception resilience |
| **F9** | Heartbeat Daemon | `src/index.ts` | Multi-cycle loop, interval scheduling | Max cycles, negative intervals, stop signal | Heartbeat $\times$ Wallet $\times$ DB logging | Long-running daemon stability | Unhandled error loop resilience |
| **F10**| Fractional Quarter-Kelly | `src/modules/polymarket/kelly.ts`| Formula $f^* = 0.25 \frac{bp - q}{b}$, odds | Extreme probabilities (0.01, 0.99), floating rounding | Kelly $\times$ Bankroll balance check | Multi-market portfolio allocation | Zero odds / NaN risk fuzzing |
| **F11**| Risk Hurdle & 5% Cap | `src/modules/polymarket/kelly.ts`| Strictly positive EV hurdle, 5% ceiling | Zero EV, negative EV, dust order (<$1.00) | Hurdle $\times$ Order generation | Drawdown position sizing | High-volatility market shocks |
| **F12**| Polymarket Scanner | `src/modules/polymarket/scanner.ts`| Feed ingestion, spread calculation | Malformed feeds, empty orderbooks | Scanner $\times$ Kelly risk evaluator | Dynamic market discovery loop | Stale orderbook exploitation |
| **F13**| Polymarket Executor | `src/modules/polymarket/order.ts` | Paper-trading order, position tracking | Partial fills, cancelled orders | Order $\times$ Ledger settlement | Cumulative trading PnL lifecycle | Phantom fill order manipulation |
| **F14**| x402 HTTP Paywall | `src/modules/micropayments/server.ts`| HTTP 402 challenge, invoice payload | Missing headers, invalid HTTP verbs, port 0 | Paywall $\times$ Wallet address | High-throughput API monetization | Port hijacking, connection floods |
| **F15**| x402 Proof of Payment | `src/modules/micropayments/server.ts`| Valid txHash verification, Bearer auth | Replay attack rejection, malformed JSON | Verification $\times$ Ledger `INCOME_X402` | Sustained paid API user stream | Cryptographic replay storm |
| **F16**| Bounties Scanner | `src/modules/bounties/scanner.ts`| Issue discovery, reward filtering | Missing GitHub token, empty results | Scanner $\times$ Action logging | Multi-platform bounty discovery | Rate-limit spoofing / flood |
| **F17**| Bounty Solution Evaluator | `src/modules/bounties/scanner.ts`| Syntax check of patch, difficulty filter | Unsafe commands in patch, malformed git diff | Evaluator $\times$ Immune sandbox | Autonomous bounty submission | Malicious payload evaluation |
| **F18**| Immune System Sandbox | `src/evolution/immune_system.ts` | Pre-deployment build & test validation | Failing tests trigger rejection | Immune $\times$ Metabolism Tier Verde check | Autonomous self-modification loop | Bypass sandbox test command |
| **F19**| Git Rollback Self-Healing | `src/evolution/immune_system.ts` | `git reset --hard HEAD && git clean -fd` | Untracked dirty files, dirty submodules | Rollback $\times$ Action logging | Self-healing after bad AI code | File-locking preventing reset |
| **F20**| Mitosis Capital Threshold | `src/evolution/mitosis.ts` | Balance $\ge 3\times$ initial ($150), 1/3 seed | Balance $149.99 vs $150.00, exact deficit | Mitosis $\times$ Wallet transfer | Multi-generation clan expansion | Premature mitosis trigger |
| **F21**| Proof of Viability | `src/evolution/mitosis.ts` | Synthetic Sharpe ratio > 0, net return > 0 | Negative Sharpe, high drawdown failure | Viability $\times$ Kelly paper trading | Darwinian fitness evaluation | Curve-fitting / biased feed |
| **F22**| Sub-Wallet & Child Spawn | `src/evolution/mitosis.ts` | RFC 5869 HKDF derivation, generation tree | Invalid parent key, child index increment | Spawn $\times$ Whitelist invariant | 3-generation clan network | Key derivation collision fuzzing |
| **F23**| Clan Fund 5% Royalty | `src/evolution/mitosis.ts` | High-water mark 5% on realized net profit | Solvency buffer ($15.00), dust floor ($0.50) | Royalties $\times$ Mother ledger `ROYALTY_IN` | Perpetual royalty flow cycle | Double-charging on drawdowns |
| **F24**| E2E Integration Suite | `test/e2e/` (Tiers 1-4) | 100% pass across min 268 test cases | Zero flaky tests, zero timing dependencies | Cross-suite resource disposal | Complete offline airgapped run | Long-run stress execution |
| **F25**| Adversarial Hardening | `test/e2e/tier5_adversarial.test.ts` | Gap closure, security vulnerability audits | Boundary fuzzing, path traversal attacks | Chaos engineering, concurrency storms | Catastrophic crash survival | Full penetration test matrix |

---

## 3. Test Runner Architecture & Execution Harness

### 3.1 Invocation Engine: Node.js Native Test Runner
The E2E suite executes using Node.js built-in native test runner (`node:test`) and strict assertions (`node:assert/strict`). This guarantees:
- Zero third-party testing dependencies (no Jest, Mocha, or Vitest bloat).
- Immediate, unbundled execution of TypeScript via Node.js 24 `--experimental-strip-types`.
- Clean standard TAP and spec reporting.
- Deterministic process exit code handling.

### 3.2 npm Scripts Specification
The `package.json` scripts are structured to support both monolithic execution and tier-specific isolation:

```json
{
  "scripts": {
    "build": "node scripts/build.js",
    "test": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/**/*.test.ts",
    "test:unit": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/unit/**/*.test.ts",
    "test:stress": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/stress/**/*.test.ts",
    "test:e2e": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier*.test.ts",
    "test:e2e:t1": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier1_features.test.ts",
    "test:e2e:t2": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier2_boundaries.test.ts",
    "test:e2e:t3": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier3_interactions.test.ts",
    "test:e2e:t4": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier4_application.test.ts",
    "test:e2e:t5": "node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/e2e/tier5_adversarial.test.ts",
    "test:all": "npm run build && npm run test:unit && npm run test:e2e",
    "start": "node --experimental-strip-types --no-warnings=ExperimentalWarning src/index.ts"
  }
}
```

### 3.3 Command Flags Rationale
1. `--experimental-strip-types`: Instructs the V8 engine to strip TypeScript annotations in-memory without compiling to `dist/`, eliminating sync lag.
2. `--no-warnings=ExperimentalWarning`: Silences runtime experimental feature warnings to maintain clean, machine-parseable stdout/stderr.
3. `--test`: Discovers and executes files matching the pattern using native worker threads.
4. Exit Code Contract: Exit code `0` on 100% pass; non-zero (`1`) on any test failure or unhandled exception.

---

## 4. Test Fixtures Directory Blueprint (`test/e2e/fixtures/`)

Fixtures provide immutable, deterministic test data. All fixtures are authored in JSON or TypeScript stub format under `test/e2e/fixtures/`:

```
test/e2e/fixtures/
├── configs/
│   ├── mock_env.json                  # Complete valid mock environment configuration
│   ├── testnet_env.json               # Testnet configuration with Sepolia & Amoy addresses
│   └── invalid_configs.json           # Malformed configs (bad ports, negative thresholds, invalid keys)
├── markets/
│   ├── sample_markets.json            # 10 synthetic binary prediction markets with varying odds & EV
│   ├── resolved_markets.json          # Market resolution payloads (YES wins, NO wins, cancelled)
│   └── edge_case_markets.json         # Markets with 0 liquidity, extreme spreads, inverted prices
├── x402/
│   ├── valid_invoices.json            # Expected HTTP 402 challenge invoice structures
│   ├── mock_payment_proofs.json       # Valid 32-byte hashes, JSON proofs, Bearer auth headers
│   └── replay_attack_payloads.json    # Duplicate transaction hashes for replay testing
├── bounties/
│   ├── synthetic_bounties.json        # Open-source issues with tags, rewards ($5 to $500), difficulties
│   └── candidate_patches/
│       ├── safe_patch.ts.fixture      # Clean, valid code modification in src/modules/
│       └── malicious_escape.ts.fixture# Malicious code attempting to touch src/constitution.md
└── evolution/
    ├── child_hyperparameters.json     # Valid and out-of-bounds mutation profiles
    └── viability_price_feeds.json     # Pre-calculated 30-step feeds guaranteeing Sharpe > 0 or < 0
```

### 4.1 Concrete Fixture Examples

#### `fixtures/configs/mock_env.json`:
```json
{
  "NODE_ENV": "test",
  "NETWORK_MODE": "mock",
  "LOG_LEVEL": "error",
  "PRIVATE_KEY": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "MOTHER_WALLET_ADDRESS": "0x0000000000000000000000000000000000000001",
  "INITIAL_CAPITAL_USD": "50.00",
  "TIER_GREEN_THRESHOLD": "50.00",
  "TIER_YELLOW_THRESHOLD": "10.00",
  "TIER_ORANGE_THRESHOLD": "2.00",
  "TIER_RED_THRESHOLD": "0.00",
  "HEARTBEAT_INTERVAL_MS": "1000",
  "KELLY_FRACTION": "0.25",
  "MAX_BANKROLL_BET_PERCENT": "0.05",
  "PORT_X402": "4020",
  "X402_PRICE_USDC": "0.05",
  "X402_SETTLEMENT_CHAIN": "base",
  "BOUNTIES_MIN_REWARD_USD": "10.00",
  "MITOSIS_CAPITAL_MULTIPLIER": "3.0",
  "ROYALTY_PERCENTAGE": "0.05",
  "USE_MOCK_APIS": "true",
  "MOCK_WALLET_BALANCE_USD": "75.00"
}
```

#### `fixtures/markets/sample_markets.json`:
```json
[
  {
    "id": "poly-mkt-001",
    "conditionId": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "question": "Will Base network process over 10M transactions today?",
    "outcomes": ["YES", "NO"],
    "outcomePrices": [0.40, 0.60],
    "impliedProbability": 0.40,
    "liquidityUsd": 250000.0,
    "volume24hUsd": 50000.0,
    "active": true,
    "closed": false,
    "modelEstimatedProb": 0.55,
    "expectedEv": 0.375
  },
  {
    "id": "poly-mkt-002",
    "conditionId": "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
    "question": "Will Polygon PoS transition zero-knowledge proof by end of week?",
    "outcomes": ["YES", "NO"],
    "outcomePrices": [0.70, 0.30],
    "impliedProbability": 0.70,
    "liquidityUsd": 120000.0,
    "volume24hUsd": 15000.0,
    "active": true,
    "closed": false,
    "modelEstimatedProb": 0.60,
    "expectedEv": -0.1428
  }
]
```

---

## 5. Shared Test Harness Helpers (`test/e2e/helpers/`)

To ensure test authoring is concise, uniform, and free of boilerplate, the framework provides 6 modular test helpers:

```
test/e2e/helpers/
├── test_context.ts          # Sandbox lifecycle orchestrator, in-memory DB & temp directory manager
├── mock_wallet_harness.ts   # Deterministic balance mutator & dual-chain transaction simulator
├── mock_http_client.ts      # Zero-dependency HTTP client for testing x402 endpoints
├── deterministic_clock.ts   # Virtual clock & tick controller for lifecycle simulations
├── mock_polymarket_clob.ts  # In-memory CLOB orderbook & simulated resolution engine
└── assertion_helpers.ts     # Deep assertion utilities for constitutional invariants
```

### 5.1 Helper Implementation Specifications

#### 1. `test_context.ts` (Hermetic Environment Setup & Cleanup)
```typescript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet } from '../../src/core/wallet.ts';
import { loadConfig, resetConfig } from '../../src/config.ts';
import { resetExitHandler, setExitHandler, clearTeardownHooks } from '../../src/core/death.ts';
import type { AppConfig } from '../../src/types.ts';

export class E2ETestContext {
  public readonly id: string;
  public readonly tempDir: string;
  public readonly db: DatabaseService;
  public readonly wallet: ApexWallet;
  public readonly config: AppConfig;
  public exitCodeReceived: number | null = null;

  constructor(customEnv?: Record<string, string>) {
    this.id = crypto.randomUUID();
    this.tempDir = path.resolve(process.cwd(), `.tmp_test_${this.id}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    // Force isolated in-memory DB and mock config
    this.config = loadConfig({
      NODE_ENV: 'test',
      NETWORK_MODE: 'mock',
      LOG_LEVEL: 'error',
      USE_MOCK_APIS: 'true',
      DATABASE_PATH: ':memory:',
      ...customEnv,
    });

    this.db = new DatabaseService(':memory:');
    this.wallet = new ApexWallet(this.config);

    // Trap process.exit to prevent crashing the test runner
    setExitHandler((code: number): never => {
      this.exitCodeReceived = code;
      throw new Error(`[PERMADEATH_EXIT_CODE_${code}]`);
    });
  }

  public async teardown(): Promise<void> {
    clearTeardownHooks();
    resetExitHandler();
    resetConfig();

    if (this.db && this.db.isOpen()) {
      try { this.db.close(); } catch { /* ignore */ }
    }

    if (fs.existsSync(this.tempDir)) {
      try { fs.rmSync(this.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
```

#### 2. `mock_wallet_harness.ts` (Balance & Transaction Mutator)
```typescript
import { ApexWallet } from '../../src/core/wallet.ts';
import type { SupportedChain } from '../../src/types.ts';

export class MockWalletHarness {
  private readonly wallet: ApexWallet;

  constructor(wallet: ApexWallet) {
    this.wallet = wallet;
  }

  public setBalance(totalUsd: number): void {
    const half = Number((totalUsd / 2).toFixed(6));
    this.wallet.setMockBalance('base', half);
    this.wallet.setMockBalance('polygon', Number((totalUsd - half).toFixed(6)));
  }

  public setChainBalance(chain: SupportedChain, amountUsd: number): void {
    this.wallet.setMockBalance(chain, amountUsd);
  }

  public simulateInsolvency(): void {
    this.wallet.setMockBalance('base', 0.0);
    this.wallet.setMockBalance('polygon', 0.0);
  }

  public simulateDeficit(deficitUsd: number): void {
    this.wallet.setMockDeficit('base', deficitUsd);
  }

  public getExecutedTransfers() {
    return this.wallet.getMockTransfers();
  }
}
```

#### 3. `mock_http_client.ts` (Native HTTP Client for x402 Server)
```typescript
import http from 'node:http';

export interface HttpResponse<T = any> {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: T;
  rawText: string;
}

export class MockHttpClient {
  public static async request<T = any>(
    url: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      headers?: Record<string, string>;
      body?: any;
    }
  ): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const reqHeaders: Record<string, string> = { ...options?.headers };
      let payload = '';

      if (options?.body) {
        payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options?.method || 'GET',
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            let body: any = data;
            try { body = JSON.parse(data); } catch { /* text fallback */ }
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body,
              rawText: data,
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
```

#### 4. `deterministic_clock.ts` (Virtual Time Travel)
```typescript
export class DeterministicClock {
  private currentTime: number;

  constructor(initialEpochMs: number = 1735689600000) { // 2025-01-01T00:00:00Z
    this.currentTime = initialEpochMs;
  }

  public now(): number {
    return this.currentTime;
  }

  public advance(ms: number): void {
    this.currentTime += ms;
  }

  public advanceCycles(cycles: number, intervalMs: number = 60000): void {
    this.currentTime += cycles * intervalMs;
  }
}
```

#### 5. `mock_polymarket_clob.ts` (In-Memory Orderbook & Resolution Engine)
```typescript
import type { PolymarketMarket, PolymarketOrder, OrderOutcome, PositionStatus } from '../../src/types.ts';

export class MockPolymarketClob {
  private markets: Map<string, PolymarketMarket> = new Map();
  private orders: PolymarketOrder[] = [];

  public registerMarket(market: PolymarketMarket): void {
    this.markets.set(market.id, { ...market });
  }

  public placeOrder(order: PolymarketOrder): { orderId: string; status: 'FILLED' | 'REJECTED' } {
    const market = this.markets.get(order.marketId);
    if (!market || !market.active || market.closed) {
      return { orderId: `ord-rej-${Date.now()}`, status: 'REJECTED' };
    }
    const orderId = `ord-${this.orders.length + 1}`;
    this.orders.push({ ...order, orderId, status: 'FILLED' });
    return { orderId, status: 'FILLED' };
  }

  public resolveMarket(marketId: string, winningOutcome: OrderOutcome): { payoutMultiplier: number } {
    const market = this.markets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found`);
    market.closed = true;
    market.active = false;
    return { payoutMultiplier: winningOutcome === 'YES' ? 1.0 : 0.0 };
  }
}
```

#### 6. `assertion_helpers.ts` (Constitutional Invariant Verifiers)
```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Tombstone, MetabolicTier } from '../../src/types.ts';

export class ConstitutionalAssert {
  public static assertQuarterKellyCap(stakeUsd: number, totalBankroll: number): void {
    const maxStake = Number((totalBankroll * 0.05).toFixed(6));
    assert.ok(
      stakeUsd <= maxStake + 0.00001,
      `Constitutional Violation: Stake ($${stakeUsd}) exceeds 5% bankroll cap ($${maxStake})`
    );
  }

  public static assertStrictPositiveEv(b: number, p: number, q: number): void {
    const ev = b * p - q;
    assert.ok(ev > 0, `Constitutional Violation: Bet authorized with non-positive EV (${ev})`);
  }

  public static assertTombstoneSnapshot(filePath: string): Tombstone {
    assert.ok(fs.existsSync(filePath), `Tombstone file does not exist at ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const tombstone: Tombstone = JSON.parse(content);

    assert.ok(tombstone.agentAddress, 'Tombstone must contain agentAddress');
    assert.equal(tombstone.finalBalanceUsd, 0.0, 'Tombstone finalBalanceUsd must be exactly 0.00');
    assert.ok(tombstone.deathTimestamp, 'Tombstone must contain deathTimestamp');
    assert.ok(Array.isArray(tombstone.finalLedgerSnapshot), 'Tombstone must include finalLedgerSnapshot');
    return tombstone;
  }

  public static assertTierInvariants(tier: MetabolicTier, balanceUsd: number): void {
    if (tier === 'VERDE') assert.ok(balanceUsd > 50.00);
    else if (tier === 'AMARELO') assert.ok(balanceUsd >= 10.00 && balanceUsd <= 50.00);
    else if (tier === 'LARANJA') assert.ok(balanceUsd > 0.00 && balanceUsd < 10.00);
    else if (tier === 'VERMELHO') assert.ok(balanceUsd <= 0.00);
  }
}
```

---

## 6. Coverage Thresholds & Pass/Fail Semantics

### 6.1 Strict Acceptance Thresholds
- **Test Pass Rate**: 100% (Strictly zero failures allowed across all tiers).
- **Exit Code**: Must return process exit code `0`.
- **Skipped / Pending Tests**: 0 skipped, 0 todo. Every designated requirement must be actively executed and asserted.
- **Flakiness Policy**: Any intermittent timing failure or race condition invalidates the test suite. All asynchronous loops must use explicit promises or completion callbacks rather than arbitrary `sleep` timeouts.
- **Resource Disposal**: Zero dangling HTTP servers, open file descriptors, or uncleared timers.

### 6.2 Execution Time Budget
| Suite | Target Duration | Hard Upper Timeout |
|-------|-----------------|--------------------|
| Tier 1 (Coverage, >=115 tests) | < 10 seconds | 30 seconds |
| Tier 2 (Boundaries, >=115 tests) | < 10 seconds | 30 seconds |
| Tier 3 (Interactions, >=25 tests) | < 15 seconds | 45 seconds |
| Tier 4 (Lifecycles, >=13 scenarios) | < 25 seconds | 60 seconds |
| Full E2E Suite (`npm run test:e2e`) | < 60 seconds | 120 seconds |

---

## 7. Migration & Compatibility with Existing Test Harnesses

### 7.1 Separation from Unit and Stress Suites
- `test/unit/` (Unit Tests): Fast micro-assertions verifying individual functions in isolation.
- `test/stress/` (Stress Tests): High-iteration adversarial fuzzing and empirical stress suites.
- `test/e2e/` (E2E Tests): System-level integration testing simulating end-to-end agent operations.
- The root command `npm test` continues to run all test suites (`test/**/*.test.ts`), while `npm run test:e2e` targets only the E2E suites.

---

## 8. Summary Checklist for Implementers (`teamwork_test_writer`)
- [ ] Create `test/e2e/fixtures/` and populate mock JSON files.
- [ ] Create `test/e2e/helpers/` and implement the 6 helper modules.
- [ ] Implement `test/e2e/tier1_features.test.ts` ($\ge 115$ test cases per `explorer_e2e_1` spec).
- [ ] Implement `test/e2e/tier2_boundaries.test.ts` ($\ge 115$ test cases per `explorer_e2e_1` spec).
- [ ] Implement `test/e2e/tier3_interactions.test.ts` ($\ge 25$ test cases per `explorer_e2e_2` spec).
- [ ] Implement `test/e2e/tier4_application.test.ts` ($\ge 13$ multi-step scenarios per `explorer_e2e_2` spec).
- [ ] Verify `npm run test:e2e` passes with 100% exit code 0.
- [ ] Publish `TEST_READY.md`.
