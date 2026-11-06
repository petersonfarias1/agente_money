/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Bounties Scanner & Evaluator
 * ==============================================================================
 * Discovers, filters, evaluates, and settles open-source microtask bounties:
 * - Specializes exclusively in deterministic microtasks (docs, lint, test, small bugfix)
 * - Multi-factor mathematical feasibility scoring model
 * - Multi-layer Anti-Spam Firewall (Zero spam comments, quality hurdle, rate limits, dry-run)
 * - Atomic persistence into SQLite `ledger` (INCOME_BOUNTY) and `actions`
 */

import type {
  AppConfig,
  BountyTask,
  BountySubmission,
  SupportedChain,
} from '../../types.ts';
import { getConfig } from '../../config.ts';
import { DatabaseService, getDatabase } from '../../core/database.ts';

// ------------------------------------------------------------------------------
// Types & Interfaces
// ------------------------------------------------------------------------------

export type MicrotaskCategory =
  | 'documentation'
  | 'linting'
  | 'tests'
  | 'bugfix'
  | 'other';

export interface BountyFilterOptions {
  minRewardUsd?: number;
  maxDifficulty?: 'micro' | 'easy' | 'medium' | 'hard';
  allowedCategories?: MicrotaskCategory[];
  platforms?: Array<'github' | 'algora' | 'gitcoin'>;
  requiredTags?: string[];
}

export interface FeasibilityEvaluation {
  bountyId: string;
  category: MicrotaskCategory;
  score: number;
  difficultyScore: number;
  categoryScore: number;
  descriptionClarityScore: number;
  techCompatibilityScore: number;
  estimatedTimeMinutes: number;
  estimatedCostUsd: number;
  expectedNetProfitUsd: number;
  isFeasible: boolean;
  confidence: number;
  reasons: string[];
  rejectionReason?: string;
}

export interface AntiSpamResult {
  passed: boolean;
  violations: string[];
  submissionAllowed: boolean;
  isDryRun: boolean;
}

export interface BountySolution {
  bountyId: string;
  targetFile: string;
  patchContent: string;
  summary: string;
  confidence: number;
  testsIncluded: boolean;
  syntaxValid: boolean;
}

export interface BountyClaimResult {
  success: boolean;
  bountyId: string;
  amountUsd: number;
  chain: SupportedChain;
  token: string;
  txHash?: string;
  ledgerEntryId?: number;
  actionEntryId?: number;
  error?: string;
}

export interface BountyStats {
  totalScanned: number;
  totalFeasible: number;
  totalSubmissions: number;
  totalClaimed: number;
  totalRevenueUsd: number;
  averageRewardUsd: number;
}

export interface BountyDataProvider {
  fetchOpenBounties(options?: BountyFilterOptions): Promise<BountyTask[]>;
}

// ------------------------------------------------------------------------------
// Custom Errors
// ------------------------------------------------------------------------------

export class BountyError extends Error {
  constructor(message: string) {
    super(`[BOUNTY ERROR] ${message}`);
    this.name = 'BountyError';
  }
}

export class AntiSpamViolationError extends BountyError {
  public readonly violations: string[];
  constructor(violations: string[]) {
    super(`Anti-spam safeguard violation: ${violations.join(', ')}`);
    this.name = 'AntiSpamViolationError';
    this.violations = violations;
  }
}

// ------------------------------------------------------------------------------
// Default Mock Data Provider
// ------------------------------------------------------------------------------

