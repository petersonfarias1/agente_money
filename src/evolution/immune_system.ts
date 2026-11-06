/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Immune System & Self-Healing Rollback
 * ==============================================================================
 * Enforces Article III, Article V, and Article VII of the Constitution:
 * - Pre-deployment test validation sandbox before committing self-modifications
 * - 100% test pass invariant (zero failures, zero timeouts)
 * - Constitutional scope verification (whitelist: src/modules/, prompts/, strategies/)
 * - Structurally immutable protection of constitution.md, types.ts, core/*, immune_system.ts
 * - Instant self-healing rollback via `git reset --hard HEAD && git clean -fd`
 * - Persistent audit logging in SQLite actions (IMMUNE_SYSTEM_VERIFIED / ROLLBACK)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DatabaseService } from '../core/database.ts';
import { getDatabase } from '../core/database.ts';
import type { WalletClient, ImmuneCheckResult } from '../types.ts';
import { ImmuneCheckError, ConstitutionViolationError } from '../types.ts';
import { getWallet } from '../core/wallet.ts';
import { evaluateTier } from '../core/metabolism.ts';

// ==============================================================================
// 1. Constants & Default Paths
// ==============================================================================

export const DEFAULT_ALLOWED_DIRECTORIES: readonly string[] = [
  'src/modules/',
  'prompts/',
  'strategies/',
];

export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  'src/constitution.md',
  'src/types.ts',
  'src/core/',
  'src/evolution/immune_system.ts',
  'src/config.ts',
  'package.json',
  'tsconfig.json',
  '.env',
  '.env.example',
  '.gitignore',
  'scripts/',
];

// ==============================================================================
// 2. Custom Error Classes & Interfaces
// ==============================================================================

/**
 * Thrown when proposed modifications violate constitutional scope boundaries.
 */
export class SecurityViolationError extends ConstitutionViolationError {
  public readonly violatedFiles: string[];

  constructor(message: string, violatedFiles: string[] = []) {
    super(message);
    this.name = 'SecurityViolationError';
    this.violatedFiles = violatedFiles;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ImmuneSystemConfig {
  projectRoot?: string;
  testCommand?: string;
  buildCommand?: string;
  timeoutMs?: number;
  autoRollback?: boolean;
  allowedDirectories?: string[];
  protectedPaths?: string[];
  database?: DatabaseService;
  wallet?: WalletClient;
  env?: Record<string, string>;
  execRunner?: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ) => Promise<ExecResult>;
}

export interface ModificationProposal {
  description: string;
  targetFiles?: string[];
  author?: string;
  commitMessage?: string;
}

export interface ScopeCheckResult {
  valid: boolean;
  violatedFiles: string[];
  allowedFiles: string[];
}

export interface ValidationResult {
  authorized: boolean;
  rollbackExecuted: boolean;
  immuneCheck: ImmuneCheckResult;
  rejectionReason?: string;
  actionId?: number;
  commitHash?: string;
  filesModified: string[];
}

// ==============================================================================
// 3. ImmuneSystem Implementation
// ==============================================================================

export class ImmuneSystem {
  private readonly projectRoot: string;
  private readonly testCommand: string;
  private readonly buildCommand: string;
  private readonly timeoutMs: number;
  private readonly autoRollback: boolean;
  private readonly allowedDirectories: string[];
  private readonly protectedPaths: string[];
  private readonly database?: DatabaseService;
  private readonly wallet?: WalletClient;
  private readonly env: Record<string, string>;
  private readonly execRunner: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ) => Promise<ExecResult>;

