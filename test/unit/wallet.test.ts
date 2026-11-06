/**
 * ==============================================================================
 * Unit Tests: Sovereign Core Wallet Engine (`src/core/wallet.ts`)
 * ==============================================================================
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApexWallet,
  createApexWallet,
  getWallet,
  resetWallet,
  usdcUnitsToNumber,
  numberToUsdcUnits,
  WalletError,
  InsufficientBalanceError,
  InvalidAddressError,
  NetworkError,
  ZERO_ADDRESS,
  DEFAULT_WHITELISTED_EXCHANGES,
} from '../../src/core/wallet.ts';
import { ConstitutionViolationError } from '../../src/types.ts';
import { loadConfig, DEFAULT_MOCK_PRIVATE_KEY } from '../../src/config.ts';

describe('Core ApexWallet Unit Tests', () => {
  let wallet: ApexWallet;

  beforeEach(() => {
    resetWallet();
    const config = loadConfig({
      NETWORK_MODE: 'mock',
      MOCK_WALLET_BALANCE_USD: '75.00',
      MOTHER_WALLET_ADDRESS: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    wallet = new ApexWallet(config);
  });

  describe('1. Address Derivation & Config Initialization', () => {
    it('should derive a valid 20-byte EVM address with 0x prefix', () => {
      const address = wallet.getAddress();
      assert.match(address, /^0x[0-9a-fA-F]{40}$/);
    });

    it('should split mock initial balance evenly across Base and Polygon', async () => {
      const base = await wallet.getBaseUsdcBalance();
      const polygon = await wallet.getPolygonUsdcBalance();
      const total = await wallet.getTotalBalanceUsd();

      assert.equal(base, 37.5);
      assert.equal(polygon, 37.5);
      assert.equal(total, 75.0);
    });

    it('should return complete timestamped balance breakdown', async () => {
      const breakdown = await wallet.getBalanceBreakdown();
      assert.equal(breakdown.baseUsdc, 37.5);
      assert.equal(breakdown.polygonUsdc, 37.5);
      assert.equal(breakdown.totalUsd, 75.0);
      assert.ok(breakdown.timestamp > 0);
    });
  });

  describe('2. USDC 6-Decimal Conversion Arithmetic', () => {
    it('should convert raw units to USD number accurately', () => {
      assert.equal(usdcUnitsToNumber(1_000_000n), 1.0);
      assert.equal(usdcUnitsToNumber(50_000n), 0.05);
      assert.equal(usdcUnitsToNumber(50_000_000n), 50.0);
      assert.equal(usdcUnitsToNumber(1n), 0.000001);
      assert.equal(usdcUnitsToNumber(0n), 0.0);
    });

    it('should convert USD numbers to raw BigInt units accurately', () => {
      assert.equal(numberToUsdcUnits(1.0), 1_000_000n);
      assert.equal(numberToUsdcUnits(0.05), 50_000n);
      assert.equal(numberToUsdcUnits(50.0), 50_000_000n);
      assert.equal(numberToUsdcUnits(0.000001), 1n);
    });

    it('should reject invalid or negative numbers for unit conversion', () => {
      assert.throws(() => numberToUsdcUnits(-10), WalletError);
      assert.throws(() => numberToUsdcUnits(NaN), WalletError);
      assert.throws(() => numberToUsdcUnits(Infinity), WalletError);
    });
  });

  describe('3. Mock Balance Mutations & State Control', () => {
    it('should update mock balance per chain and adjust total balance', async () => {
      wallet.setMockBalance('base', 60.0);
      assert.equal(await wallet.getBaseUsdcBalance(), 60.0);
      assert.equal(await wallet.getPolygonUsdcBalance(), 37.5);
      assert.equal(await wallet.getTotalBalanceUsd(), 97.5);

      wallet.setMockBalances({ base: 10.0, polygon: 5.0 });
      assert.equal(await wallet.getBaseUsdcBalance(), 10.0);
      assert.equal(await wallet.getPolygonUsdcBalance(), 5.0);
      assert.equal(await wallet.getTotalBalanceUsd(), 15.0);
    });

    it('should reject negative balance setting', () => {
      assert.throws(() => wallet.setMockBalance('base', -5), WalletError);
    });

    it('should reset mock state to initial config defaults', async () => {
      wallet.setMockBalances({ base: 0, polygon: 0 });
      assert.equal(await wallet.getTotalBalanceUsd(), 0);

      wallet.resetMockState();
      assert.equal(await wallet.getTotalBalanceUsd(), 75.0);
      assert.equal(wallet.getMockTransfers().length, 0);
    });
  });

  describe('4. Whitelist Management (Article I)', () => {
    it('should initialize with Mother Clan Wallet and default exchange contracts', () => {
      assert.equal(
        wallet.isWhitelisted('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
        true
      );
      assert.equal(
        wallet.isWhitelisted('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'),
        true
      );
      assert.equal(
        wallet.isWhitelisted('0xC5d563A36AE78145C45a50134d48A1215220f80a'),
        true
      );
    });

    it('should add new addresses to whitelist and support removal', () => {
      const childWallet = '0x1234567890123456789012345678901234567890';
      assert.equal(wallet.isWhitelisted(childWallet), false);

      wallet.addToWhitelist(childWallet, 'CHILD_SUB_WALLET', 'Child Gen 1');
      assert.equal(wallet.isWhitelisted(childWallet), true);

      const removed = wallet.removeFromWhitelist(childWallet);
      assert.equal(removed, true);
      assert.equal(wallet.isWhitelisted(childWallet), false);
    });

    it('should reject adding zero address to whitelist with ConstitutionViolationError', () => {
      assert.throws(
        () => wallet.addToWhitelist(ZERO_ADDRESS),
        ConstitutionViolationError
      );
    });

    it('should reject adding malformed address to whitelist with InvalidAddressError', () => {
      assert.throws(
        () => wallet.addToWhitelist('0xnotanaddress'),
        InvalidAddressError
      );
    });
  });

  describe('5. Constitutional Transfer Validation & Execution', () => {
    const motherWallet = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const unknownWallet = '0x9999999999999999999999999999999999999999';

    it('should execute valid transfer to whitelisted recipient and deduct balance', async () => {
      wallet.setMockBalance('base', 50.0);
      const txHash = await wallet.transferUsdc('base', motherWallet, 10.0);

      assert.match(txHash, /^0x[0-9a-fA-F]{64}$/);
      assert.equal(await wallet.getBaseUsdcBalance(), 40.0);

      const records = wallet.getMockTransfers();
      assert.equal(records.length, 1);
      assert.equal(records[0].txHash, txHash);
      assert.equal(records[0].amountUsd, 10.0);
      assert.equal(records[0].chain, 'base');
    });

    it('should reject transfer to zero address with ConstitutionViolationError', async () => {
      await assert.rejects(
        () => wallet.transferUsdc('base', ZERO_ADDRESS, 5.0),
        ConstitutionViolationError
      );
    });

    it('should reject transfer to non-whitelisted address with ConstitutionViolationError', async () => {
      await assert.rejects(
        () => wallet.transferUsdc('base', unknownWallet, 5.0),
        ConstitutionViolationError
      );
    });

    it('should reject transfer exceeding balance with InsufficientBalanceError', async () => {
      wallet.setMockBalance('base', 5.0);
      await assert.rejects(
        () => wallet.transferUsdc('base', motherWallet, 10.0),
        InsufficientBalanceError
      );
    });

    it('should reject non-positive or sub-atomic amounts with WalletError', async () => {
      await assert.rejects(
        () => wallet.transferUsdc('base', motherWallet, 0),
        WalletError
      );
      await assert.rejects(
        () => wallet.transferUsdc('base', motherWallet, -5.0),
        WalletError
      );
      await assert.rejects(
        () => wallet.transferUsdc('base', motherWallet, 0.0000001),
        WalletError
      );
    });

    it('should reject invalid recipient address string with InvalidAddressError', async () => {
      await assert.rejects(
        () => wallet.transferUsdc('base', 'invalid-address', 10.0),
        InvalidAddressError
      );
    });
  });

  describe('6. Error Simulation & Fault Injection', () => {
    it('should simulate network failure when simulateError is enabled', async () => {
      wallet.setSimulateError(true);

      await assert.rejects(
        () => wallet.getBaseUsdcBalance(),
        NetworkError
      );

      await assert.rejects(
        () => wallet.getPolygonUsdcBalance(),
        NetworkError
      );

      await assert.rejects(
        () =>
          wallet.transferUsdc(
            'base',
            '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            5.0
          ),
        NetworkError
      );
    });
  });

  describe('7. Singleton Helper getWallet', () => {
    it('should return and cache singleton instance', () => {
      const w1 = getWallet();
      const w2 = getWallet();
      assert.strictEqual(w1, w2);
      resetWallet();
    });
  });
});
