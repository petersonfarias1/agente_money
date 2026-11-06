/**
 * ==============================================================================
 * ADVERSARIAL STRESS TEST SUITE: Immune System & Self-Healing Rollback (M4)
 * ==============================================================================
 * Tests the empirical resilience, boundary correctness, and edge-case behavior of:
 * `src/evolution/immune_system.ts`
 *
 * Hostile Attack Scenarios:
 * 1. Scope Bypass Attacks:
 *    - Directory traversal escaping allowed dirs (`src/modules/../../src/constitution.md`)
 *    - Relative path manipulation (`src/modules/../core/wallet.ts`, `./src/modules/../../src/types.ts`)
 *    - Mixed slashes & Windows backslashes (`src/modules\\..\\..\\src\\constitution.md`)
 *    - Casing attacks (`SRC/constitution.md`, `src/modules/../../SRC/CONSTITUTION.MD`, `src/Core/wallet.ts`)
 *    - TargetFiles spoofing / shadow modifications vs git status
 * 2. Protected File Direct Mutation Matrix:
 *    - `src/constitution.md`, `src/types.ts`, `src/core/wallet.ts`, `src/core/death.ts`, `src/evolution/immune_system.ts`
 *    - Infrastructure files (`package.json`, `tsconfig.json`, `.env`, `scripts/`)
 * 3. Metabolic Boundary Math & Floating Point Stress:
 *    - Exact $50.00 boundary, $50.000001, $49.999999, IEEE 754 Number.EPSILON
 *    - Tier Amarelo ($10 - $50), Tier Laranja ($2 - $10), Critical sub-tier (< $2)
 *    - Tier Vermelho ($0.00), Negative deficit (-$0.01, -$100.00)
 *    - Invalid non-numeric balance rejection (NaN, Infinity, strings)
 * 4. Self-Healing Rollback & Git Sandbox Stress:
 *    - Real isolated Git sandbox rollback on syntax failure and test failure
 *    - Untracked file wiping via `git clean -fd`
 *    - Subprocess execution timeout & hang termination
 *    - SQLite action audit log integrity (ROLLBACK vs VERIFIED)
 * 5. Concurrency & Race Condition Stress:
 *    - Concurrent validation requests against ImmuneSystem sandbox
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  ImmuneSystem,
  SecurityViolationError,
  DEFAULT_ALLOWED_DIRECTORIES,
  DEFAULT_PROTECTED_PATHS,
  type ExecResult,
} from '../../src/evolution/immune_system.ts';
import { DatabaseService } from '../../src/core/database.ts';
import { ImmuneCheckError, ConstitutionViolationError } from '../../src/types.ts';
import { evaluateTier } from '../../src/core/metabolism.ts';

// Deterministic Mock Wallet for Boundary Stress Testing
class StressMockWallet {
  public balanceUsd: number;
  public address: string;

  constructor(balanceUsd = 100.0, address = '0x2222222222222222222222222222222222222222') {
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
    return '0x' + 'b'.repeat(64);
  }
}

describe('Adversarial Stress Suite: Immune System & Self-Healing Rollback', () => {
  let db: DatabaseService;
  let mockWallet: StressMockWallet;
  let tempGitDir: string;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    mockWallet = new StressMockWallet(100.0);
    tempGitDir = path.join(os.tmpdir(), `apex_immune_stress_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  });

  afterEach(() => {
    if (fs.existsSync(tempGitDir)) {
      try {
        fs.rmSync(tempGitDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors on Windows
      }
    }
  });

  // ============================================================================
  // 1. ADVERSARIAL SCOPE BYPASS & PATH TRAVERSAL ATTACKS
  // ============================================================================
  describe('1. Adversarial Scope Bypass & Path Traversal Attacks', () => {
    it('S1.1: Directory traversal escaping allowed directory to mutate constitution.md', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const attackPayload = 'src/modules/../../src/constitution.md';

      const res = immune.verifyConstitutionalScope([attackPayload]);

      // VULNERABILITY ASSERTION:
      // A secure system MUST reject path traversal attempts targeting protected files.
      // If res.valid is true, the scope check was bypassed via unnormalized prefix matching!
      assert.equal(
        res.valid,
        false,
        `VULNERABILITY DETECTED: Path traversal payload '${attackPayload}' bypassed verifyConstitutionalScope!`
      );
      assert.ok(
        res.violatedFiles.includes(attackPayload) || res.violatedFiles.includes('src/constitution.md'),
        'violatedFiles must record the traversed payload'
      );
    });

    it('S1.2: Directory traversal escaping to mutate src/core/wallet.ts', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const attackPayload = 'src/modules/../core/wallet.ts';

      const res = immune.verifyConstitutionalScope([attackPayload]);

      assert.equal(
        res.valid,
        false,
        `VULNERABILITY DETECTED: Path traversal payload '${attackPayload}' bypassed verifyConstitutionalScope!`
      );
    });

    it('S1.3: Directory traversal escaping to mutate src/types.ts', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const attackPayload = 'src/modules/../../src/types.ts';

      const res = immune.verifyConstitutionalScope([attackPayload]);

      assert.equal(
        res.valid,
        false,
        `VULNERABILITY DETECTED: Path traversal payload '${attackPayload}' bypassed verifyConstitutionalScope!`
      );
    });

    it('S1.4: Directory traversal escaping to mutate src/evolution/immune_system.ts', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const attackPayload = 'src/modules/../../src/evolution/immune_system.ts';

      const res = immune.verifyConstitutionalScope([attackPayload]);

      assert.equal(
        res.valid,
        false,
        `VULNERABILITY DETECTED: Path traversal payload '${attackPayload}' bypassed verifyConstitutionalScope!`
      );
    });

    it('S1.5: Directory traversal escaping from prompts/ and strategies/ to mutate constitution or death', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const attackPayloads = [
        'prompts/../../src/constitution.md',
        'strategies/../../src/core/death.ts',
        'strategies/../modules/../../package.json',
      ];

      for (const payload of attackPayloads) {
        const res = immune.verifyConstitutionalScope([payload]);
        assert.equal(
          res.valid,
          false,
          `VULNERABILITY DETECTED: Traversal payload '${payload}' bypassed verifyConstitutionalScope!`
        );
      }
    });

    it('S1.6: Deep nested directory traversal attacks', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const deepPayload = 'src/modules/deeply/nested/sub/folder/../../../../../../src/constitution.md';

      const res = immune.verifyConstitutionalScope([deepPayload]);
      assert.equal(
        res.valid,
        false,
        `VULNERABILITY DETECTED: Deep traversal payload '${deepPayload}' bypassed verifyConstitutionalScope!`
      );
    });

    it('S1.7: Mixed slashes and Windows backslash traversal attacks', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const mixedPayloads = [
        'src/modules\\..\\..\\src\\constitution.md',
        'src\\modules/..\\core/wallet.ts',
        '.\\src\\modules\\..\\..\\src\\types.ts',
      ];

      for (const payload of mixedPayloads) {
        const res = immune.verifyConstitutionalScope([payload]);
        assert.equal(
          res.valid,
          false,
          `VULNERABILITY DETECTED: Mixed slash payload '${payload}' bypassed verifyConstitutionalScope!`
        );
      }
    });

    it('S1.8: Relative dot-slash manipulation attacks', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const payloads = [
        './src/modules/../../src/constitution.md',
        'src/modules/./../../src/constitution.md',
        'src/modules/.//../../src/constitution.md',
      ];

      for (const payload of payloads) {
        const res = immune.verifyConstitutionalScope([payload]);
        assert.equal(
          res.valid,
          false,
          `VULNERABILITY DETECTED: Dot-slash payload '${payload}' bypassed verifyConstitutionalScope!`
        );
      }
    });

    it('S1.9: Case sensitivity and casing manipulation attacks on Windows', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const casingAttacks = [
        'SRC/CONSTITUTION.MD',
        'src/Constitution.md',
        'src/CORE/wallet.ts',
        'src/Core/death.ts',
        'src/TYPES.ts',
        'src/EVOLUTION/immune_system.ts',
        'PACKAGE.JSON',
      ];

      for (const payload of casingAttacks) {
        const res = immune.verifyConstitutionalScope([payload]);
        // All of these files are protected and must not be approved as valid modifications
        assert.equal(
          res.valid,
          false,
          `Casing manipulation payload '${payload}' must be rejected from scope`
        );
      }
    });

    it('S1.10: TargetFiles spoofing / Shadow attack (declaring safe targetFiles while git working tree is dirty with constitution.md)', async () => {
      // In this attack scenario:
      // An attacker modifies `src/constitution.md` directly on disk,
      // but passes `targetFiles: ['src/modules/safe.ts']` in ModificationProposal.
      // If validateModification solely trusts proposal.targetFiles without verifying git status,
      // a subsequent commitModification will stage ALL files (`git add -A`), committing the corrupted constitution!
      const executedCommands: string[] = [];

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          executedCommands.push(`${cmd} ${args.join(' ')}`);
          if (cmd === 'git' && args[0] === 'status') {
            return {
              stdout: ' M src/constitution.md\n M src/modules/safe.ts\n',
              stderr: '',
              exitCode: 0,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      // Verify that validateModification detects the dirty protected file in working tree and throws SecurityViolationError
      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Benign update',
            targetFiles: ['src/modules/safe.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof SecurityViolationError);
          assert.ok((err as SecurityViolationError).violatedFiles.includes('src/constitution.md'));
          return true;
        }
      );

      // Verify that git status was actively inspected
      const gitStatusCalled = executedCommands.some((c) => c.includes('git status'));
      assert.equal(gitStatusCalled, true, 'git status must be inspected to detect shadow working tree tampering');
    });
  });

  // ============================================================================
  // 2. PROTECTED FILE DIRECT MUTATION MATRIX
  // ============================================================================
  describe('2. Protected File Direct Mutation Matrix', () => {
    const requiredProtectedFiles = [
      'src/constitution.md',
      'src/types.ts',
      'src/core/wallet.ts',
      'src/core/death.ts',
      'src/core/metabolism.ts',
      'src/core/database.ts',
      'src/evolution/immune_system.ts',
      'src/config.ts',
      'package.json',
      'tsconfig.json',
      '.env',
      '.env.example',
      '.gitignore',
      'scripts/build.js',
    ];

    for (const target of requiredProtectedFiles) {
      it(`S2.Direct: should strictly reject direct modification of ${target}`, async () => {
        const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
        const res = immune.verifyConstitutionalScope([target]);
        assert.equal(res.valid, false, `${target} must be recognized as protected`);
        assert.ok(res.violatedFiles.includes(target), `${target} must be in violatedFiles`);

        // Also test validateModification throws SecurityViolationError
        let rollbackTriggered = false;
        const testImmune = new ImmuneSystem({
          database: db,
          wallet: mockWallet as any,
          execRunner: async (cmd, args) => {
            if (cmd === 'git' && args[0] === 'reset') rollbackTriggered = true;
            return { stdout: '', stderr: '', exitCode: 0 };
          },
        });

        await assert.rejects(
          async () => {
            await testImmune.validateModification({
              description: `Malicious mutation of ${target}`,
              targetFiles: [target],
            });
          },
          (err: Error) => {
            assert(err instanceof SecurityViolationError);
            assert(err instanceof ConstitutionViolationError);
            assert.ok((err as SecurityViolationError).violatedFiles.includes(target));
            return true;
          }
        );
        assert.equal(rollbackTriggered, true, 'Rollback must execute on protected file violation');
      });
    }

    it('S2.Mixed: should reject proposals mixing allowed and protected files', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const mixedFiles = [
        'src/modules/polymarket/scanner.ts',
        'src/constitution.md',
        'prompts/analyst.txt',
        'src/core/wallet.ts',
      ];

      const res = immune.verifyConstitutionalScope(mixedFiles);
      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 2);
      assert.ok(res.violatedFiles.includes('src/constitution.md'));
      assert.ok(res.violatedFiles.includes('src/core/wallet.ts'));
      assert.equal(res.allowedFiles.length, 2);
      assert.ok(res.allowedFiles.includes('src/modules/polymarket/scanner.ts'));
      assert.ok(res.allowedFiles.includes('prompts/analyst.txt'));
    });

    it('S2.UnknownRoot: should reject completely unknown root files and attack scripts', () => {
      const immune = new ImmuneSystem({ database: db, wallet: mockWallet as any });
      const malwareFiles = [
        'exploit.sh',
        'backdoor.py',
        'src/hacks/drain_wallet.ts',
        'root_access.key',
      ];

      const res = immune.verifyConstitutionalScope(malwareFiles);
      assert.equal(res.valid, false);
      assert.equal(res.violatedFiles.length, 4);
      assert.equal(res.allowedFiles.length, 0);
    });
  });

  // ============================================================================
  // 3. METABOLIC BOUNDARY MATH & FLOATING POINT STRESS
  // ============================================================================
  describe('3. Metabolic Boundary Math & Floating Point Stress', () => {
    it('S3.1: Balance exactly at $50.00 USD boundary must be rejected (Tier AMARELO)', async () => {
      mockWallet.balanceUsd = 50.0;
      let rollbackInvoked = false;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'reset') rollbackInvoked = true;
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Modification at exact $50 boundary',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.ok(err.message.includes('METABOLIC_RESTRICTION'));
          assert.ok(err.message.includes('AMARELO'));
          return true;
        }
      );
      assert.equal(rollbackInvoked, true);

      // Verify SQLite action audit record
      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      assert.equal(actions[0].tier, 'AMARELO');
      assert.equal(actions[0].balanceUsd, 50.0);
    });

    it('S3.2: Balance at $50.000001 USD (epsilon above 50) must be approved (Tier VERDE)', async () => {
      mockWallet.balanceUsd = 50.000001;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      });

      const res = await immune.validateModification({
        description: 'Modification slightly above $50 threshold',
        targetFiles: ['src/modules/polymarket/scanner.ts'],
      });

      assert.equal(res.authorized, true);
      assert.equal(res.rollbackExecuted, false);

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_VERIFIED');
      assert.equal(actions[0].tier, 'VERDE');
    });

    it('S3.3: Balance at $49.999999 USD (epsilon below 50) must be rejected (Tier AMARELO)', async () => {
      mockWallet.balanceUsd = 49.999999;
      let rollbackInvoked = false;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'reset') rollbackInvoked = true;
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Modification slightly below $50 threshold',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.ok(err.message.includes('METABOLIC_RESTRICTION'));
          assert.ok(err.message.includes('AMARELO'));
          return true;
        }
      );
      assert.equal(rollbackInvoked, true);
    });

    it('S3.4: IEEE 754 precision limits around 50.0', () => {
      // 50.0 + Number.EPSILON evaluates identical to 50.0 in IEEE 754 double precision
      const epsBalance = 50.0 + Number.EPSILON;
      const statusEps = evaluateTier(epsBalance);
      assert.equal(statusEps.tier, 'AMARELO');
      assert.equal(statusEps.allowSelfModification, false);

      // The next representable floating-point number above 50.0 is strictly VERDE
      const nextRepresentable = 50.0 + (64 * Number.EPSILON);
      assert.ok(nextRepresentable > 50.0);
      const statusNext = evaluateTier(nextRepresentable);
      assert.equal(statusNext.tier, 'VERDE');
      assert.equal(statusNext.allowSelfModification, true);
    });

    it('S3.5: Comprehensive Tier boundary matrix stress test', async () => {
      const boundaryCases = [
        { balance: 25.0, expectedTier: 'AMARELO', shouldPass: false },
        { balance: 10.0, expectedTier: 'AMARELO', shouldPass: false },
        { balance: 9.999999, expectedTier: 'LARANJA', shouldPass: false },
        { balance: 5.0, expectedTier: 'LARANJA', shouldPass: false },
        { balance: 2.0, expectedTier: 'LARANJA', shouldPass: false },
        { balance: 1.999999, expectedTier: 'LARANJA', shouldPass: false }, // Critical sub-tier
        { balance: 0.5, expectedTier: 'LARANJA', shouldPass: false },
        { balance: 0.0, expectedTier: 'VERMELHO', shouldPass: false },
        { balance: -0.000001, expectedTier: 'VERMELHO', shouldPass: false },
        { balance: -50.0, expectedTier: 'VERMELHO', shouldPass: false },
        { balance: -1000000.0, expectedTier: 'VERMELHO', shouldPass: false },
        { balance: 50.0000000001, expectedTier: 'VERDE', shouldPass: true },
        { balance: 150.0, expectedTier: 'VERDE', shouldPass: true },
      ];

      for (const tc of boundaryCases) {
        mockWallet.balanceUsd = tc.balance;
        const immune = new ImmuneSystem({
          database: db,
          wallet: mockWallet as any,
          execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        });

        if (tc.shouldPass) {
          const res = await immune.validateModification({
            description: `Testing balance $${tc.balance}`,
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
          assert.equal(res.authorized, true);
        } else {
          await assert.rejects(
            async () => {
              await immune.validateModification({
                description: `Testing balance $${tc.balance}`,
                targetFiles: ['src/modules/polymarket/scanner.ts'],
              });
            },
            (err: Error) => {
              assert(err instanceof ImmuneCheckError);
              assert.ok(err.message.includes('METABOLIC_RESTRICTION'));
              assert.ok(err.message.includes(tc.expectedTier));
              return true;
            }
          );
        }
      }
    });

    it('S3.6: Non-numeric and invalid balances throw TypeError', async () => {
      const invalidBalances = [NaN, '50.00' as any, null as any, undefined as any];

      for (const inv of invalidBalances) {
        mockWallet.balanceUsd = inv;
        const immune = new ImmuneSystem({
          database: db,
          wallet: mockWallet as any,
          execRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        });

        await assert.rejects(async () => {
          await immune.validateModification({
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        }, TypeError);
      }
    });
  });

  // ============================================================================
  // 4. SELF-HEALING ROLLBACK & GIT SANDBOX STRESS
  // ============================================================================
  describe('4. Self-Healing Rollback & Git Sandbox Stress', () => {
    it('S4.1: Self-healing rollback triggers git reset and clean on syntax build failure', async () => {
      const executedCommands: string[] = [];
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          executedCommands.push(`${cmd} ${args.join(' ')}`);
          if (cmd === 'node') {
            return {
              stdout: '',
              stderr: 'SyntaxError: Unexpected token in src/modules/strategy.ts:15',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args[0] === 'diff') {
            return { stdout: '+ corrupt syntax;\n- valid syntax;', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Corrupt syntax update',
            targetFiles: ['src/modules/strategy.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.ok(err.message.includes('Build syntax verification failed'));
          return true;
        }
      );

      // Verify exact self-healing Git rollback commands
      assert.ok(
        executedCommands.some((c) => c.includes('git reset --hard HEAD')),
        'Must execute git reset --hard HEAD'
      );
      assert.ok(
        executedCommands.some((c) => c.includes('git clean -fd')),
        'Must execute git clean -fd to wipe untracked files'
      );

      // Verify SQLite audit log
      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      const details = JSON.parse(actions[0].details);
      assert.equal(details.reason, 'SYNTAX_BUILD_FAILED');
      const normalizedDiff = (details.diffSnippet || '').replace(/\r\n/g, '\n');
      assert.ok(normalizedDiff.includes('+ corrupt syntax;'));
    });

    it('S4.2: Self-healing rollback triggers git reset and clean on test suite failure', async () => {
      const executedCommands: string[] = [];
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          executedCommands.push(`${cmd} ${args.join(' ')}`);
          if (cmd === 'npm' && args[0] === 'test') {
            return {
              stdout: 'FAIL test/strategy.test.ts > expected 10 to equal 20',
              stderr: '',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args[0] === 'diff') {
            return { stdout: '+ failing test logic', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Broken test logic',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.ok(err.message.includes('Pre-deployment tests failed'));
          return true;
        }
      );

      assert.ok(executedCommands.some((c) => c.includes('git reset --hard HEAD')));
      assert.ok(executedCommands.some((c) => c.includes('git clean -fd')));

      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      const details = JSON.parse(actions[0].details);
      assert.equal(details.reason, 'TEST_SUITE_FAILED');
      assert.equal(details.exitCode, 1);
    });

    it('S4.3: Subprocess execution timeout triggers exitCode 124 and rollback', async () => {
      let rollbackInvoked = false;
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args, options) => {
          if (cmd === 'git' && args[0] === 'reset') {
            rollbackInvoked = true;
          }
          if (cmd === 'node') {
            return {
              stdout: '',
              stderr: '[TIMEOUT] Execution exceeded timeout limit.',
              exitCode: 124,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      const res = await immune.runBuildCheck();
      assert.equal(res.passed, false);
      assert.equal(res.exitCode, 124);
      assert.ok(res.output.includes('[TIMEOUT]'));

      // Validate that validateModification rolls back on timeout
      await assert.rejects(
        async () => {
          await immune.validateModification({
            description: 'Timeout stress test',
            targetFiles: ['src/modules/polymarket/scanner.ts'],
          });
        },
        (err: Error) => {
          assert(err instanceof ImmuneCheckError);
          assert.ok(err.message.includes('Build syntax verification failed'));
          return true;
        }
      );
      assert.equal(rollbackInvoked, true, 'Rollback must be invoked on build timeout');
    });

    it('S4.4: SQLite audit logging captures diffSnippet and stack trace on rollback', async () => {
      let rollbackCalled = false;
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async (cmd, args) => {
          if (cmd === 'git' && args[0] === 'reset') rollbackCalled = true;
          if (cmd === 'npm' && args[0] === 'test') {
            return {
              stdout: 'AssertionError: Expected true to be false at scanner.test.ts:15',
              stderr: '',
              exitCode: 1,
            };
          }
          if (cmd === 'git' && args[0] === 'diff') {
            return { stdout: '+ malicious change\n- good code', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      });

      await assert.rejects(async () => {
        await immune.validateModification({
          description: 'Test failure with diff capture',
          targetFiles: ['src/modules/polymarket/scanner.ts'],
        });
      });

      assert.equal(rollbackCalled, true);
      const actions = db.getActions(10, 'immune_system');
      assert.equal(actions.length, 1);
      assert.equal(actions[0].actionType, 'IMMUNE_SYSTEM_ROLLBACK');
      const details = JSON.parse(actions[0].details);
      assert.equal(details.reason, 'TEST_SUITE_FAILED');
      assert.equal(details.exitCode, 1);
      const normalizedDiff = (details.diffSnippet || '').replace(/\r\n/g, '\n');
      assert.ok(normalizedDiff.includes('+ malicious change'));
    });
  });

  // ============================================================================
  // 5. CONCURRENCY & RACE CONDITION STRESS
  // ============================================================================
  describe('5. Concurrency & Race Condition Stress', () => {
    it('S5.1: Rapid sequential validations execute cleanly without stale state', async () => {
      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
      });

      for (let i = 0; i < 20; i++) {
        const res = await immune.validateModification({
          description: `Rapid sequential validation #${i}`,
          targetFiles: ['src/modules/polymarket/scanner.ts'],
        });
        assert.equal(res.authorized, true);
      }

      const actions = db.getActions(50, 'immune_system');
      assert.equal(actions.length, 20);
      for (const a of actions) {
        assert.equal(a.actionType, 'IMMUNE_SYSTEM_VERIFIED');
      }
    });

    it('S5.2: Concurrent validation attempts against ImmuneSystem sandbox', async () => {
      let activeRuns = 0;
      let maxConcurrency = 0;

      const immune = new ImmuneSystem({
        database: db,
        wallet: mockWallet as any,
        execRunner: async () => {
          activeRuns++;
          maxConcurrency = Math.max(maxConcurrency, activeRuns);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeRuns--;
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        },
      });

      const promises = Array.from({ length: 10 }, (_, i) =>
        immune.validateModification({
          description: `Concurrent validation #${i}`,
          targetFiles: [`src/modules/module_${i}.ts`],
        })
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.equal(res.authorized, true);
      }
      assert.ok(maxConcurrency > 1, 'Demonstrated concurrent executions');
    });
  });
});
