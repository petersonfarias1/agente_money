/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Polymarket CLOB Market Scanner
 * ==============================================================================
 * Discovers and filters binary prediction markets on Polymarket:
 * - Ingests active markets from CLOB / Gamma API or deterministic mock catalog
 * - Filters for liquidity, volume, active status, future resolution date, price bounds
 * - Compares market implied odds against AI/forecasting model estimates
 * - Evaluates opportunities through Fractional Kelly engine
 * - Returns prioritized candidate opportunities
 */

import type { PolymarketMarket, OrderOutcome } from '../../types.ts';
import { calculateKellyStake, type KellyOptions } from './kelly.ts';
import type { KellyCalculation } from '../../types.ts';

export interface PolymarketOpportunity {
  market: PolymarketMarket;
  outcome: OrderOutcome; // 'YES' | 'NO'
  marketPrice: number;
  estimatedProb: number;
  edge: number;          // estimatedProb - marketPrice
  kelly: KellyCalculation;
}

export interface ScannerFilterOptions {
  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  minEdge?: number;
  maxDaysToResolution?: number;
  kellyOptions?: KellyOptions;
}

export type ProbabilityEstimator = (
  market: PolymarketMarket
) => Promise<{ pYes: number; pNo: number } | null> | { pYes: number; pNo: number } | null;

/**
 * Standard deterministic mock catalog for offline development and testing.
 */
export function getStandardMockMarkets(): PolymarketMarket[] {
  const now = Date.now();
  const dayMs = 86400000;

  return [
    {
      id: 'market-eth-upgrade-q4',
      conditionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
      question: 'Will Ethereum upgrade execute in Q4?',
      slug: 'ethereum-upgrade-q4',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.40, 0.60],
      impliedProbability: 0.40,
      liquidityUsd: 125000,
      volume24hUsd: 18500,
      endDate: new Date(now + 30 * dayMs).toISOString(),
      active: true,
      closed: false,
    },
    {
      id: 'market-cpi-above-target',
      conditionId: '0x2000000000000000000000000000000000000000000000000000000000000002',
      question: 'Will US CPI exceed 3.5% this month?',
      slug: 'us-cpi-exceed-35',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.70, 0.30],
      impliedProbability: 0.70,
      liquidityUsd: 84000,
      volume24hUsd: 9200,
      endDate: new Date(now + 14 * dayMs).toISOString(),
      active: true,
      closed: false,
    },
    {
      id: 'market-btc-150k-month',
      conditionId: '0x3000000000000000000000000000000000000000000000000000000000000003',
      question: 'Will Bitcoin hit $150k this month?',
      slug: 'btc-150k-month',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.50, 0.50],
      impliedProbability: 0.50,
      liquidityUsd: 550000,
      volume24hUsd: 62000,
      endDate: new Date(now + 20 * dayMs).toISOString(),
      active: true,
      closed: false,
    },
    {
      id: 'market-low-liquidity-trap',
      conditionId: '0x4000000000000000000000000000000000000000000000000000000000000004',
      question: 'Will local municipal referendum pass?',
      slug: 'local-referendum-pass',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.45, 0.55],
      impliedProbability: 0.45,
      liquidityUsd: 120, // Discarded: < $500 minimum liquidity
      volume24hUsd: 25,
      endDate: new Date(now + 10 * dayMs).toISOString(),
      active: true,
      closed: false,
    },
    {
      id: 'market-closed-settled',
      conditionId: '0x5000000000000000000000000000000000000000000000000000000000000005',
      question: 'Did yesterday election conclude?',
      slug: 'yesterday-election',
      outcomes: ['YES', 'NO'],
      outcomePrices: [1.00, 0.00],
      impliedProbability: 1.00,
      liquidityUsd: 0,
      volume24hUsd: 0,
      endDate: new Date(now - dayMs).toISOString(),
      active: false, // Discarded: inactive
      closed: true,  // Discarded: closed
    },
    {
      id: 'market-past-end-date',
      conditionId: '0x6000000000000000000000000000000000000000000000000000000000000006',
      question: 'Will Fed meet before yesterday?',
      slug: 'fed-meet-yesterday',
      outcomes: ['YES', 'NO'],
      outcomePrices: [0.50, 0.50],
      impliedProbability: 0.50,
      liquidityUsd: 10000,
      volume24hUsd: 500,
      endDate: new Date(now - 2 * dayMs).toISOString(), // Discarded: past end date
      active: true,
      closed: false,
    },
  ];
}

export class PolymarketScanner {
  private readonly clobApiUrl: string;
  private readonly isMock: boolean;
  private readonly mockCatalog: PolymarketMarket[];

  constructor(
    clobApiUrl: string = 'https://clob.polymarket.com',
    isMock: boolean = true,
    mockMarkets?: PolymarketMarket[]
  ) {
    this.clobApiUrl = clobApiUrl;
    this.isMock = isMock;
    this.mockCatalog = mockMarkets ? [...mockMarkets] : getStandardMockMarkets();
  }

