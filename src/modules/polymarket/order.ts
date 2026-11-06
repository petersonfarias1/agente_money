/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Polymarket Order & Position Manager
 * ==============================================================================
 * Manages the complete lifecycle of prediction market positions:
 * - Order placement with paper-trading simulation and bankroll checks
 * - Atomic persistence into SQLite `polymarket_positions` table
 * - Strict position resolution handling (WON / LOST / CANCELLED)
 * - Payout recording in SQLite financial ledger (INCOME_POLYMARKET)
 * - Automatic Permadeath teardown hook unmounting open orders (Article IV.2)
 * - Quantitative track record aggregation (win rate, total staked, net profit)
 */

import { DatabaseService, type PolymarketPositionRecord } from '../../core/database.ts';
import {
  type WalletClient,
  type PositionStatus,
  type OrderOutcome,
  KellyRiskError,
} from '../../types.ts';
import { InsufficientBalanceError } from '../../core/wallet.ts';
import { registerTeardownHook } from '../../core/death.ts';
import type { PolymarketOpportunity } from './scanner.ts';

export interface PlaceOrderOptions {
  paperTrading?: boolean;
  notes?: string;
}

export interface PositionSummary {
  totalPositions: number;
  openPositions: number;
  wonPositions: number;
  lostPositions: number;
  cancelledPositions: number;
  totalStakedUsd: number;
  totalPayoutUsd: number;
  netProfitUsd: number;
  winRate: number; // 0.0 to 1.0 (won / (won + lost))
}

export class OrderManager {
  private readonly database: DatabaseService;
  private readonly wallet: WalletClient;
  private readonly isMock: boolean;

  constructor(database: DatabaseService, wallet: WalletClient, isMock: boolean = true) {
    this.database = database;
    this.wallet = wallet;
    this.isMock = isMock;

    // Inviolable Permadeath Integration (Constitution Article IV.2)
    // "Cancel all open and unfilled limit orders across all prediction markets"
    registerTeardownHook(async () => {
      this.cancelAllOpenOrders('Permadeath initiated');
    });
  }

  /**
   * Places an order for an authorized Polymarket opportunity.
   * Enforces Kelly authorization and bankroll checks.
   */
  public async placeOrder(
    opportunity: PolymarketOpportunity,
    options?: PlaceOrderOptions
  ): Promise<PolymarketPositionRecord> {
    // 1. Inviolable Kelly Risk Hurdle Check
    if (!opportunity.kelly.authorized) {
      throw new KellyRiskError(
        `Cannot place order: Opportunity failed Kelly criteria (${
          opportunity.kelly.rejectionReason ?? 'UNAUTHORIZED'
        }).`
      );
    }

    const stakeUsd = opportunity.kelly.stakeAmountUsd;
    if (stakeUsd <= 0) {
      throw new KellyRiskError('Cannot place order with zero or negative stake amount.');
    }

    // 2. Liquid Solvency Verification
    const currentBalance = await this.wallet.getTotalBalanceUsd();
    if (stakeUsd > currentBalance) {
      throw new InsufficientBalanceError('polygon', stakeUsd, currentBalance);
    }

    // 3. Mathematical Order Sizing
    // shares = stakeUsd / marketPrice (each share pays $1.00 USD on winning resolution)
    const shares = Number((stakeUsd / opportunity.marketPrice).toFixed(6));
    const avgPrice = opportunity.marketPrice;
    const currentValue = stakeUsd;
    const openedAt = new Date().toISOString();

    // 4. Atomic SQLite Persistence
    const positionId = this.database.savePosition({
      conditionId: opportunity.market.conditionId || opportunity.market.id,
      marketId: opportunity.market.id,
      question: opportunity.market.question,
      outcome: opportunity.outcome,
      shares,
      avgPrice,
      currentValue,
      stakeUsd,
      status: 'OPEN',
      openedAt,
    });

    // 5. Audit Logging
    try {
      this.database.recordAction({
        component: 'polymarket',
        actionType: 'ORDER_PLACED',
        details: JSON.stringify({
          positionId,
          marketId: opportunity.market.id,
          question: opportunity.market.question,
          outcome: opportunity.outcome,
          shares,
          avgPrice,
          stakeUsd,
          paperTrading: options?.paperTrading ?? this.isMock,
          notes: options?.notes,
        }),
        tier: 'VERDE',
        balanceUsd: currentBalance,
        timestamp: Date.now(),
      });
    } catch {
      // Non-fatal if action logging fails
    }

    const savedPosition = this.database.getPositionById(positionId);
    if (!savedPosition) {
      throw new Error(`Failed to retrieve newly created position with id ${positionId}.`);
    }

    return savedPosition;
  }

