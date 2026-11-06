/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Permadeath Protocol
 * ==============================================================================
 * Enforces Article IV of the Apex AEA Constitution upon verified terminal
 * insolvency (balance <= $0.00 USD):
 * - Orderly teardown of active listeners, connections, and orders
 * - Synchronous post-mortem snapshot persisted to `tombstone.json`
 * - SQLite terminal audit log and lineage insolvency marking
 * - Injectable process exit handler enabling 100% safe unit test execution
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  Tombstone,
  LedgerEntry,
  WalletClient,
} from '../types.ts';
import { DatabaseService, getDatabase } from './database.ts';

// ==============================================================================
// 1. Teardown Hook Registry
// ==============================================================================

export type TeardownHook = () => Promise<void> | void;

const teardownHooks: TeardownHook[] = [];

/**
 * Registers a teardown hook to be invoked during Permadeath.
 */
export function registerTeardownHook(hook: TeardownHook): void {
  teardownHooks.push(hook);
}

/**
 * Clears all registered teardown hooks (useful between tests).
 */
export function clearTeardownHooks(): void {
  teardownHooks.length = 0;
}

export function getTeardownHooksCount(): number {
  return teardownHooks.length;
}

// ==============================================================================
// 2. Injectable Exit Handler Pattern
// ==============================================================================

export type ExitHandler = (code: number) => never;

const defaultExitHandler: ExitHandler = (code: number): never => {
  process.exit(code);
};

let currentExitHandler: ExitHandler = defaultExitHandler;

/**
 * Injects a custom exit handler (e.g. throwing a MockExitError in test suites).
 */
export function setExitHandler(handler: ExitHandler): void {
  currentExitHandler = handler;
}

/**
 * Resets the exit handler back to process.exit.
 */
export function resetExitHandler(): void {
  currentExitHandler = defaultExitHandler;
}

export function getExitHandler(): ExitHandler {
  return currentExitHandler;
}

// ==============================================================================
// 3. Permadeath Execution
// ==============================================================================

export interface ExecutePermadeathOptions {
  tombstonePath?: string;
  reason?: string;
  agentAddress?: string;
  agentName?: string;
  generation?: number;
  parentId?: string | null;
  finalBalanceUsd?: number;
  peakBalanceUsd?: number;
  totalCyclesExecuted?: number;
  birthTimestampMs?: number;
  database?: DatabaseService;
  wallet?: WalletClient;
  exitHandler?: ExitHandler;
  operationalSummary?: {
    polymarketBetsCount: number;
    polymarketWinRate: number;
    x402RequestsServed: number;
    bountiesCompleted: number;
  };
  postMortemInsights?: string[];
}

/**
 * Executes the immutable Permadeath Protocol according to Constitution Article IV.
 * - Flushes tombstone.json post-mortem snapshot
 * - Executes registered teardown hooks
 * - Flushes database audit logs and marks lineage insolvent
 * - Terminates runtime cleanly via current exit handler (default process.exit(0))
 */
export async function executePermadeath(
  options?: ExecutePermadeathOptions | string
): Promise<never> {
  const opts: ExecutePermadeathOptions =
    typeof options === 'string' ? { tombstonePath: options } : options ?? {};

  const deathTime = new Date();
  const deathTimestampStr = deathTime.toISOString();
  const deathTimestampMs = deathTime.getTime();

  // 1. Resolve Dependencies (passed or singletons)
  let db: DatabaseService | null = null;
  if (opts.database) {
    db = opts.database;
  } else {
    try {
      db = getDatabase();
    } catch {
      db = null;
    }
  }

  const exit = opts.exitHandler ?? currentExitHandler;
  const agentAddress =
    opts.agentAddress ??
    (opts.wallet ? opts.wallet.getAddress() : '0x0000000000000000000000000000000000000000');

  const finalBalanceUsd = opts.finalBalanceUsd ?? 0.0;
  const birthTimestampMs = opts.birthTimestampMs ?? deathTimestampMs - 86400000;
  const lifespanMs = Math.max(0, deathTimestampMs - birthTimestampMs);
  const totalCycles = opts.totalCyclesExecuted ?? 1;
  const reason =
    opts.reason ??
    'Insolvency: Liquid wallet balance reached $0.00 USD (Constitution Article IV)';

  // 2. Aggregate Financial Data from Database
  let totalRevenue = 0;
  let totalExpenses = 0;
  let finalLedger: LedgerEntry[] = [];

  if (db && db.isOpen()) {
    try {
      totalRevenue = db.getTotalRevenue();
      totalExpenses = db.getTotalExpenses();
      finalLedger = db.getLedgerSnapshot(100);
    } catch {
      // Proceed with defaults if query fails
    }
  }

  // 3. Construct Tombstone Snapshot
  const tombstone: Tombstone = {
    agentAddress,
    agentName: opts.agentName ?? 'Apex-AEA-Alpha',
    generation: opts.generation ?? 1,
    parentId: opts.parentId ?? null,
    deathTimestamp: deathTimestampStr,
    birthTimestamp: new Date(birthTimestampMs).toISOString(),
    finalBalanceUsd,
    peakBalanceUsd: opts.peakBalanceUsd ?? Math.max(finalBalanceUsd, totalRevenue),
    totalLifespanMs: lifespanMs,
    totalCyclesExecuted: totalCycles,
    totalRevenueGenerated: totalRevenue,
    totalExpensesIncurred: totalExpenses,
    finalLedgerSnapshot: finalLedger,
    reason,
    operationalSummary: opts.operationalSummary ?? {
      polymarketBetsCount: 0,
      polymarketWinRate: 0.0,
      x402RequestsServed: 0,
      bountiesCompleted: 0,
    },
    postMortemInsights: opts.postMortemInsights ?? [
      'Terminal insolvency triggered when liquid balance reached $0.00 USD.',
      'All pending orders cancelled and listeners unmounted per Constitution Article IV.',
      'Tombstone recorded cleanly for post-mortem analysis and lineage auditing.',
    ],
  };

  // 4. Synchronously Write tombstone.json
  const targetPath = opts.tombstonePath
    ? path.resolve(opts.tombstonePath)
    : path.resolve(process.cwd(), 'tombstone.json');

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(tombstone, null, 2), 'utf8');

  // 5. Execute Registered Teardown Hooks
  for (const hook of teardownHooks) {
    try {
      await hook();
    } catch {
      // Individual hook failure must not block remaining teardown
    }
  }

  // 6. Record Terminal State in Database & Close
  if (db && db.isOpen()) {
    try {
      db.recordAction({
        component: 'death',
        actionType: 'PERMADEATH_EXECUTED',
        details: JSON.stringify({ reason, tombstonePath: targetPath }),
        tier: 'VERMELHO',
        balanceUsd: finalBalanceUsd,
        timestamp: deathTimestampMs,
      });

      // Update lineage to INSOLVENT if present
      if (agentAddress && agentAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          db.updateLineageStatus(agentAddress, 'INSOLVENT');
        } catch {
          // May not be registered in lineage; non-fatal
        }
      }

      db.close();
    } catch {
      // Non-fatal error during closing
    }
  }

  // 7. Clean Exit
  return exit(0);
}
