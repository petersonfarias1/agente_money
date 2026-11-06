/**
 * ==============================================================================
 * E2E Test Helper: Mock Wallet Harness (`mock_wallet_harness.ts`)
 * ==============================================================================
 * Provides deterministic balance manipulation, insolvency triggers, and transfer
 * inspection for the dual-chain ApexWallet during multi-cycle E2E simulations.
 */

import { ApexWallet } from '../../../src/core/wallet.ts';
import type { SupportedChain, MockTransferRecord } from '../../../src/core/wallet.ts';

export class MockWalletHarness {
  private readonly wallet: ApexWallet;

  constructor(wallet: ApexWallet) {
    this.wallet = wallet;
  }

  /**
   * Sets total balance split evenly across Base and Polygon.
   */
  public setBalance(totalUsd: number): void {
    const half = Number((totalUsd / 2).toFixed(6));
    this.wallet.setMockBalance('base', half);
    this.wallet.setMockBalance('polygon', Number((totalUsd - half).toFixed(6)));
  }

  /**
   * Sets specific balance for a designated chain.
   */
  public setChainBalance(chain: SupportedChain, amountUsd: number): void {
    this.wallet.setMockBalance(chain, amountUsd);
  }

  /**
   * Drops all wallet balances to exactly 0.00 USD (triggers insolvency).
   */
  public simulateInsolvency(): void {
    this.wallet.setMockBalance('base', 0.0);
    this.wallet.setMockBalance('polygon', 0.0);
  }

  /**
   * Simulates a negative balance (debt/deficit).
   */
  public simulateDeficit(deficitUsd: number): void {
    this.wallet.setMockDeficit('base', deficitUsd);
  }

  /**
   * Retrieves all transfers recorded by the mock provider.
   */
  public getExecutedTransfers(): MockTransferRecord[] {
    return this.wallet.getMockTransfers();
  }

  /**
   * Clears the recorded mock transfers.
   */
  public clearTransfers(): void {
    this.wallet.clearMockTransfers();
  }

  /**
   * Convenience getter for total balance across both chains.
   */
  public async getTotalBalance(): Promise<number> {
    return this.wallet.getTotalBalanceUsd();
  }
}
