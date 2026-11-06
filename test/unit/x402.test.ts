/**
 * ==============================================================================
 * Unit Test Suite: x402 Micropayments HTTP Paywall Server
 * ==============================================================================
 * Target: src/modules/micropayments/server.ts
 * Tests:
 * 1. Health check and paywall info public endpoints
 * 2. HTTP 402 Payment Required challenge on gated endpoints
 * 3. Payment proof parsing (raw hash, Bearer header, JSON payload)
 * 4. Dual-layer cryptographic replay defense (in-memory + SQLite ledger)
 * 5. Atomic financial settlement (INCOME_X402 in ledger, actions audit)
 * 6. Method routing, 404 not found, and 405 method not allowed
 * 7. Server lifecycle (ephemeral port binding and graceful shutdown)
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseService } from '../../src/core/database.ts';
import { ApexWallet } from '../../src/core/wallet.ts';
import { X402Server } from '../../src/modules/micropayments/server.ts';
import { loadConfig } from '../../src/config.ts';

describe('x402 Micropayments Paywall Server', () => {
  let db: DatabaseService;
  let wallet: ApexWallet;
  let server: X402Server;
  let baseUrl: string;
  let boundPort: number;
  const pipePath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\apex-x402-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : `/tmp/apex-x402-test-${Date.now()}.sock`;

  async function fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const parsed = new URL(String(url));
    const pathname = parsed.pathname + parsed.search;
    return new Promise((resolve, reject) => {
      const reqHeaders: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            reqHeaders[k] = v;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) reqHeaders[k] = v;
        } else {
          Object.assign(reqHeaders, init.headers);
        }
      }
      const req = http.request(
        {
          socketPath: pipePath,
          path: pathname,
          method: init?.method || 'GET',
          headers: reqHeaders,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const respHeaders = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (Array.isArray(v)) {
                for (const item of v) respHeaders.append(k, item);
              } else if (v !== undefined) {
                respHeaders.set(k, v);
              }
            }
            const bodyBuffer = Buffer.concat(chunks);
            resolve(
              new Response(bodyBuffer, {
                status: res.statusCode,
                headers: respHeaders,
              })
            );
          });
        }
      );
      req.on('error', reject);
      if (init?.body) {
        req.write(typeof init.body === 'string' ? init.body : String(init.body));
      }
      req.end();
    });
  }

  before(async () => {
    db = new DatabaseService(':memory:');
    wallet = new ApexWallet();
    wallet.resetMockState();
    wallet.setMockBalance('base', 50.0);
    wallet.setMockBalance('polygon', 50.0);

    const config = loadConfig();
    server = new X402Server({
      config,
      database: db,
      wallet,
      pipePath,
    });

    boundPort = await server.start();
    baseUrl = 'http://localhost';
  });

  after(async () => {
    await server.stop();
    if (db.isOpen()) {
      db.close();
    }
  });

  describe('1. Public Unmetered Endpoints', () => {
    it('should return 200 OK and metabolic status on GET /health', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.status, 'healthy');
      assert.strictEqual(body.agent, 'Apex-AEA');
      assert.strictEqual(body.tier, 'VERDE');
      assert.strictEqual(body.balanceUsd, 100.0);
      assert.ok(body.serverTime);
    });

    it('should return 200 OK and payment terms on GET /api/paywall/info', async () => {
      const res = await fetch(`${baseUrl}/api/paywall/info`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.service, 'Apex AEA x402 Paywall');
      assert.ok(body.pricing);
      assert.strictEqual(body.pricing.priceUsdc, 0.05);
      assert.strictEqual(body.pricing.chain, 'base');
    });

    it('should return 405 Method Not Allowed on unsupported HTTP verbs for public routes', async () => {
      const res = await fetch(`${baseUrl}/health`, { method: 'PUT' });
      assert.strictEqual(res.status, 405);
      assert.strictEqual(res.headers.get('allow'), 'GET');
    });

    it('should return 404 Not Found on unrecognized routes', async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent`);
      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.error, 'Not Found');
    });
  });

  describe('2. HTTP 402 Payment Required Challenge', () => {
    it('should return HTTP 402 with structured payment invoice when X-Payment-Proof is missing', async () => {
      const res = await fetch(`${baseUrl}/api/analysis`);
      assert.strictEqual(res.status, 402);

      // Verify custom headers
      assert.strictEqual(res.headers.get('x-payment-required'), 'true');
      assert.strictEqual(res.headers.get('x-payment-amount'), '0.05');
      assert.strictEqual(res.headers.get('x-payment-currency'), 'USDC');
      assert.strictEqual(res.headers.get('x-payment-chain'), 'base');
      assert.ok(res.headers.get('x-payment-recipient'));
      assert.ok(res.headers.get('x-payment-nonce'));

      // Verify JSON payload
      const body = await res.json();
      assert.strictEqual(body.error, 'Payment Required');
      assert.strictEqual(body.status, 402);
      assert.ok(body.paymentRequest);
      assert.strictEqual(body.paymentRequest.endpoint, '/api/analysis');
      assert.strictEqual(body.paymentRequest.priceUsdc, 0.05);
      assert.strictEqual(body.paymentRequest.chain, 'base');
      assert.ok(body.paymentRequest.nonce);
      assert.ok(body.instructions);
    });

    it('should reject malformed payment proofs with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': 'not_a_valid_hash',
        },
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error, 'Bad Request');
    });
  });

  describe('3. Payment Proof Verification & Revenue Settlement', () => {
    const validTxHash1 = '0x' + '11'.repeat(32);
    const validTxHash2 = '0x' + '22'.repeat(32);
    const validTxHash3 = '0x' + '33'.repeat(32);

    it('should accept valid raw 32-byte hex txHash, record INCOME_X402 in ledger, and return analysis payload', async () => {
      const initialRevenue = db.getTotalRevenue();

      const res = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': validTxHash1,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-payment-settled'), 'true');
      assert.strictEqual(res.headers.get('x-payment-txhash'), validTxHash1.toLowerCase());

      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.paid, true);
      assert.strictEqual(body.txHash, validTxHash1.toLowerCase());
      assert.strictEqual(body.tier, 'VERDE');
      assert.ok(body.intelligence);
      assert.ok(body.intelligence.opportunities.length > 0);

      // Verify SQLite ledger entry
      const ledgerEntries = db.getLedgerEntries(1);
      assert.strictEqual(ledgerEntries.length, 1);
      assert.strictEqual(ledgerEntries[0].entryType, 'INCOME_X402');
      assert.strictEqual(ledgerEntries[0].amount, 0.05);
      assert.strictEqual(ledgerEntries[0].txHash, validTxHash1.toLowerCase());
      assert.strictEqual(ledgerEntries[0].chain, 'base');

      // Verify total revenue incremented
      assert.strictEqual(db.getTotalRevenue(), initialRevenue + 0.05);

      // Verify audit action
      const actions = db.getActions(1, 'x402_server');
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(actions[0].actionType, 'INCOME_X402_SETTLED');
    });

    it('should accept payment proof via Authorization: Bearer header', async () => {
      const res = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          Authorization: `Bearer ${validTxHash2}`,
        },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.paid, true);
      assert.strictEqual(body.txHash, validTxHash2.toLowerCase());
    });

    it('should accept JSON formatted proof payload', async () => {
      const jsonProof = JSON.stringify({
        txHash: validTxHash3,
        payer: '0x9999999999999999999999999999999999999999',
      });

      const res = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': jsonProof,
        },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.paid, true);
      assert.strictEqual(body.txHash, validTxHash3.toLowerCase());
    });
  });

  describe('4. Cryptographic Replay Defense', () => {
    const replayTxHash = '0x' + 'aa'.repeat(32);

    it('should prevent replay drain attacks and reject duplicate submissions with 409 Conflict', async () => {
      // First attempt: Valid
      const res1 = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': replayTxHash,
        },
      });
      assert.strictEqual(res1.status, 200);

      const ledgerCountBefore = db.getLedgerEntries(100).length;

      // Second attempt with exact same txHash: Replay attack
      const res2 = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': replayTxHash,
        },
      });

      assert.strictEqual(res2.status, 409);
      const body2 = await res2.json();
      assert.strictEqual(body2.error, 'Payment Replay Detected');
      assert.strictEqual(body2.status, 409);

      // Ledger count must NOT increase
      const ledgerCountAfter = db.getLedgerEntries(100).length;
      assert.strictEqual(ledgerCountAfter, ledgerCountBefore);

      // Action audit record for replay prevention
      const actions = db.getActions(5, 'x402_server');
      const replayAction = actions.find((a) => a.actionType === 'REPLAY_ATTACK_PREVENTED');
      assert.ok(replayAction !== undefined, 'Audit record for REPLAY_ATTACK_PREVENTED must exist');
    });

    it('should enforce replay defense across separate server instances using persistent SQLite ledger', async () => {
      const crossInstanceTxHash = '0x' + 'bb'.repeat(32);

      // Insert directly into ledger to simulate an earlier session
      db.insertLedger({
        txHash: crossInstanceTxHash.toLowerCase(),
        chain: 'base',
        token: 'USDC',
        amount: 0.05,
        entryType: 'INCOME_X402',
        timestamp: Date.now() - 10000,
      });

      // Submit against running server
      const res = await fetch(`${baseUrl}/api/analysis`, {
        headers: {
          'X-Payment-Proof': crossInstanceTxHash,
        },
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.strictEqual(body.error, 'Payment Replay Detected');
    });
  });

  describe('5. Server Lifecycle & Permadeath Teardown', () => {
    it('should report correct running state and bound port', () => {
      assert.strictEqual(server.isRunning(), true);
      assert.strictEqual(server.getPort(), boundPort);
    });

    it('should stop cleanly and release the listening port', async () => {
      const tempServer = new X402Server({
        database: db,
        wallet,
        port: 0,
      });

      const tempPort = await tempServer.start();
      assert.strictEqual(tempServer.isRunning(), true);

      await tempServer.stop();
      assert.strictEqual(tempServer.isRunning(), false);
    });
  });
});