export const DEFAULT_MOCK_BOUNTIES: BountyTask[] = [
  {
    id: 'BOUNTY-MOCK-001',
    platform: 'algora',
    url: 'https://github.com/example/sdk/issues/101',
    title: 'Fix typo and broken links in API documentation',
    description:
      'Update README.md and docs/api.md to fix broken anchor links and spelling errors in authentication examples.',
    rewardUsd: 25.0,
    difficulty: 'micro',
    tags: ['docs', 'documentation', 'typo', 'good-first-issue', 'markdown'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-002',
    platform: 'github',
    url: 'https://github.com/example/core/issues/202',
    title: 'Add unit tests for helper utility edge cases',
    description:
      'Add comprehensive unit tests in test/utils.test.ts covering null and boundary values for formatCurrency and parseDate.',
    rewardUsd: 50.0,
    difficulty: 'easy',
    tags: ['test', 'unit-test', 'typescript', 'coverage'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-003',
    platform: 'github',
    url: 'https://github.com/example/web/issues/303',
    title: 'Resolve ESLint warnings and unused imports in src/',
    description:
      'Fix all unused imports and format code with prettier across src/components and src/utils.',
    rewardUsd: 15.0,
    difficulty: 'micro',
    tags: ['lint', 'eslint', 'prettier', 'cleanup'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-004',
    platform: 'algora',
    url: 'https://github.com/example/api/issues/404',
    title: 'Handle null check on undefined user profile payload',
    description:
      'Fix TypeError: Cannot read property of undefined in src/handlers/profile.ts when profile payload lacks settings object.',
    rewardUsd: 30.0,
    difficulty: 'easy',
    tags: ['bug', 'bugfix', 'typescript', 'error-handling'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-005',
    platform: 'github',
    url: 'https://github.com/example/repo/issues/505',
    title: 'Update copyright year in LICENSE',
    description: 'Change 2025 to 2026 in LICENSE.',
    rewardUsd: 2.0, // Below minimum threshold ($10)
    difficulty: 'micro',
    tags: ['docs'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-006',
    platform: 'gitcoin',
    url: 'https://gitcoin.co/bounty/606',
    title: 'Implement zero-knowledge rollup prover in Rust',
    description: 'Build a high-performance STARK prover for state transitions.',
    rewardUsd: 5000.0,
    difficulty: 'hard', // Too complex for microtask
    tags: ['zk-proofs', 'rust', 'cryptography', 'architecture'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-007',
    platform: 'github',
    url: 'https://github.com/example/ui/issues/707',
    title: 'Make website look modern and better',
    description: 'Needs to look cooler.', // Ambiguous, low score
    rewardUsd: 50.0,
    difficulty: 'easy',
    tags: ['ui', 'design'],
    status: 'OPEN',
  },
  {
    id: 'BOUNTY-MOCK-008',
    platform: 'algora',
    url: 'https://github.com/example/ci/issues/808',
    title: 'Fix broken CI workflow',
    description: 'Already closed task.',
    rewardUsd: 40.0,
    difficulty: 'micro',
    tags: ['ci'],
    status: 'ACCEPTED', // Closed status
  },
];

export class MockBountyProvider implements BountyDataProvider {
  private bounties: BountyTask[];

  constructor(customBounties?: BountyTask[]) {
    this.bounties = customBounties ? [...customBounties] : [...DEFAULT_MOCK_BOUNTIES];
  }

  public setBounties(bounties: BountyTask[]): void {
    this.bounties = [...bounties];
  }

  public async fetchOpenBounties(_options?: BountyFilterOptions): Promise<BountyTask[]> {
    return [...this.bounties];
  }
}

// ------------------------------------------------------------------------------
// Microtask Classifier & Filter Functions
// ------------------------------------------------------------------------------

export function classifyMicrotask(task: BountyTask): MicrotaskCategory {
  const text = `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase();

  // Negative complexity check: if complex keywords present, classify as 'other'
  if (
    /refactor|rewrite|architecture|redesign|migration|zk-proof|cryptography|consensus|rollup/i.test(
      text
    )
  ) {
    return 'other';
  }

  if (/doc|docs|documentation|readme|typo|spelling|comment|guide|markdown/i.test(text)) {
    return 'documentation';
  }

  if (/lint|eslint|prettier|\bformat\b|formatting|styling|unused import|type error|tsconfig/i.test(text)) {
    return 'linting';
  }

  if (/test|tests|unit test|coverage|fixture|mock|spec/i.test(text)) {
    return 'tests';
  }

  if (
    /bug|fix|patch|null check|nullpointer|bounds|regression|exception|crash|error-handling/i.test(
      text
    )
  ) {
    return 'bugfix';
  }

  return 'other';
}

export function filterMicrotasks(
  tasks: BountyTask[],
  options?: BountyFilterOptions
): BountyTask[] {
  const minReward = options?.minRewardUsd ?? 10.0;
  const maxDiff = options?.maxDifficulty ?? 'easy';
  const allowedCategories = options?.allowedCategories ?? [
    'documentation',
    'linting',
    'tests',
    'bugfix',
  ];
  const allowedPlatforms = options?.platforms;

  return tasks.filter((task) => {
    // 1. Must be OPEN
    if (task.status !== 'OPEN') return false;

    // 2. Platform match
    if (allowedPlatforms && !allowedPlatforms.includes(task.platform)) {
      return false;
    }

    // 3. Minimum reward requirement
    if (task.rewardUsd < minReward) return false;

    // 4. Difficulty constraint (never accept hard; medium only if allowed)
    if (task.difficulty === 'hard') return false;
    if (task.difficulty === 'medium' && maxDiff !== 'medium' && maxDiff !== 'hard') {
      return false;
    }

    // 5. Category classification check
    const category = classifyMicrotask(task);
    if (!allowedCategories.includes(category)) {
      return false;
    }

    // 6. Required tags check
    if (options?.requiredTags && options.requiredTags.length > 0) {
      const hasAllTags = options.requiredTags.every((reqTag) =>
        task.tags.some((t) => t.toLowerCase() === reqTag.toLowerCase())
      );
      if (!hasAllTags) return false;
    }

    return true;
  });
}

// ------------------------------------------------------------------------------
// Bounty Evaluator
// ------------------------------------------------------------------------------

export class BountyEvaluator {
  public static evaluate(
    task: BountyTask,
    options?: { minScore?: number; minRewardUsd?: number }
  ): FeasibilityEvaluation {
    const minScore = options?.minScore ?? 0.70;
    const minReward = options?.minRewardUsd ?? 10.0;
    const reasons: string[] = [];

    // 1. Category Classification
    const category = classifyMicrotask(task);

    // 2. Factor 1: Difficulty Compatibility (weight: 0.35)
    let difficultyScore = 0.0;
    if (task.difficulty === 'micro') {
      difficultyScore = 1.0;
    } else if (task.difficulty === 'easy') {
      difficultyScore = 0.8;
    } else if (task.difficulty === 'medium') {
      difficultyScore = 0.3;
    } else {
      difficultyScore = 0.0;
    }

    // 3. Factor 2: Category Alignment (weight: 0.25)
    let categoryScore = 0.0;
    switch (category) {
      case 'documentation':
        categoryScore = 1.0;
        break;
      case 'linting':
        categoryScore = 0.95;
        break;
      case 'tests':
        categoryScore = 0.90;
        break;
      case 'bugfix':
        categoryScore = 0.80;
        break;
      default:
        categoryScore = 0.20;
    }

    // 4. Factor 3: Description Clarity & Specification (weight: 0.20)
    let descriptionClarityScore = 0.3;
    const desc = task.description.toLowerCase();
    if (desc.length >= 50) descriptionClarityScore += 0.2;
    if (desc.length >= 100 && desc.length <= 1500) descriptionClarityScore += 0.2;
    if (/[\/\\]|\.ts|\.js|\.md|\.json|line\s*\d+|`[^`]+`/i.test(task.description)) {
      descriptionClarityScore += 0.3;
    }
    descriptionClarityScore = Math.min(1.0, descriptionClarityScore);

    // 5. Factor 4: Tech Stack Compatibility (weight: 0.20)
    let techCompatibilityScore = 0.4;
    const allText = `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase();
    if (/typescript|javascript|node|npm|json|markdown|docs|prettier|eslint/i.test(allText)) {
      techCompatibilityScore = 1.0;
    } else if (/python|html|css|shell|bash/i.test(allText)) {
      techCompatibilityScore = 0.6;
    } else if (/rust|c\+\+|solidity|go/i.test(allText)) {
      techCompatibilityScore = 0.3;
    }

    // Total Weighted Feasibility Score
    const score = Number(
      (
        0.35 * difficultyScore +
        0.25 * categoryScore +
        0.20 * descriptionClarityScore +
        0.20 * techCompatibilityScore
      ).toFixed(4)
    );

    // 6. Economic Profitability Estimation
    const estimatedCostUsd = Number(
      (0.05 + Math.min(0.15, task.description.length * 0.0001)).toFixed(4)
    );
    const expectedNetProfitUsd = Number((task.rewardUsd - estimatedCostUsd).toFixed(4));
    const estimatedTimeMinutes =
      task.difficulty === 'micro' ? 5 : task.difficulty === 'easy' ? 15 : 45;

    // Decision Logic
    let isFeasible = true;
    let rejectionReason: string | undefined;

    if (task.status !== 'OPEN') {
      isFeasible = false;
      rejectionReason = `Task status is '${task.status}', expected 'OPEN'`;
    } else if (task.rewardUsd < minReward) {
      isFeasible = false;
      rejectionReason = `Reward $${task.rewardUsd} is below minimum threshold of $${minReward}`;
    } else if (task.difficulty === 'hard') {
      isFeasible = false;
      rejectionReason = 'Hard difficulty bounties exceed autonomous microtask capacity';
    } else if (expectedNetProfitUsd <= 0) {
      isFeasible = false;
      rejectionReason = `Non-positive expected net profit: $${expectedNetProfitUsd}`;
    } else if (score < minScore) {
      isFeasible = false;
      rejectionReason = `Feasibility score ${score} is below threshold ${minScore}`;
    }

    if (isFeasible) {
      reasons.push(`Score ${score} >= ${minScore}`);
      reasons.push(`Net profit $${expectedNetProfitUsd} > 0`);
      reasons.push(`Category: ${category}, Difficulty: ${task.difficulty}`);
    }

    return {
      bountyId: task.id,
      category,
      score,
      difficultyScore,
      categoryScore,
      descriptionClarityScore,
      techCompatibilityScore,
      estimatedTimeMinutes,
      estimatedCostUsd,
      expectedNetProfitUsd,
      isFeasible,
      confidence: score,
      reasons,
      rejectionReason,
    };
  }
}

// ------------------------------------------------------------------------------
// Anti-Spam Safeguard Firewall
// ------------------------------------------------------------------------------

export class AntiSpamSafeguard {
  public static validateSubmission(
    _task: BountyTask,
    evaluation: FeasibilityEvaluation,
    solution: BountySolution,
    db?: DatabaseService,
    options?: {
      minSubmissionScore?: number;
      dailyLimit?: number;
      isDryRun?: boolean;
    }
  ): AntiSpamResult {
    const minSubmissionScore = options?.minSubmissionScore ?? 0.75;
    const dailyLimit = options?.dailyLimit ?? 5;
    const isDryRun = options?.isDryRun ?? true;
    const violations: string[] = [];

    // Rule 1: High Feasibility Hurdle
    if (evaluation.score < minSubmissionScore) {
      violations.push(
        `Feasibility score ${evaluation.score} does not meet submission hurdle ${minSubmissionScore}`
      );
    }

    // Rule 2: Valid Non-Empty Patch
    if (!solution.patchContent || solution.patchContent.trim().length < 20) {
      violations.push('Patch content is missing or too short to be a valid solution');
    }

    if (/TODO|FIXME|\/\/ fix here|\/\/ implement/i.test(solution.patchContent)) {
      violations.push('Patch contains incomplete placeholder markers (TODO/FIXME)');
    }

    if (!solution.syntaxValid) {
      violations.push('Patch failed syntax validation check');
    }

    // Rule 3: Anti-Spam Rate Limiting (Daily Cap)
    if (db && db.isOpen()) {
      try {
        const recentActions = db.getActions(100, 'bounties');
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentSubmissions = recentActions.filter(
          (a) =>
            (a.actionType === 'BOUNTY_SUBMITTED' || a.actionType === 'BOUNTY_SUBMISSION_SIMULATED') &&
            a.timestamp >= oneDayAgo
        );
        if (recentSubmissions.length >= dailyLimit) {
          violations.push(
            `Daily submission limit reached (${recentSubmissions.length}/${dailyLimit} in 24h)`
          );
        }
      } catch {
        // Fallback safely if db query fails
      }
    }

    const passed = violations.length === 0;

    return {
      passed,
      violations,
      submissionAllowed: passed,
      isDryRun,
    };
  }

  /**
   * Hard block against unsolicited issue chatter.
   */
  public static assertNoUnsolicitedComment(): void {
    throw new AntiSpamViolationError([
      'Zero-Spam Policy: Unsolicited comments or automated messages on issues are strictly forbidden',
    ]);
  }
}

// ------------------------------------------------------------------------------
// Main BountiesScanner Coordinator
// ------------------------------------------------------------------------------

export interface BountiesScannerOptions {
  config?: AppConfig;
  database?: DatabaseService;
  provider?: BountyDataProvider;
  dryRun?: boolean;
}

export class BountiesScanner {
  private config: AppConfig;
  private database: DatabaseService;
  private provider: BountyDataProvider;
  public dryRun: boolean;

  constructor(options?: BountiesScannerOptions) {
    this.config = options?.config ?? getConfig();
    this.database = options?.database ?? getDatabase();
    this.provider = options?.provider ?? new MockBountyProvider();
    this.dryRun = options?.dryRun ?? (this.config.networkMode !== 'mainnet');
  }

  public async scanBounties(filter?: BountyFilterOptions): Promise<BountyTask[]> {
    const rawBounties = await this.provider.fetchOpenBounties(filter);
    const minReward = filter?.minRewardUsd ?? this.config.bounties.minRewardUsd;
    const filtered = filterMicrotasks(rawBounties, {
      ...filter,
      minRewardUsd: minReward,
    });

    if (this.database && this.database.isOpen()) {
      for (const task of filtered) {
        try {
          this.database.recordAction({
            component: 'bounties',
            actionType: 'BOUNTY_DISCOVERED',
            details: JSON.stringify({
              id: task.id,
              title: task.title,
              rewardUsd: task.rewardUsd,
              platform: task.platform,
              difficulty: task.difficulty,
            }),
            tier: 'VERDE',
            balanceUsd: 0,
            timestamp: Date.now(),
          });
        } catch {
          // Non-fatal
        }
      }
    }

    return filtered;
  }

  public evaluateBounty(task: BountyTask): FeasibilityEvaluation {
    const evaluation = BountyEvaluator.evaluate(task, {
      minRewardUsd: this.config.bounties.minRewardUsd,
    });

    if (this.database && this.database.isOpen()) {
      try {
        this.database.recordAction({
          component: 'bounties',
          actionType: 'BOUNTY_EVALUATED',
          details: JSON.stringify({
            bountyId: task.id,
            score: evaluation.score,
            category: evaluation.category,
            isFeasible: evaluation.isFeasible,
            expectedNetProfitUsd: evaluation.expectedNetProfitUsd,
            rejectionReason: evaluation.rejectionReason,
          }),
          tier: 'VERDE',
          balanceUsd: 0,
          timestamp: Date.now(),
        });
      } catch {
        // Non-fatal
      }
    }

    return evaluation;
  }

  public async solveAndSubmit(
    task: BountyTask,
    solution: BountySolution
  ): Promise<BountySubmission | null> {
    const evaluation = this.evaluateBounty(task);
    if (!evaluation.isFeasible) {
      throw new BountyError(`Bounty ${task.id} is not feasible: ${evaluation.rejectionReason}`);
    }

    const antiSpam = AntiSpamSafeguard.validateSubmission(
      task,
      evaluation,
      solution,
      this.database,
      { isDryRun: this.dryRun }
    );

    if (!antiSpam.passed) {
      if (this.database && this.database.isOpen()) {
        try {
          this.database.recordAction({
            component: 'bounties',
            actionType: 'SPAM_SAFEGUARD_TRIGGERED',
            details: JSON.stringify({
              bountyId: task.id,
              violations: antiSpam.violations,
            }),
            tier: 'VERDE',
            balanceUsd: 0,
            timestamp: Date.now(),
          });
        } catch {
          // Non-fatal
        }
      }
      throw new AntiSpamViolationError(antiSpam.violations);
    }

    const branchName = `fix/bounty-${task.id.toLowerCase()}`;
    const prUrl = this.dryRun
      ? `https://github.com/mock-repo/pulls/simulated-${task.id.toLowerCase()}`
      : `${task.url}/pulls/new`;

    const submission: BountySubmission = {
      bountyId: task.id,
      prUrl,
      branchName,
      submittedAt: Date.now(),
      rewardClaimed: false,
    };

    if (this.database && this.database.isOpen()) {
      try {
        this.database.recordAction({
          component: 'bounties',
          actionType: this.dryRun ? 'BOUNTY_SUBMISSION_SIMULATED' : 'BOUNTY_SUBMITTED',
          details: JSON.stringify(submission),
          tier: 'VERDE',
          balanceUsd: 0,
          timestamp: Date.now(),
        });
      } catch {
        // Non-fatal
      }
    }

    return submission;
  }

  public claimReward(
    task: BountyTask,
    submission: BountySubmission,
    options?: { chain?: SupportedChain; txHash?: string }
  ): BountyClaimResult {
    if (submission.rewardClaimed) {
      throw new BountyError(`Reward for bounty ${task.id} has already been claimed.`);
    }

    const chain: SupportedChain = options?.chain ?? 'base';
    const txHash =
      options?.txHash ??
      `0xmock_bounty_payout_${task.id.toLowerCase()}_${Date.now()}`;

    // 1. Insert into SQLite ledger (INCOME_BOUNTY)
    const ledgerEntryId = this.database.insertLedger({
      txHash,
      chain,
      token: 'USDC',
      amount: task.rewardUsd,
      entryType: 'INCOME_BOUNTY',
      counterparty: task.platform,
      timestamp: Date.now(),
    });

    // 2. Mark submission claimed
    submission.rewardClaimed = true;

    // 3. Record audit action
    const actionEntryId = this.database.recordAction({
      component: 'bounties',
      actionType: 'BOUNTY_CLAIMED',
      details: JSON.stringify({
        bountyId: task.id,
        rewardUsd: task.rewardUsd,
        platform: task.platform,
        prUrl: submission.prUrl,
        txHash,
      }),
      tier: 'VERDE',
      balanceUsd: 0,
      timestamp: Date.now(),
    });

    return {
      success: true,
      bountyId: task.id,
      amountUsd: task.rewardUsd,
      chain,
      token: 'USDC',
      txHash,
      ledgerEntryId,
      actionEntryId,
    };
  }

  public getStats(): BountyStats {
    if (!this.database || !this.database.isOpen()) {
      return {
        totalScanned: 0,
        totalFeasible: 0,
        totalSubmissions: 0,
        totalClaimed: 0,
        totalRevenueUsd: 0,
        averageRewardUsd: 0,
      };
    }

    const actions = this.database.getActions(500, 'bounties');
    const scanned = actions.filter((a) => a.actionType === 'BOUNTY_DISCOVERED').length;
    const feasible = actions.filter(
      (a) => a.actionType === 'BOUNTY_EVALUATED' && a.details.includes('"isFeasible":true')
    ).length;
    const submissions = actions.filter(
      (a) => a.actionType === 'BOUNTY_SUBMITTED' || a.actionType === 'BOUNTY_SUBMISSION_SIMULATED'
    ).length;
    const claims = actions.filter((a) => a.actionType === 'BOUNTY_CLAIMED');
    const totalClaimed = claims.length;

    const ledger = this.database.getLedgerEntries(500);
    const bountyIncomes = ledger.filter((l) => l.entryType === 'INCOME_BOUNTY');
    const totalRevenueUsd = bountyIncomes.reduce((acc, cur) => acc + cur.amount, 0);
    const averageRewardUsd =
      totalClaimed > 0 ? Number((totalRevenueUsd / totalClaimed).toFixed(2)) : 0.0;

    return {
      totalScanned: scanned,
      totalFeasible: feasible,
      totalSubmissions: submissions,
      totalClaimed,
      totalRevenueUsd,
      averageRewardUsd,
    };
  }
}
