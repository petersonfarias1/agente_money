/**
 * ==============================================================================
 * E2E Test Helper: In-Memory Polymarket CLOB Simulator (`mock_polymarket_clob.ts`)
 * ==============================================================================
 * High-fidelity in-memory orderbook, market registry, and resolution simulator
 * for testing Article II Kelly sizing, scanner feeds, and order fills offline.
 */

import type {
  PolymarketMarket,
  PolymarketOrder,
  OrderOutcome,
} from '../../../src/types.ts';

export class MockPolymarketClob {
  private markets: Map<string, PolymarketMarket> = new Map();
  private orders: PolymarketOrder[] = [];

  /**
   * Registers a prediction market into the mock orderbook.
   */
  public registerMarket(market: PolymarketMarket): void {
    this.markets.set(market.id, { ...market });
  }

  /**
   * Retrieves a market by its identifier.
   */
  public getMarket(marketId: string): PolymarketMarket | undefined {
    return this.markets.get(marketId);
  }

  /**
   * Retrieves all registered prediction markets.
   */
  public getAllMarkets(): PolymarketMarket[] {
    return Array.from(this.markets.values());
  }

  /**
   * Places an order against the mock orderbook.
   * Rejects if market is inactive or already closed.
   */
  public placeOrder(
    order: PolymarketOrder
  ): { orderId: string; status: 'FILLED' | 'REJECTED' } {
    const market = this.markets.get(order.marketId);
    if (!market || !market.active || market.closed) {
      return { orderId: `ord-rej-${Date.now()}`, status: 'REJECTED' };
    }
    const orderId = `ord-${this.orders.length + 1}`;
    this.orders.push({ ...order, orderId, status: 'FILLED' });
    return { orderId, status: 'FILLED' };
  }

  /**
   * Retrieves all placed orders.
   */
  public getOrders(): PolymarketOrder[] {
    return [...this.orders];
  }

  /**
   * Resolves a prediction market with a winning outcome.
   */
  public resolveMarket(
    marketId: string,
    winningOutcome: OrderOutcome
  ): { payoutMultiplier: number } {
    const market = this.markets.get(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found in MockPolymarketClob`);
    }
    market.closed = true;
    market.active = false;
    return { payoutMultiplier: winningOutcome === 'YES' ? 1.0 : 0.0 };
  }

  /**
   * Clears all registered markets and orders.
   */
  public clear(): void {
    this.markets.clear();
    this.orders.length = 0;
  }
}