  /**
   * Resolves a position based on market outcome.
   * If winning: pays $1.00 per share, inserts INCOME_POLYMARKET into financial ledger.
   * If losing: payout is $0.00.
   */
  public resolvePosition(
    positionId: number,
    winningOutcome: OrderOutcome
  ): PolymarketPositionRecord {
    const pos = this.database.getPositionById(positionId);
    if (!pos) {
      throw new Error(`Position with id ${positionId} does not exist.`);
    }

    if (pos.status !== 'OPEN') {
      return pos; // Already closed
    }

    const won = pos.outcome === winningOutcome;
    const status: PositionStatus = won ? 'WON' : 'LOST';
    const payoutUsd = won ? Number((pos.shares * 1.0).toFixed(6)) : 0.0;
    const closedAt = new Date().toISOString();

    // Update position in SQLite
    this.database.updatePositionStatus(positionId, status, payoutUsd, closedAt);

    // If winning, record revenue in the immutable financial ledger
    if (won && payoutUsd > 0) {
      this.database.insertLedger({
        chain: 'polygon',
        token: 'USDC',
        amount: payoutUsd,
        entryType: 'INCOME_POLYMARKET',
        counterparty: 'Polymarket CTF',
        timestamp: Date.now(),
      });
    }

    // Audit logging
    try {
      this.database.recordAction({
        component: 'polymarket',
        actionType: won ? 'POSITION_RESOLVED_WON' : 'POSITION_RESOLVED_LOST',
        details: JSON.stringify({
          positionId,
          outcome: pos.outcome,
          winningOutcome,
          payoutUsd,
          netProfitUsd: won ? payoutUsd - pos.stakeUsd : -pos.stakeUsd,
        }),
        tier: 'VERDE',
        balanceUsd: 0,
        timestamp: Date.now(),
      });
    } catch {
      // Non-fatal
    }

    return this.database.getPositionById(positionId)!;
  }

  /**
   * Cancels an open position (market invalidation or refund).
   */
  public cancelPosition(positionId: number, reason?: string): PolymarketPositionRecord {
    const pos = this.database.getPositionById(positionId);
    if (!pos) {
      throw new Error(`Position with id ${positionId} does not exist.`);
    }

    if (pos.status !== 'OPEN') {
      return pos;
    }

    const closedAt = new Date().toISOString();
    this.database.updatePositionStatus(positionId, 'CANCELLED', pos.stakeUsd, closedAt);

    try {
      this.database.recordAction({
        component: 'polymarket',
        actionType: 'POSITION_CANCELLED',
        details: JSON.stringify({ positionId, reason }),
        tier: 'VERDE',
        balanceUsd: 0,
        timestamp: Date.now(),
      });
    } catch {
      // Non-fatal
    }

    return this.database.getPositionById(positionId)!;
  }

  /**
   * Cancels all open positions. Used during Permadeath and emergency halts.
   */
  public cancelAllOpenOrders(reason: string = 'Emergency liquidation'): number {
    const openPositions = this.database.getPositions(1000, 'OPEN');
    let cancelledCount = 0;

    for (const pos of openPositions) {
      if (pos.id !== undefined) {
        this.cancelPosition(pos.id, reason);
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  /**
   * Aggregates track record performance metrics for Darwinian Mitosis and Tombstone.
   */
  public getPositionSummary(): PositionSummary {
    const allPositions = this.database.getPositions(1000);

    let openCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let cancelledCount = 0;
    let totalStaked = 0;
    let totalPayout = 0;

    for (const p of allPositions) {
      totalStaked += p.stakeUsd;
      if (p.payoutUsd) totalPayout += p.payoutUsd;

      switch (p.status) {
        case 'OPEN':
          openCount++;
          break;
        case 'WON':
          wonCount++;
          break;
        case 'LOST':
          lostCount++;
          break;
        case 'CANCELLED':
          cancelledCount++;
          break;
      }
    }

    const settledCount = wonCount + lostCount;
    const winRate = settledCount > 0 ? Number((wonCount / settledCount).toFixed(4)) : 0.0;
    const netProfitUsd = Number((totalPayout - totalStaked).toFixed(6));

    return {
      totalPositions: allPositions.length,
      openPositions: openCount,
      wonPositions: wonCount,
      lostPositions: lostCount,
      cancelledPositions: cancelledCount,
      totalStakedUsd: Number(totalStaked.toFixed(6)),
      totalPayoutUsd: Number(totalPayout.toFixed(6)),
      netProfitUsd,
      winRate,
    };
  }
}
