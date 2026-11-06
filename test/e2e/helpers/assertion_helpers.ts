/**
 * ==============================================================================
 * E2E Test Helper: Constitutional Invariant Assertions (`assertion_helpers.ts`)
 * ==============================================================================
 * Strict validation utilities for verifying Constitutional Articles I through VII:
 * - Quarter-Kelly sizing & 5% bankroll cap
 * - Strictly positive EV hurdle
 * - Tombstone post-mortem snapshot structural compliance
 * - Metabolic tier threshold bounds
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Tombstone, MetabolicTier } from '../../../src/types.ts';

export class ConstitutionalAssert {
  /**
   * Asserts that a position stake does not exceed 5% of total bankroll (Article II).
   */
  public static assertQuarterKellyCap(stakeUsd: number, totalBankroll: number): void {
    const maxStake = Number((totalBankroll * 0.05).toFixed(6));
    assert.ok(
      stakeUsd <= maxStake + 0.00001,
      `Constitutional Violation: Stake ($${stakeUsd}) exceeds 5% bankroll cap ($${maxStake})`
    );
  }

  /**
   * Asserts strictly positive EV hurdle: b * p - q > 0 (Article II).
   */
  public static assertStrictPositiveEv(b: number, p: number, q: number): void {
    const ev = b * p - q;
    assert.ok(
      ev > 0,
      `Constitutional Violation: Bet authorized with non-positive EV (${ev})`
    );
  }

  /**
   * Asserts validity and schema compliance of `tombstone.json` snapshot (Article IV).
   */
  public static assertTombstoneSnapshot(filePath: string): Tombstone {
    assert.ok(fs.existsSync(filePath), `Tombstone file does not exist at ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const tombstone: Tombstone = JSON.parse(content);

    assert.ok(tombstone.agentAddress, 'Tombstone must contain agentAddress');
    assert.equal(tombstone.finalBalanceUsd, 0.0, 'Tombstone finalBalanceUsd must be exactly 0.00');
    assert.ok(tombstone.deathTimestamp, 'Tombstone must contain deathTimestamp');
    assert.ok(
      Array.isArray(tombstone.finalLedgerSnapshot),
      'Tombstone must include finalLedgerSnapshot array'
    );
    return tombstone;
  }

  /**
   * Asserts that wallet balance falls within the constitutional bounds of the metabolic tier (Article III).
   */
  public static assertTierInvariants(tier: MetabolicTier, balanceUsd: number): void {
    if (tier === 'VERDE') {
      assert.ok(
        balanceUsd > 50.0,
        `Tier VERDE requires balance > 50.00, received ${balanceUsd}`
      );
    } else if (tier === 'AMARELO') {
      assert.ok(
        balanceUsd >= 10.0 && balanceUsd <= 50.0,
        `Tier AMARELO requires 10.00 <= balance <= 50.00, received ${balanceUsd}`
      );
    } else if (tier === 'LARANJA') {
      assert.ok(
        balanceUsd > 0.0 && balanceUsd < 10.0,
        `Tier LARANJA requires 0.00 < balance < 10.00, received ${balanceUsd}`
      );
    } else if (tier === 'VERMELHO') {
      assert.ok(
        balanceUsd <= 0.0,
        `Tier VERMELHO requires balance <= 0.00, received ${balanceUsd}`
      );
    }
  }

  /**
   * Asserts that an error represents a Constitutional Whitelist violation (Article I).
   */
  public static assertWhitelistViolation(error: unknown): void {
    assert.ok(error instanceof Error, 'Expected error to be thrown');
    assert.match(error.message, /Constitutional Violation|Whitelist|prohibited/i);
  }

  /**
   * Asserts that balance satisfies the 3x initial capital threshold for Mitosis (Article VI).
   */
  public static assertMitosisThreshold(
    balanceUsd: number,
    initialCapitalUsd: number = 50.0,
    multiplier: number = 3.0
  ): void {
    const required = initialCapitalUsd * multiplier;
    assert.ok(
      balanceUsd >= required,
      `Mitosis requires balance >= ${required}, received ${balanceUsd}`
    );
  }

  /**
   * Asserts that `src/constitution.md` exists and contains all 7 Constitutional Articles.
   */
  public static assertConstitutionComplete(filePath: string): void {
    assert.ok(fs.existsSync(filePath), `Constitution file does not exist at ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const articles = [
      'Article I',
      'Article II',
      'Article III',
      'Article IV',
      'Article V',
      'Article VI',
      'Article VII',
    ];
    for (const article of articles) {
      assert.ok(content.includes(article), `Constitution missing ${article}`);
    }
  }
}