  /**
   * Fetches active Polymarket candidate markets applying quality and liquidity filters.
   */
  public async fetchMarkets(filterOptions?: ScannerFilterOptions): Promise<PolymarketMarket[]> {
    const minLiquidity = filterOptions?.minLiquidityUsd ?? 500.0;
    const minVolume = filterOptions?.minVolume24hUsd ?? 100.0;
    const now = Date.now();

    let rawMarkets: PolymarketMarket[] = [];

    if (this.isMock) {
      rawMarkets = this.mockCatalog;
    } else {
      try {
        const response = await fetch(`${this.clobApiUrl}/markets`);
        if (!response.ok) {
          throw new Error(`CLOB API HTTP ${response.status}: ${response.statusText}`);
        }
        rawMarkets = (await response.json()) as PolymarketMarket[];
      } catch (err) {
        // Fallback to internal catalog if network fails
        rawMarkets = this.mockCatalog;
      }
    }

    // Filter pipeline
    return rawMarkets.filter((market) => {
      // 1. Must be active and not closed
      if (!market.active || market.closed) return false;

      // 2. Must resolve in the future
      if (market.endDate) {
        const endTimestamp = new Date(market.endDate).getTime();
        if (Number.isFinite(endTimestamp) && endTimestamp <= now) {
          return false;
        }

        if (filterOptions?.maxDaysToResolution) {
          const maxResolutionMs = now + filterOptions.maxDaysToResolution * 86400000;
          if (endTimestamp > maxResolutionMs) return false;
        }
      }

      // 3. Liquidity and volume thresholds
      if (market.liquidityUsd < minLiquidity) return false;
      if (market.volume24hUsd < minVolume) return false;

      // 4. Valid outcome prices
      if (!market.outcomePrices || market.outcomePrices.length < 2) return false;
      const pYes = Number(market.outcomePrices[0]);
      const pNo = Number(market.outcomePrices[1]);

      if (!Number.isFinite(pYes) || !Number.isFinite(pNo)) return false;
      if (pYes < 0.02 || pYes > 0.98) return false;
      if (pNo < 0.02 || pNo > 0.98) return false;

      return true;
    });
  }

  /**
   * Scans candidate markets, queries probability estimator, and returns authorized opportunities
   * sorted by edge in descending order.
   */
  public async scanOpportunities(
    bankrollUsd: number,
    estimator?: ProbabilityEstimator,
    filterOptions?: ScannerFilterOptions
  ): Promise<PolymarketOpportunity[]> {
    const markets = await this.fetchMarkets(filterOptions);
    const opportunities: PolymarketOpportunity[] = [];
    const minEdge = filterOptions?.minEdge ?? 0.02; // minimum 2% estimated edge

    // Default heuristic estimator for mock markets if none provided
    const resolveProb =
      estimator ??
      (async (m: PolymarketMarket) => {
        // Deterministic heuristics based on market ID for testing
        if (m.id.includes('eth-upgrade')) return { pYes: 0.65, pNo: 0.35 };
        if (m.id.includes('cpi-above')) return { pYes: 0.40, pNo: 0.60 }; // NO edge
        if (m.id.includes('btc-150k')) return { pYes: 0.45, pNo: 0.55 }; // Disadvantage on YES
        return null;
      });

    for (const market of markets) {
      const priceYes = Number(market.outcomePrices[0]);
      const priceNo = Number(market.outcomePrices[1]);

      let estimate: { pYes: number; pNo: number } | null = null;
      try {
        estimate = await resolveProb(market);
      } catch {
        continue;
      }

      if (!estimate) continue;

      // Evaluate YES Opportunity
      if (estimate.pYes > priceYes) {
        const edge = estimate.pYes - priceYes;
        if (edge >= minEdge) {
          const kelly = calculateKellyStake(
            priceYes,
            estimate.pYes,
            bankrollUsd,
            filterOptions?.kellyOptions
          );
          if (kelly.authorized) {
            opportunities.push({
              market,
              outcome: 'YES',
              marketPrice: priceYes,
              estimatedProb: estimate.pYes,
              edge,
              kelly,
            });
          }
        }
      }

      // Evaluate NO Opportunity
      if (estimate.pNo > priceNo) {
        const edge = estimate.pNo - priceNo;
        if (edge >= minEdge) {
          const kelly = calculateKellyStake(
            priceNo,
            estimate.pNo,
            bankrollUsd,
            filterOptions?.kellyOptions
          );
          if (kelly.authorized) {
            opportunities.push({
              market,
              outcome: 'NO',
              marketPrice: priceNo,
              estimatedProb: estimate.pNo,
              edge,
              kelly,
            });
          }
        }
      }
    }

    // Sort opportunities by edge descending (highest edge first)
    return opportunities.sort((a, b) => b.edge - a.edge);
  }
}
