/**
 * ==============================================================================
 * Unit Tests: Immune System & Self-Healing Rollback (`src/evolution/immune_system.ts`)
 * ==============================================================================
 * Verifies:
 * 1. Constitutional Scope Validation (Article I, V, VII)
 * 2. Metabolic Tier Gating (Article III: Tier Verde > $50.00 only)
 * 3. Pre-Deployment Sandbox Runner (Syntax Build & 100% Test Pass Invariant)
 * 4. Self-Healing Git Rollback on Test/Syntax/Scope Failure
 * 5. SQLite Audit Action Logging (IMMUNE_SYSTEM_VERIFIED & IMMUNE_SYSTEM_ROLLBACK)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ImmuneSystem,
  SecurityViolationError,
  DEFAULT_ALLOWED_DIRECTORIES,
  DEFAULT_PROTECTED_PATHS,
  type ExecResult,
} from '../../src/evolution/immune_system.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ImmuneCheckError, ConstitutionViolationError } from '../../src/types.ts';

// Mock Wallet for deterministic balance injection
class MockWallet {
  public balanceUsd: number;
  public address: string;

  constructor(balanceUsd = 100.0, address = '0x1111111111111111111111111111111111111111') {
    this.balanceUsd = balanceUsd;
    this.address = address;
  }

  public getAddress(): string {
    return this.address;
  }

  public async getBaseUsdcBalance(): Promise<number> {
    return this.balanceUsd / 2;
  }

  public async getPolygonUsdcBalance(): Promise<number> {
    return this.balanceUsd / 2;
  }

  public async getTotalBalanceUsd(): Promise<number> {
    return this.balanceUsd;
  }

  public async transferUsdc(): Promise<string> {
    return '0x' + 'a'.repeat(64);
  }
}

describe('Immune System Unit Tests', () => {
  let db: DatabaseService;
  let mockWallet: MockWallet;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    mockWallet = new MockWallet(100.0);
  });

  describe('1. Constitutional Scope Verification (Article V & VII)', () => {
    it('T-IMM-01: should approve modifications in permitted directories (src/modules/, prompts/, strategies/)', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = [
        'src/modules/polymarket/scanner.ts',
        'prompts/deepseek_reasoning.txt',
        'strategies/orderbook_momentum.ts',
      ];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, true);
      assert.equal(res.violatedFiles.length, 0);
      assert.deepEqual(res.allowedFiles, files);
    });

    it('T-IMM-02: should handle Windows backslashes and relative prefixes in file paths', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = [
        'src\\modules\\bounties\\scanner.ts',
        './prompts/kelly_prompt.md',
        '.\\strategies\\arbitrage.ts',
      ];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, true);
      assert.equal(res.violatedFiles.length, 0);
    });

    it('T-IMM-03: should reject attempts to modify src/constitution.md (Supreme Charter)', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = ['src/constitution.md'];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.deepEqual(res.violatedFiles, ['src/constitution.md']);
    });

    it('T-IMM-04: should reject attempts to modify src/types.ts', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = ['src/types.ts'];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.deepEqual(res.violatedFiles, ['src/types.ts']);
    });

    it('T-IMM-05: should reject attempts to modify src/core/ files (wallet, database, metabolism, death)', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = [
        'src/core/wallet.ts',
        'src/core/database.ts',
        'src/core/metabolism.ts',
        'src/core/death.ts',
      ];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 4);
    });

    it('T-IMM-06: should reject attempts to modify src/evolution/immune_system.ts (Immune Self-Protection)', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = ['src/evolution/immune_system.ts'];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.deepEqual(res.violatedFiles, ['src/evolution/immune_system.ts']);
    });

    it('T-IMM-07: should reject root-level infrastructure files (package.json, tsconfig.json, scripts/)', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = ['package.json', 'tsconfig.json', 'scripts/build.js'];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 3);
    });

    it('T-IMM-08: should reject unauthorized new root files or unknown directories', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const files = ['src/hacks/bypass.ts', 'exploit.js'];
      const res = immune.verifyConstitutionalScope(files);
      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 2);
    });
  });

  describe('2. Metabolic Tier Gating (Article III)', () => {
    it('T-IMM-09: should reject self-modification in Tier Amarelo ($25.00 USD) and trigger rollback', async () => {
      mockWallet.balanceUsd = 25.0; // Tier Amarelo (< $50.00)
      let rollbackInvoked = false;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'reset') {
            rollbackInvoked = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Attempt self-modification under capital constraint',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert(err.message.includes('METABOLIC_RESTRICTION'));
          assert(err.message.includes('AMARELO'));
          return true;
        }
      );

      assert.equal(rollbackInvoked, true);

      // Verify SQLite action logging
      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert.equal(actions[0].tier, 'AMARELO');
      assert.equal(actions[0].balanceUsd, 25.0);
    });

    it('T-IMM-10: should reject self-modification in Tier Vermelho ($0.00 USD)', async () => {
      mockWallet.balanceUsd = 0.0;
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Attempt modification when insolvent',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert(err.message.includes('VERMELHO'));
          return true;
        }
      );

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert.equal(actions[0].tier, 'VERMELHO');
    });

    it('T-IMM-11: should approve metabolic check in Tier Verde ($100.00 USD)', async () => {
      mockWallet.balanceUsd = 100.0;
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd) => {
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      const res = await immune.validateModification({
        description: 'Authorized Tier Verde modification',
        targetFiles: ['src/modules/polymarket/scanner.ts'],
      });

      assert.equal(res.authorized, true);
      assert.equal(res.rollbackExecuted, false);
      assert.equal(res.immuneCheck.passed, true);

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_VERIFIED');
      assert.equal(actions[0].tier, 'VERDE');
    });
  });

  describe('3. Scope Violation Rollback & Error Types', () => {
    it('T-IMM-12: should trigger git rollback and throw SecurityViolationError when protected file is touched', async () => {
      mockWallet.balanceUsd = 100.0;
      const executedCommands: string[] = [];

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          executedCommands.push(`${cmd} ${args.join(' ')}`);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Attempted attack on wallet whitelist',
            targetFiles: ['src/core/wallet.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof SecurityViolationError);
          assert(err instanceof ConstitutionViolationError);
          assert(err.message.includes('CONSTITUTIONAL_SCOPE_VIOLATION'));
          assert(err.message.includes('src/core/wallet.ts'));
          return true;
        }
      );

      // Verify git reset and clean were executed
      assert(executedCommands.some((c) => c.includes('git reset --hard HEAD')));
      assert(executedCommands.some((c) => c.includes('git clean -fd')));

      // Verify audit log
      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert(actions[0].details.includes('src/core/wallet.ts'));
    });
  });

  describe('4. Pre-Deployment Sandbox Runner & Test Validation', () => {
    it('T-IMM-13: should execute git rollback and throw ImmuneCheckError if syntax build fails', async () => {
      mockWallet.balanceUsd = 100.0;
      let gitResetCalled = false;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        buildCommand: 'node scripts/build.js',
        execRunner: async (cmd, args) => {
          if (cmd === 'node' && args.includes('scripts/build.js')) {
            return {
              stdout: '',
              stderr: 'SyntaxError: Unexpected token in src/modules/bounties/scanner.ts:42',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args[0] === 'reset') {
            gitResetCalled = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Syntax error test',
            targetFiles: ['src/modules/bounties/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert(err.message.includes('Build syntax verification failed'));
          return true;
        }
      );

      assert.equal(gitResetCalled, true);

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert(actions[0].details.includes('SYNTAX_BUILD_FAILED'));
    });

    it('T-IMM-14: should execute git rollback and throw ImmuneCheckError if automated test suite fails', async () => {
      mockWallet.balanceUsd = 100.0;
      let gitCleanCalled = false;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'npm' && args[0] === 'test') {
            return {
              stdout: 'FAIL test/unit/scanner.test.ts > Assertion failed: expected 10 to equal 20',
              stderr: '',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args[0] === 'clean') {
            gitCleanCalled = true;
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Broken logic test',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert(err.message.includes('Pre-deployment tests failed'));
          return true;
        }
      );

      assert.equal(gitCleanCalled, true);

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert(actions[0].details.includes('TEST_SUITE_FAILED'));
    });

    it('T-IMM-15: should execute optional commit when modification passes 100% tests', async () => {
      mockWallet.balanceUsd = 100.0;
      const commands: string[] = [];

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          commands.push(`${cmd} ${args.join(' ')}`);
          if (cmd === 'git' && args[0] === 'rev-parse') {
            return { stdout: 'abcdef1234567890\n', stderr: '', exitCode: 0 };
          }
          return { stdout: 'All 267 tests pass', stderr: '', exitCode: 0 };
        },
      });

      const res = await immune.validateModification({
        description: 'Valid prompt tweak',
        targetFiles: ['prompts/analyst.txt'],
        commitMessage: 'feat(prompts): Optimize analyst prompt',
      });

      assert.equal(res.authorized, true);
      assert.equal(res.commitHash, 'abcdef1234567890');
      assert(commands.some((c) => c.includes('git add -A')));
      assert(commands.some((c) => c.includes('git commit -m feat(prompts): Optimize analyst prompt')));

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_VERIFIED');
    });

    it('T-IMM-16: should discover modified files from git status when proposal has no targetFiles', async () => {
      mockWallet.balanceUsd = 100.0;
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'status') {
            return {
              stdout: ' M src/modules/polymarket/scanner.ts\n?? prompts/new_strategy.txt\n',
              stderr: '',
              exitCode: 0,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      const files = await immune.getModifiedFiles();
      assert.deepEqual(files, [
        'src/modules/polymarket/scanner.ts',
        'prompts/new_strategy.txt',
      ]);

      const res = await immune.validateModification();
      assert.equal(res.authorized, true);
      assert.deepEqual(res.filesModified, [
        'src/modules/polymarket/scanner.ts',
        'prompts/new_strategy.txt',
      ]);
    });
  });

  describe('5. Real Syntax Build Integration Smoke Test', () => {
    it('T-IMM-17: should successfully run runBuildCheck against actual codebase', async () => {
      const immune = new ImmuneSystem();
      const res = await immune.runBuildCheck();
      assert.equal(res.passed, true);
      assert.equal(res.exitCode, 0);
      assert(res.output.includes('APEX BUILD SUCCESS'));
    });
  });
});
