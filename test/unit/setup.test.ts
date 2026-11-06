/**
 * ==============================================================================
 * Milestone 1 Unit Tests: Canonical Setup, Config & Governance Verification
 * ==============================================================================
 * Test suite verifying:
 * 1. .env parsing and syntax edge cases
 * 2. Configuration loading and sensible defaults in 'mock' mode
 * 3. Network switching ('mock' -> 'testnet' -> 'mainnet') and error rejection
 * 4. Invariant enforcements (Quarter-Kelly, 5% bankroll cap, metabolic hierarchy)
 * 5. Existence and completeness of the 7 Articles in `src/constitution.md`
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  resetConfig,
  parseEnvFile,
  ConfigValidationError,
  DEFAULT_MOCK_PRIVATE_KEY,
  isValidAddress,
  isValidPrivateKey,
} from '../../src/config.ts';

describe('Milestone 1: Canonical Setup, Config & Governance Verification', () => {
  beforeEach(() => {
    resetConfig();
  });

  // ============================================================================
  // Suite 1: .env File Parsing Logic
  // ============================================================================
  describe('Suite 1: .env File Parsing Logic', () => {
    it('should parse standard KEY=value pairs', () => {
      const content = `
        NETWORK_MODE=mock
        INITIAL_CAPITAL_USD=50.00
        PORT_X402=4020
      `;
      const parsed = parseEnvFile(content);
      assert.equal(parsed.NETWORK_MODE, 'mock');
      assert.equal(parsed.INITIAL_CAPITAL_USD, '50.00');
      assert.equal(parsed.PORT_X402, '4020');
    });

    it('should ignore empty lines and comment lines', () => {
      const content = `
        # System Configuration
        NODE_ENV=development

        # Blockchain Config
        # BASE_RPC_URL=https://sepolia.base.org
        NETWORK_MODE=mock
      `;
      const parsed = parseEnvFile(content);
      assert.equal(parsed.NODE_ENV, 'development');
      assert.equal(parsed.NETWORK_MODE, 'mock');
      assert.equal(parsed.BASE_RPC_URL, undefined);
    });

    it('should strip surrounding single and double quotes', () => {
      const content = `
        STR_DOUBLE="hello world"
        STR_SINGLE='single quoted'
        UNQUOTED=no_quotes
      `;
      const parsed = parseEnvFile(content);
      assert.equal(parsed.STR_DOUBLE, 'hello world');
      assert.equal(parsed.STR_SINGLE, 'single quoted');
      assert.equal(parsed.UNQUOTED, 'no_quotes');
    });

    it('should strip inline comments for unquoted values', () => {
      const content = `
        PORT_X402=4020 # local port for paywall
        KELLY_FRACTION=0.25 # Quarter-Kelly multiplier
      `;
      const parsed = parseEnvFile(content);
      assert.equal(parsed.PORT_X402, '4020');
      assert.equal(parsed.KELLY_FRACTION, '0.25');
    });

    it('should handle export keyword prefix', () => {
      const content = `
        export NETWORK_MODE=mock
        export INITIAL_CAPITAL_USD=75.00
      `;
      const parsed = parseEnvFile(content);
      assert.equal(parsed.NETWORK_MODE, 'mock');
      assert.equal(parsed.INITIAL_CAPITAL_USD, '75.00');
    });
  });

  // ============================================================================
  // Suite 2: Default Config Loading in Mock Mode
  // ============================================================================
  describe('Suite 2: Default Config Loading in Mock Mode', () => {
    it('should load default configuration with networkMode mock', () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });

      assert.equal(config.networkMode, 'mock');
      assert.equal(config.network.isMock, true);
      assert.equal(config.mock.useMockApis, true);
    });

    it('should provide sensible defaults for all metabolic and risk parameters', () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });

      assert.equal(config.initialCapitalUsd, 50.0);
      assert.equal(config.tierThresholds.green, 50.0);
      assert.equal(config.tierThresholds.yellow, 10.0);
      assert.equal(config.tierThresholds.orange, 2.0);
      assert.equal(config.tierThresholds.red, 0.0);

      assert.equal(config.heartbeatIntervals.greenMs, 60000);
      assert.equal(config.heartbeatIntervals.yellowMs, 300000);
      assert.equal(config.heartbeatIntervals.orangeMs, 60000);

      assert.equal(config.kelly.fraction, 0.25);
      assert.equal(config.kelly.maxBankrollCap, 0.05);

      assert.equal(config.x402.port, 4020);
      assert.equal(config.x402.priceUsdc, 0.05);
      assert.equal(config.x402.settlementChain, 'base');

      assert.equal(config.evolution.mitosisMultiplier, 3.0);
      assert.equal(config.evolution.royaltyPercentage, 0.05);
    });

    it('should provide a valid fallback private key in mock mode', () => {
      const config = loadConfig({ NETWORK_MODE: 'mock' });

      assert.equal(config.privateKey, DEFAULT_MOCK_PRIVATE_KEY);
      assert.equal(isValidPrivateKey(config.privateKey), true);
    });

    it('should not throw if optional external API keys are omitted in mock mode', () => {
      assert.doesNotThrow(() => {
        loadConfig({
          NETWORK_MODE: 'mock',
          ANTHROPIC_API_KEY: undefined,
          OPENAI_API_KEY: undefined,
          GEMINI_API_KEY: undefined,
          GITHUB_TOKEN: undefined,
          POLYMARKET_API_KEY: undefined,
        });
      });
    });

    it('should allow custom overrides for financial parameters in mock mode', () => {
      const config = loadConfig({
        NETWORK_MODE: 'mock',
        INITIAL_CAPITAL_USD: '100.00',
        PORT_X402: '5000',
        MOCK_WALLET_BALANCE_USD: '150.00',
      });

      assert.equal(config.initialCapitalUsd, 100.0);
      assert.equal(config.x402.port, 5000);
      assert.equal(config.mock.initialBalanceUsd, 150.0);
    });
  });

  // ============================================================================
  // Suite 3: Multi-Network Switching & Validation
  // ============================================================================
  describe('Suite 3: Multi-Network Switching & Validation', () => {
    const validTestnetKey =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    const validMainnetKey =
      '0x2222222222222222222222222222222222222222222222222222222222222222';

    it('should throw ConfigValidationError in testnet mode if PRIVATE_KEY is missing', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'testnet',
            PRIVATE_KEY: '',
            AGENT_PRIVATE_KEY: '',
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Missing required environment variable: PRIVATE_KEY'));
          return true;
        }
      );
    });

    it('should configure Base Sepolia and Polygon Amoy when valid key is provided in testnet', () => {
      const config = loadConfig({
        NETWORK_MODE: 'testnet',
        PRIVATE_KEY: validTestnetKey,
      });

      assert.equal(config.networkMode, 'testnet');
      assert.equal(config.network.isMock, false);
      assert.equal(config.network.baseRpcUrl, 'https://sepolia.base.org');
      assert.equal(config.network.polygonRpcUrl, 'https://rpc-amoy.polygon.technology');
    });

    it('should throw ConfigValidationError in mainnet mode if PRIVATE_KEY is missing', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mainnet',
            PRIVATE_KEY: '',
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Missing required environment variable: PRIVATE_KEY'));
          return true;
        }
      );
    });

    it('should reject known mock/dummy private keys in mainnet mode', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mainnet',
            PRIVATE_KEY: DEFAULT_MOCK_PRIVATE_KEY,
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Mock/dummy private key cannot be used in mainnet'));
          return true;
        }
      );
    });

    it('should throw if USE_MOCK_APIS is enabled in mainnet mode', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mainnet',
            PRIVATE_KEY: validMainnetKey,
            USE_MOCK_APIS: 'true',
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('USE_MOCK_APIS cannot be enabled in mainnet'));
          return true;
        }
      );
    });

    it('should configure Base Mainnet and Polygon Mainnet in mainnet mode', () => {
      const config = loadConfig({
        NETWORK_MODE: 'mainnet',
        PRIVATE_KEY: validMainnetKey,
        USE_MOCK_APIS: 'false',
      });

      assert.equal(config.networkMode, 'mainnet');
      assert.equal(config.network.isMock, false);
      assert.equal(config.network.baseRpcUrl, 'https://mainnet.base.org');
      assert.equal(config.network.polygonRpcUrl, 'https://polygon-rpc.com');
      assert.equal(config.mock.useMockApis, false);
    });
  });

  // ============================================================================
  // Suite 4: Security & Validation Fail-Safes
  // ============================================================================
  describe('Suite 4: Security & Validation Fail-Safes', () => {
    it('should throw ConfigValidationError on unknown NETWORK_MODE', () => {
      assert.throws(
        () => {
          loadConfig({ NETWORK_MODE: 'invalid_mode' });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes("Invalid NETWORK_MODE: 'invalid_mode'"));
          return true;
        }
      );
    });

    it('should throw ConfigValidationError on malformed PRIVATE_KEY format', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'testnet',
            PRIVATE_KEY: '0xshort',
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Invalid PRIVATE_KEY format'));
          return true;
        }
      );
    });

    it('should throw ConfigValidationError on privileged or out-of-range PORT_X402', () => {
      // Privileged port (< 1024)
      assert.throws(
        () => {
          loadConfig({ NETWORK_MODE: 'mock', PORT_X402: '80' });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('PORT_X402 must be an unprivileged integer'));
          return true;
        }
      );

      // Out of range port (> 65535)
      assert.throws(
        () => {
          loadConfig({ NETWORK_MODE: 'mock', PORT_X402: '70000' });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('PORT_X402 must be an unprivileged integer'));
          return true;
        }
      );
    });

    it('should enforce Constitution Article II: MAX_BANKROLL_BET_PERCENT <= 0.05', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mock',
            MAX_BANKROLL_BET_PERCENT: '0.10', // 10% exceeds 5% cap
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('MAX_BANKROLL_BET_PERCENT cannot exceed 0.05 (5%)'));
          return true;
        }
      );
    });

    it('should throw ConfigValidationError on non-positive INITIAL_CAPITAL_USD', () => {
      assert.throws(
        () => {
          loadConfig({ NETWORK_MODE: 'mock', INITIAL_CAPITAL_USD: '-50.00' });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('INITIAL_CAPITAL_USD must be a positive number'));
          return true;
        }
      );
    });

    it('should throw ConfigValidationError on inverted metabolic thresholds', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mock',
            TIER_GREEN_THRESHOLD: '10.00',
            TIER_YELLOW_THRESHOLD: '50.00', // Green < Yellow is invalid
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Invalid metabolic thresholds hierarchy'));
          return true;
        }
      );
    });

    it('should throw ConfigValidationError on malformed MOTHER_WALLET_ADDRESS', () => {
      assert.throws(
        () => {
          loadConfig({
            NETWORK_MODE: 'mock',
            MOTHER_WALLET_ADDRESS: '0xinvalid_eth_address',
          });
        },
        (err: Error) => {
          assert(err instanceof ConfigValidationError);
          assert(err.message.includes('Invalid MOTHER_WALLET_ADDRESS format'));
          return true;
        }
      );
    });
  });

  // ============================================================================
  // Suite 5: Constitution Verification (src/constitution.md)
  // ============================================================================
  describe('Suite 5: Constitution Verification (src/constitution.md)', () => {
    const constitutionPath = path.resolve(process.cwd(), 'src/constitution.md');

    it('should verify that src/constitution.md exists and is non-empty', () => {
      assert(
        fs.existsSync(constitutionPath),
        `Expected constitution file to exist at: ${constitutionPath}`
      );
      const stat = fs.statSync(constitutionPath);
      assert(stat.size > 500, `Constitution file is unexpectedly small: ${stat.size} bytes`);
    });

    it('should verify that all 7 Articles exist in src/constitution.md', () => {
      const content = fs.readFileSync(constitutionPath, 'utf8');

      // Article I: Capital Sovereignty & Whitelist
      assert(
        content.includes('Article I'),
        'Constitution must contain Article I'
      );
      assert(
        /whitelist/i.test(content),
        'Article I must reference destination whitelist'
      );

      // Article II: Mathematical Risk Limits
      assert(
        content.includes('Article II'),
        'Constitution must contain Article II'
      );
      assert(
        /kelly/i.test(content),
        'Article II must mandate the Kelly Criterion'
      );
      assert(
        /5%|5\.0%|0\.05/.test(content),
        'Article II must enforce the 5% bankroll ceiling'
      );

      // Article III: Metabolic Tier Discipline
      assert(
        content.includes('Article III'),
        'Constitution must contain Article III'
      );
      assert(
        /Tier Verde/i.test(content) &&
          /Tier Amarelo/i.test(content) &&
          /Tier Laranja/i.test(content) &&
          /Tier Vermelho/i.test(content),
        'Article III must define all 4 metabolic tiers'
      );

      // Article IV: Permadeath Inviolability
      assert(
        content.includes('Article IV'),
        'Constitution must contain Article IV'
      );
      assert(
        /tombstone\.json/.test(content),
        'Article IV must mandate writing tombstone.json'
      );
      assert(
        /process\.exit\(0\)/.test(content),
        'Article IV must mandate process.exit(0)'
      );

      // Article V: Immune System Pre-Commit
      assert(
        content.includes('Article V'),
        'Constitution must contain Article V'
      );
      assert(
        /git reset --hard HEAD/.test(content),
        'Article V must mandate git reset --hard HEAD rollback'
      );

      // Article VI: Darwinian Mitosis & Clan Covenant
      assert(
        content.includes('Article VI'),
        'Constitution must contain Article VI'
      );
      assert(
        /3\s*[*×x]\s*|three times/i.test(content),
        'Article VI must mandate the 3x initial capital threshold'
      );
      assert(
        /5%|5\.0%/.test(content),
        'Article VI must mandate the 5% royalty to mother clan'
      );

      // Article VII: Immutability & Anti-Tamper
      assert(
        content.includes('Article VII'),
        'Constitution must contain Article VII'
      );
      assert(
        /immutable|anti-tamper/i.test(content),
        'Article VII must establish constitutional immutability'
      );
    });
  });
});
