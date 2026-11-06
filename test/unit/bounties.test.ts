/**
 * ==============================================================================
 * Unit Test Suite: Open-Source Bounties Scanner & Solution Evaluator
 * ==============================================================================
 * Target: src/modules/bounties/scanner.ts
 * Tests:
 * 1. Microtask classification and filtering
 * 2. Feasibility and economic net profit scoring model
 * 3. Multi-layer Anti-Spam Firewall enforcement
 * 4. Dry-run and simulated PR submission
 * 5. Reward settlement and idempotency in SQLite ledger
 * 6. Track record statistics aggregation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/core/database.ts';
import {
  BountiesScanner,
  BountyEvaluator,
  AntiSpamSafeguard,
  classifyMicrotask,
  filterMicrotasks,
  MockBountyProvider,
  DEFAULT_MOCK_BOUNTIES,
  AntiSpamViolationError,
  BountyError,
  type BountyTask,
  type BountySolution,
} from '../../src/modules/bounties/scanner.ts';

describe('Bounties Scanner & Solution Evaluator', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    if (db.isOpen()) {
      db.close();
    }
  });

  describe('1. Microtask Classification & Filtering', () => {
    it('should classify microtask categories accurately', () => {
      const docTask: BountyTask = {
        id: '1',
        platform: 'github',
        url: 'https://example.com/1',
        title: 'Fix typo in README documentation',
        description: 'Update docs/guide.md to fix spelling mistake in quickstart.',
        rewardUsd: 20.0,
        difficulty: 'micro',
        tags: ['documentation', 'markdown'],
        status: 'OPEN',
      };
      assert.strictEqual(classifyMicrotask(docTask), 'documentation');

      const lintTask: BountyTask = {
        id: '2',
        platform: 'github',
        url: 'https://example.com/2',
        title: 'Run prettier and fix eslint unused imports',
        description: 'Clean up unused imports in src/handlers.',
        rewardUsd: 15.0,
        difficulty: 'micro',
        tags: ['lint', 'eslint'],
        status: 'OPEN',
      };
      assert.strictEqual(classifyMicrotask(lintTask), 'linting');

      const testTask: BountyTask = {
        id: '3',
        platform: 'algora',
        url: 'https://example.com/3',
        title: 'Add unit tests for helper edge cases',
        description: 'Write test assertions for null inputs in parseDate.',
        rewardUsd: 40.0,
        difficulty: 'easy',
        tags: ['test', 'unit-test'],
        status: 'OPEN',
      };
      assert.strictEqual(classifyMicrotask(testTask), 'tests');

      const bugTask: BountyTask = {
        id: '4',
        platform: 'github',
        url: 'https://example.com/4',
        title: 'Fix nullpointer crash when profile is undefined',
        description: 'Add defensive null check before accessing user.email.',
        rewardUsd: 35.0,
        difficulty: 'easy',
        tags: ['bug', 'bugfix'],
        status: 'OPEN',
      };
      assert.strictEqual(classifyMicrotask(bugTask), 'bugfix');

      const complexTask: BountyTask = {
        id: '5',
        platform: 'gitcoin',
        url: 'https://example.com/5',
        title: 'Refactor consensus engine and rewrite architecture',
        description: 'Complete overhaul of state transition proofs.',
        rewardUsd: 3000.0,
        difficulty: 'hard',
        tags: ['architecture', 'consensus'],
        status: 'OPEN',
      };
      assert.strictEqual(classifyMicrotask(complexTask), 'other');
    });

    it('should filter out hard, closed, low-reward, or complex tasks', () => {
      const filtered = filterMicrotasks(DEFAULT_MOCK_BOUNTIES, { minRewardUsd: 10.0 });

      // None of the filtered tasks should be hard or closed
      for (const t of filtered) {
        assert.strictEqual(t.status, 'OPEN');
        assert.ok(t.rewardUsd >= 10.0);
        assert.notStrictEqual(t.difficulty, 'hard');
        assert.notStrictEqual(classifyMicrotask(t), 'other');
      }

      const filteredIds = filtered.map((t) => t.id);
      assert.ok(!filteredIds.includes('BOUNTY-MOCK-005'), 'Below min reward ($2) must be excluded');
      assert.ok(!filteredIds.includes('BOUNTY-MOCK-006'), 'Hard difficulty ($5000) must be excluded');
      assert.ok(!filteredIds.includes('BOUNTY-MOCK-008'), 'Closed task must be excluded');
      assert.ok(filteredIds.includes('BOUNTY-MOCK-001'), 'Documentation microtask must be included');
      assert.ok(filteredIds.includes('BOUNTY-MOCK-002'), 'Unit test easy task must be included');
    });
  });

  describe('2. Feasibility & Economic Profitability Scoring', () => {
    it('should award high feasibility scores to bounded microtasks with positive net profit', () => {
      const task = DEFAULT_MOCK_BOUNTIES[0]; // Docs microtask ($25)
      const evaluation = BountyEvaluator.evaluate(task);

      assert.strictEqual(evaluation.isFeasible, true);
      assert.ok(evaluation.score >= 0.80, `Expected score >= 0.80, got ${evaluation.score}`);
      assert.ok(evaluation.expectedNetProfitUsd > 20.0);
      assert.strictEqual(evaluation.rejectionReason, undefined);
      assert.ok(evaluation.reasons.length > 0);
    });

    it('should reject ambiguous task with low feasibility score', () => {
      const ambiguousTask = DEFAULT_MOCK_BOUNTIES[6]; // "Needs to look cooler" ($50, easy)
      const evaluation = BountyEvaluator.evaluate(ambiguousTask, { minScore: 0.70 });

      assert.strictEqual(evaluation.isFeasible, false);
      assert.ok(evaluation.rejectionReason?.includes('Feasibility score'));
    });

    it('should reject task with non-positive expected net profit', () => {
      const lossTask: BountyTask = {
        id: 'loss-001',
        platform: 'github',
        url: 'https://example.com/loss',
        title: 'Fix typo in README',
        description: 'Small fix but tiny reward.',
        rewardUsd: 0.05, // Below estimated compute cost
        difficulty: 'micro',
        tags: ['docs'],
        status: 'OPEN',
      };

      const evaluation = BountyEvaluator.evaluate(lossTask, { minRewardUsd: 0.01 });
      assert.strictEqual(evaluation.isFeasible, false);
    });
  });

  describe('3. Anti-Spam Firewall Safeguards', () => {
    it('should block submission if feasibility score is below hurdle (0.75)', () => {
      const task = DEFAULT_MOCK_BOUNTIES[0];
      const evaluation = BountyEvaluator.evaluate(task);
      // Simulate lower score evaluation
      const lowScoreEval = { ...evaluation, score: 0.72 };

      const solution: BountySolution = {
        bountyId: task.id,
        targetFile: 'README.md',
        patchContent: '--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,2 @@\n-broken link\n+fixed link\n',
        summary: 'Fix typo',
        confidence: 0.9,
        testsIncluded: true,
        syntaxValid: true,
      };

      const result = AntiSpamSafeguard.validateSubmission(task, lowScoreEval, solution);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.submissionAllowed, false);
      assert.ok(result.violations.some((v) => v.includes('Feasibility score')));
    });

    it('should block submission if patch is too short or contains placeholder markers', () => {
      const task = DEFAULT_MOCK_BOUNTIES[0];
      const evaluation = BountyEvaluator.evaluate(task);

      // Short patch
      const shortSolution: BountySolution = {
        bountyId: task.id,
        targetFile: 'README.md',
        patchContent: 'short',
        summary: 'too short',
        confidence: 0.9,
        testsIncluded: false,
        syntaxValid: true,
      };

      const resultShort = AntiSpamSafeguard.validateSubmission(task, evaluation, shortSolution);
      assert.strictEqual(resultShort.passed, false);

      // Placeholder marker (TODO)
      const placeholderSolution: BountySolution = {
        bountyId: task.id,
        targetFile: 'README.md',
        patchContent: '// TODO: add real fix here later when time permits',
        summary: 'placeholder fix',
        confidence: 0.9,
        testsIncluded: false,
        syntaxValid: true,
      };

      const resultPlaceholder = AntiSpamSafeguard.validateSubmission(
        task,
        evaluation,
        placeholderSolution
      );
      assert.strictEqual(resultPlaceholder.passed, false);
      assert.ok(resultPlaceholder.violations.some((v) => v.includes('TODO/FIXME')));
    });

    it('should enforce 24-hour rate limiting cap (max 5 submissions)', () => {
      const task = DEFAULT_MOCK_BOUNTIES[0];
      const evaluation = BountyEvaluator.evaluate(task);
      const validSolution: BountySolution = {
        bountyId: task.id,
        targetFile: 'docs/api.md',
        patchContent: '--- a/docs/api.md\n+++ b/docs/api.md\n@@ -10 +10 @@\n-broken auth link\n+https://api.example.com/auth\n',
        summary: 'Fix API link',
        confidence: 0.95,
        testsIncluded: true,
        syntaxValid: true,
      };

      // Record 5 simulated submissions in the last hour
      for (let i = 0; i < 5; i++) {
        db.recordAction({
          component: 'bounties',
          actionType: 'BOUNTY_SUBMISSION_SIMULATED',
          details: JSON.stringify({ index: i }),
          tier: 'VERDE',
          balanceUsd: 100.0,
          timestamp: Date.now() - (i + 1) * 60000,
        });
      }

      const result = AntiSpamSafeguard.validateSubmission(
        task,
        evaluation,
        validSolution,
        db,
        { dailyLimit: 5 }
      );

      assert.strictEqual(result.passed, false);
      assert.ok(result.violations.some((v) => v.includes('Daily submission limit')));
    });

    it('should strictly prohibit unsolicited comments on issues with AntiSpamViolationError', () => {
      assert.throws(() => {
        AntiSpamSafeguard.assertNoUnsolicitedComment();
      }, AntiSpamViolationError);
    });
  });

  describe('4. BountiesScanner Execution, Dry-Run & Settlement', () => {
    it('should scan bounties and persist discovery actions in SQLite', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: new MockBountyProvider(),
        dryRun: true,
      });

      const eligible = await scanner.scanBounties();
      assert.ok(eligible.length >= 3);

      const actions = db.getActions(10, 'bounties');
      const discoveredActions = actions.filter((a) => a.actionType === 'BOUNTY_DISCOVERED');
      assert.strictEqual(discoveredActions.length, eligible.length);
    });

    it('should solve and submit bounty in dry-run mode without external network calls', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: new MockBountyProvider(),
        dryRun: true,
      });

      const task = DEFAULT_MOCK_BOUNTIES[0]; // Docs bounty ($25)
      const solution: BountySolution = {
        bountyId: task.id,
        targetFile: 'README.md',
        patchContent: '--- a/README.md\n+++ b/README.md\n@@ -20,3 +20,3 @@\n-http://broken.example.com\n+https://docs.example.com/guide\n',
        summary: 'Fix documentation anchor link',
        confidence: 0.95,
        testsIncluded: true,
        syntaxValid: true,
      };

      const submission = await scanner.solveAndSubmit(task, solution);

      assert.ok(submission !== null);
      assert.strictEqual(submission.bountyId, task.id);
      assert.strictEqual(submission.rewardClaimed, false);
      assert.ok(submission.prUrl.includes('simulated'));

      // Verify audit action recorded
      const actions = db.getActions(5, 'bounties');
      const submittedAction = actions.find(
        (a) => a.actionType === 'BOUNTY_SUBMISSION_SIMULATED'
      );
      assert.ok(submittedAction !== undefined);
    });

    it('should claim bounty reward, record INCOME_BOUNTY in ledger, and prevent duplicate claims', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: new MockBountyProvider(),
        dryRun: true,
      });

      const task = DEFAULT_MOCK_BOUNTIES[1]; // Unit test bounty ($50.00)
      const solution: BountySolution = {
        bountyId: task.id,
        targetFile: 'test/utils.test.ts',
        patchContent: '--- a/test/utils.test.ts\n+++ b/test/utils.test.ts\n@@ -5,0 +6,5 @@\n+it("handles null", () => {\n+  assert.equal(parseDate(null), null);\n+});\n',
        summary: 'Add null check tests',
        confidence: 0.95,
        testsIncluded: true,
        syntaxValid: true,
      };

      const submission = await scanner.solveAndSubmit(task, solution);
      assert.ok(submission !== null);

      const initialRevenue = db.getTotalRevenue();

      // Claim reward
      const claimResult = scanner.claimReward(task, submission);

      assert.strictEqual(claimResult.success, true);
      assert.strictEqual(claimResult.amountUsd, 50.0);
      assert.strictEqual(claimResult.chain, 'base');
      assert.strictEqual(submission.rewardClaimed, true);

      // Verify SQLite ledger entry
      const ledgerEntries = db.getLedgerEntries(1);
      assert.strictEqual(ledgerEntries.length, 1);
      assert.strictEqual(ledgerEntries[0].entryType, 'INCOME_BOUNTY');
      assert.strictEqual(ledgerEntries[0].amount, 50.0);

      // Verify total revenue incremented
      assert.strictEqual(db.getTotalRevenue(), initialRevenue + 50.0);

      // Verify idempotency: duplicate claim must throw
      assert.throws(() => {
        scanner.claimReward(task, submission);
      }, BountyError);
    });

    it('should aggregate accurate operational track record stats', async () => {
      const scanner = new BountiesScanner({
        database: db,
        provider: new MockBountyProvider(),
        dryRun: true,
      });

      await scanner.scanBounties();

      const task1 = DEFAULT_MOCK_BOUNTIES[0]; // $25
      const task2 = DEFAULT_MOCK_BOUNTIES[1]; // $50

      const sol1: BountySolution = {
        bountyId: task1.id,
        targetFile: 'README.md',
        patchContent: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-typo\n+fixed typo in docs\n',
        summary: 'Fix typo',
        confidence: 0.9,
        testsIncluded: false,
        syntaxValid: true,
      };

      const sub1 = await scanner.solveAndSubmit(task1, sol1);
      if (sub1) scanner.claimReward(task1, sub1);

      const stats = scanner.getStats();

      assert.ok(stats.totalScanned > 0);
      assert.ok(stats.totalFeasible > 0);
      assert.strictEqual(stats.totalSubmissions, 1);
      assert.strictEqual(stats.totalClaimed, 1);
      assert.strictEqual(stats.totalRevenueUsd, 25.0);
      assert.strictEqual(stats.averageRewardUsd, 25.0);
    });
  });
});
