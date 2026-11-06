/**
 * ==============================================================================
 * E2E Test Helper: Hermetic Sandbox Test Context (`test_context.ts`)
 * ==============================================================================
 * Orchestrates an isolated in-memory testing environment:
 * - Isolated in-memory SQLite database (`:memory:`)
 * - Sandboxed temp directory lifecycle per test run
 * - Mock dual-chain ApexWallet instance
 * - Intercepts process.exit to cleanly trap Permadeath without killing runner
 * - Full resource cleanup and teardown on completion
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseService } from '../../../src/core/database.ts';
import { ApexWallet } from '../../../src/core/wallet.ts';
import { loadConfig, resetConfig } from '../../../src/config.ts';
import { resetExitHandler, setExitHandler, clearTeardownHooks } from '../../../src/core/death.ts';
import type { AppConfig } from '../../../src/types.ts';

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

  public getExitCode(): number | null {
    return this.exitCodeReceived;
  }

  public isDead(): boolean {
    return this.exitCodeReceived !== null;
  }

  public async teardown(): Promise<void> {
    clearTeardownHooks();
    resetExitHandler();
    resetConfig();

    if (this.db && this.db.isOpen()) {
      try {
        this.db.close();
      } catch {
        // Ignored
      }
    }

    if (fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  }
}