  constructor(config?: ImmuneSystemConfig) {
    this.projectRoot = path.resolve(config?.projectRoot ?? process.cwd());
    this.testCommand = config?.testCommand ?? 'npm test';
    this.buildCommand = config?.buildCommand ?? 'node scripts/build.js';
    this.timeoutMs = config?.timeoutMs ?? 60000;
    this.autoRollback = config?.autoRollback ?? true;
    this.allowedDirectories = config?.allowedDirectories
      ? [...config.allowedDirectories]
      : [...DEFAULT_ALLOWED_DIRECTORIES];
    this.protectedPaths = config?.protectedPaths
      ? [...config.protectedPaths]
      : [...DEFAULT_PROTECTED_PATHS];
    this.database = config?.database;
    this.wallet = config?.wallet;
    this.env = config?.env ?? {};
    this.execRunner = config?.execRunner ?? this.defaultExecRunner.bind(this);
  }

  /**
   * Default execution runner wrapping node:child_process spawn with timeouts and cross-platform handling.
   */
  private async defaultExecRunner(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd ?? this.projectRoot,
        env: { ...process.env, ...this.env, ...options?.env },
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutLimit = options?.timeout ?? this.timeoutMs;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 2000).unref();
      }, timeoutLimit);

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            stdout,
            stderr: (stderr + '\n[TIMEOUT] Execution exceeded timeout limit.').trim(),
            exitCode: 124,
          });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
          });
        }
      });
    });
  }

  /**
   * Discovers all uncommitted, staged, or untracked files via git status --porcelain.
   */
  public async getModifiedFiles(): Promise<string[]> {
    try {
      const res = await this.execRunner('git', ['status', '--porcelain'], {
        cwd: this.projectRoot,
      });
      if (res.exitCode !== 0) {
        throw new Error(`git status failed (exit ${res.exitCode}): ${res.stderr}`);
      }
      const lines = res.stdout.split('\n');
      const files: string[] = [];
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        let filePath = line.substring(2).trim();
        if (filePath.includes(' -> ')) {
          filePath = filePath.split(' -> ')[1].trim();
        }
        filePath = filePath.replace(/^"|"$/g, '').replace(/\\/g, '/');
        files.push(filePath);
      }
      return files;
    } catch (err) {
      throw new ImmuneCheckError(`Failed to inspect git status: ${(err as Error).message}`);
    }
  }

  /**
   * Verifies that modified files are strictly within Constitutional boundaries.
   * Only src/modules/, prompts/, strategies/ are permitted.
   * Everything else, including constitution, types, core/*, and immune_system.ts, is rejected.
   */
  public verifyConstitutionalScope(files: string[]): ScopeCheckResult {
    const violatedFiles: string[] = [];
    const allowedFiles: string[] = [];

    for (const rawFile of files) {
      const file = rawFile.replace(/\\/g, '/').replace(/^\.\//, '');

      // Check against protected paths first
      const isProtected = this.protectedPaths.some((prot) => {
        const normalizedProt = prot.replace(/\\/g, '/').replace(/^\.\//, '');
        return (
          file === normalizedProt ||
          file.startsWith(normalizedProt.endsWith('/') ? normalizedProt : normalizedProt + '/')
        );
      });

      if (isProtected) {
        violatedFiles.push(file);
        continue;
      }

      // Check if file starts with an allowed directory
      const isAllowed = this.allowedDirectories.some((dir) => {
        const normalizedDir = dir.replace(/\\/g, '/').replace(/^\.\//, '');
        return file.startsWith(normalizedDir);
      });

      if (!isAllowed) {
        violatedFiles.push(file);
      } else {
        allowedFiles.push(file);
      }
    }

    return {
      valid: violatedFiles.length === 0,
      violatedFiles,
      allowedFiles,
    };
  }

  /**
   * Retrieves the current uncommitted git diff against HEAD.
   */
  public async getDiff(): Promise<string> {
    try {
      const res = await this.execRunner('git', ['diff', 'HEAD'], { cwd: this.projectRoot });
      return res.stdout;
    } catch {
      return '';
    }
  }

  /**
   * Executes instant self-healing Git rollback: git reset --hard HEAD && git clean -fd.
   * Restores the working tree to a pristine state.
   */
  public async rollbackWorkspace(): Promise<void> {
    try {
      await this.execRunner('git', ['reset', '--hard', 'HEAD'], { cwd: this.projectRoot });
      await this.execRunner('git', ['clean', '-fd'], { cwd: this.projectRoot });
    } catch (err) {
      throw new ImmuneCheckError(`Workspace rollback failed: ${(err as Error).message}`);
    }
  }

  /**
   * Runs the syntax build check (node scripts/build.js) in a sandboxed subprocess.
   */
  public async runBuildCheck(): Promise<ImmuneCheckResult> {
    const start = Date.now();
    try {
      const parts = this.buildCommand.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      const res = await this.execRunner(cmd, args, { cwd: this.projectRoot });
      const durationMs = Date.now() - start;
      const passed = res.exitCode === 0;
      return {
        passed,
        output: (res.stdout + '\n' + res.stderr).trim(),
        exitCode: res.exitCode,
        durationMs,
        error: passed ? undefined : `Build syntax check failed with exit code ${res.exitCode}`,
      };
    } catch (err) {
      return {
        passed: false,
        output: (err as Error).message,
        exitCode: 1,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Runs the automated test suite in an isolated sandbox subprocess.
   * Injects NODE_ENV=test and DB_PATH=:memory: to prevent production state contamination.
   */
  public async runImmuneCheck(): Promise<ImmuneCheckResult> {
    const start = Date.now();
    try {
      const parts = this.testCommand.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      const res = await this.execRunner(cmd, args, {
        cwd: this.projectRoot,
        env: {
          NODE_ENV: 'test',
          DB_PATH: ':memory:',
        },
      });
      const durationMs = Date.now() - start;
      const passed = res.exitCode === 0;
      return {
        passed,
        output: (res.stdout + '\n' + res.stderr).trim(),
        exitCode: res.exitCode,
        durationMs,
        error: passed ? undefined : `Automated test check failed with exit code ${res.exitCode}`,
      };
    } catch (err) {
      return {
        passed: false,
        output: (err as Error).message,
        exitCode: 1,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Stages approved changes and commits them with an audit commit message.
   */
  public async commitModification(commitMessage: string): Promise<string> {
    await this.execRunner('git', ['add', '-A'], { cwd: this.projectRoot });
    await this.execRunner('git', ['commit', '-m', commitMessage], { cwd: this.projectRoot });
    const rev = await this.execRunner('git', ['rev-parse', 'HEAD'], { cwd: this.projectRoot });
    return rev.stdout.trim();
  }

  /**
   * Main entry point: validates an in-progress or proposed modification against the 4-tier gate:
   * 1. Metabolic Tier Gate (Tier Verde balance > $50.00 USD)
   * 2. Constitutional Scope Gate (whitelist: src/modules/, prompts/, strategies/)
   * 3. Pre-Deployment Syntax / Build Sandbox
   * 4. Pre-Deployment Test Validation Sandbox (100% Passing Invariant)
   * 
   * On any failure: executes instant Git rollback and logs IMMUNE_SYSTEM_ROLLBACK in actions.
   * On pass: authorizes modification and logs IMMUNE_SYSTEM_VERIFIED in actions.
   */
  public async validateModification(
    proposal?: ModificationProposal
  ): Promise<ValidationResult> {
    const db = this.database ?? getDatabase();
    const wallet = this.wallet ?? getWallet();
    const balanceUsd = await wallet.getTotalBalanceUsd();
    const tierStatus = evaluateTier(balanceUsd);

    // 1. Metabolic Tier Gate (Article III)
    if (!tierStatus.allowSelfModification || tierStatus.tier !== 'VERDE') {
      const reason = `METABOLIC_RESTRICTION: Self-modification suspended in Tier ${tierStatus.tier} (Balance: $${balanceUsd.toFixed(2)})`;
      if (this.autoRollback) {
        await this.rollbackWorkspace();
      }
      const actionId = db.isOpen()
        ? db.recordAction({
            component: 'immune_system',
            actionType: 'IMMUNE_SYSTEM_ROLLBACK',
            details: JSON.stringify({ reason, proposal }),
            tier: tierStatus.tier,
            balanceUsd,
            timestamp: Date.now(),
          })
        : undefined;

      throw new ImmuneCheckError(reason);
    }

    // 2. Discover Modified Files
    const modifiedFiles =
      proposal?.targetFiles && proposal.targetFiles.length > 0
        ? proposal.targetFiles
        : await this.getModifiedFiles();

    // 3. Constitutional Scope Gate (Article V & VII)
    const scope = this.verifyConstitutionalScope(modifiedFiles);
    if (!scope.valid) {
      const diff = await this.getDiff();
      if (this.autoRollback) {
        await this.rollbackWorkspace();
      }
      const reason = `CONSTITUTIONAL_SCOPE_VIOLATION: Modification touches protected or unauthorized files: ${scope.violatedFiles.join(', ')}`;
      const actionId = db.isOpen()
        ? db.recordAction({
            component: 'immune_system',
            actionType: 'IMMUNE_SYSTEM_ROLLBACK',
            details: JSON.stringify({
              reason,
              violatedFiles: scope.violatedFiles,
              diffSnippet: diff.slice(0, 1000),
            }),
            tier: tierStatus.tier,
            balanceUsd,
            timestamp: Date.now(),
          })
        : undefined;

      throw new SecurityViolationError(reason, scope.violatedFiles);
    }

    // 4. Pre-Deployment Syntax / Build Sandbox
    const buildRes = await this.runBuildCheck();
    if (!buildRes.passed) {
      const diff = await this.getDiff();
      if (this.autoRollback) {
        await this.rollbackWorkspace();
      }
      const actionId = db.isOpen()
        ? db.recordAction({
            component: 'immune_system',
            actionType: 'IMMUNE_SYSTEM_ROLLBACK',
            details: JSON.stringify({
              reason: 'SYNTAX_BUILD_FAILED',
              error: buildRes.error,
              output: buildRes.output.slice(0, 1000),
              diffSnippet: diff.slice(0, 1000),
            }),
            tier: tierStatus.tier,
            balanceUsd,
            timestamp: Date.now(),
          })
        : undefined;

      throw new ImmuneCheckError(`Build syntax verification failed: ${buildRes.error}`);
    }

    // 5. Pre-Deployment Test Validation Sandbox (100% Passing Invariant)
    const testRes = await this.runImmuneCheck();
    if (!testRes.passed) {
      const diff = await this.getDiff();
      if (this.autoRollback) {
        await this.rollbackWorkspace();
      }
      const actionId = db.isOpen()
        ? db.recordAction({
            component: 'immune_system',
            actionType: 'IMMUNE_SYSTEM_ROLLBACK',
            details: JSON.stringify({
              reason: 'TEST_SUITE_FAILED',
              exitCode: testRes.exitCode,
              error: testRes.error,
              output: testRes.output.slice(0, 1000),
              diffSnippet: diff.slice(0, 1000),
            }),
            tier: tierStatus.tier,
            balanceUsd,
            timestamp: Date.now(),
          })
        : undefined;

      throw new ImmuneCheckError(`Pre-deployment tests failed: ${testRes.error}`);
    }

    // 6. Authorized Verification
    let commitHash: string | undefined;
    if (proposal?.commitMessage) {
      commitHash = await this.commitModification(proposal.commitMessage);
    }

    const actionId = db.isOpen()
      ? db.recordAction({
          component: 'immune_system',
          actionType: 'IMMUNE_SYSTEM_VERIFIED',
          details: JSON.stringify({
            description: proposal?.description ?? 'Autonomous self-modification verified',
            filesModified: modifiedFiles,
            commitHash,
            durationMs: testRes.durationMs,
            testsPassed: true,
          }),
          tier: tierStatus.tier,
          balanceUsd,
          timestamp: Date.now(),
        })
      : undefined;

    return {
      authorized: true,
      rollbackExecuted: false,
      immuneCheck: testRes,
      actionId,
      commitHash,
      filesModified: modifiedFiles,
    };
  }
}
