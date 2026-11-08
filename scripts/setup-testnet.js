#!/usr/bin/env node
/**
 * ==============================================================================
 * APEX AEA — Gerador Seguro de Carteiras EVM e Configuração Testnet
 * ==============================================================================
 * Gera pares de chaves criptográficas EVM (secp256k1 + Keccak-256 EIP-55)
 * sem dependências externas para:
 *   1. Carteira do Agente (PRIVATE_KEY)
 *   2. Carteira-Mãe do Clã / Royalties (MOTHER_WALLET_ADDRESS)
 *
 * Salva as chaves privadas diretamente no arquivo `.env` (ignorado pelo Git)
 * SEM exibir chaves privadas no terminal ou nos logs, exibindo apenas os
 * endereços públicos (0x...) para abastecimento nos Faucets de Base Sepolia
 * e Polygon Amoy.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envExamplePath = path.join(rootDir, '.env.example');
const envPath = path.join(rootDir, '.env');

// ------------------------------------------------------------------------------
// Implementação Pura Keccak-256 (Ethereum Standard) & EIP-55 Checksum
// ------------------------------------------------------------------------------
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const MASK64 = 0xffffffffffffffffn;

function rotl64(x, n) {
  const bn = BigInt(n);
  return ((x << bn) | (x >> (64n - bn))) & MASK64;
}

function keccakF1600(state) {
  const bc = new Array(5);
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        state[j + i] ^= t;
      }
    }
    let t = state[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      const temp = state[j];
      state[j] = rotl64(t, ROTC[i]);
      t = temp;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = state[j + i];
      for (let i = 0; i < 5; i++) {
        state[j + i] ^= (~bc[(i + 1) % 5] & MASK64) & bc[(i + 2) % 5];
      }
    }
    state[0] ^= RC[round];
  }
}

function keccak256(inputBuffer) {
  const rate = 136; // (1600 - 512) / 8
  const state = new Array(25).fill(0n);
  const padLen = rate - (inputBuffer.length % rate);
  const padded = Buffer.alloc(inputBuffer.length + padLen);
  inputBuffer.copy(padded);
  padded[inputBuffer.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= padded.readBigUInt64LE(offset + i * 8);
    }
    keccakF1600(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(state[i], i * 8);
  }
  return out;
}

function toChecksumAddress(rawHexAddress) {
  const lower = rawHexAddress.replace(/^0x/i, '').toLowerCase();
  const hashHex = keccak256(Buffer.from(lower, 'utf8')).toString('hex');
  let checksum = '0x';
  for (let i = 0; i < 40; i++) {
    checksum += parseInt(hashHex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return checksum;
}

export function deriveEthereumAddress(privateKeyHex) {
  const cleanKey = privateKeyHex.replace(/^0x/i, '');
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(cleanKey, 'hex'));
  const pubKeyUncompressed = ecdh.getPublicKey().subarray(1); // 64 bytes (sem prefixo 0x04)
  const hash = keccak256(pubKeyUncompressed);
  const rawAddr = hash.subarray(12).toString('hex');
  return toChecksumAddress(rawAddr);
}

function generateEvmKeypair() {
  let privBytes;
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  privBytes = ecdh.getPrivateKey();
  // Garante 32 bytes preenchidos à esquerda
  if (privBytes.length < 32) {
    const padded = Buffer.alloc(32);
    privBytes.copy(padded, 32 - privBytes.length);
    privBytes = padded;
  }
  const privateKey = '0x' + privBytes.toString('hex');
  const address = deriveEthereumAddress(privateKey);
  return { privateKey, address };
}

function main() {
  const forceRegenerate = process.argv.includes('--force');

  if (fs.existsSync(envPath) && !forceRegenerate) {
    const existing = fs.readFileSync(envPath, 'utf8');
    const pkMatch = existing.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m);
    const motherMatch = existing.match(/^MOTHER_WALLET_ADDRESS=(0x[0-9a-fA-F]{40})/m);
    const dummyKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    if (pkMatch && pkMatch[1].toLowerCase() !== dummyKey) {
      const agentAddress = deriveEthereumAddress(pkMatch[1]);
      console.log('======================================================================');
      console.log(' [APEX AEA] Arquivo .env já possui carteiras configuradas!');
      console.log('======================================================================');
      console.log(` Endereço Público do Agente : ${agentAddress}`);
      if (motherMatch) {
        console.log(` Endereço da Carteira-Mãe   : ${motherMatch[1]}`);
      }
      console.log('----------------------------------------------------------------------');
      console.log(' (Use "npm run setup:testnet -- --force" se quiser gerar novas)');
      console.log('======================================================================');
      return;
    }
  }

  const agentWallet = generateEvmKeypair();
  const motherWallet = generateEvmKeypair();

  let template = fs.readFileSync(envExamplePath, 'utf8');

  template = template.replace(/^NETWORK_MODE=.*/m, 'NETWORK_MODE=testnet');
  template = template.replace(/^BASE_RPC_URL=.*/m, 'BASE_RPC_URL=https://sepolia.base.org');
  template = template.replace(/^BASE_CHAIN_ID=.*/m, 'BASE_CHAIN_ID=84532');
  template = template.replace(
    /^BASE_USDC_ADDRESS=.*/m,
    'BASE_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e'
  );
  template = template.replace(
    /^POLYGON_RPC_URL=.*/m,
    'POLYGON_RPC_URL=https://rpc-amoy.polygon.technology'
  );
  template = template.replace(/^POLYGON_CHAIN_ID=.*/m, 'POLYGON_CHAIN_ID=80002');
  template = template.replace(
    /^POLYGON_USDC_ADDRESS=.*/m,
    'POLYGON_USDC_ADDRESS=0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'
  );
  template = template.replace(/^PRIVATE_KEY=.*/m, `PRIVATE_KEY=${agentWallet.privateKey}`);
  template = template.replace(
    /^MOTHER_WALLET_ADDRESS=.*/m,
    `MOTHER_WALLET_ADDRESS=${motherWallet.address}\n# Chave privada de backup da Carteira-Mãe (guarde em local seguro):\nMOTHER_PRIVATE_KEY_BACKUP=${motherWallet.privateKey}`
  );
  template = template.replace(/^USE_MOCK_APIS=.*/m, 'USE_MOCK_APIS=true');

  fs.writeFileSync(envPath, template, { encoding: 'utf8', mode: 0o600 });

  console.log('======================================================================');
  console.log(' [APEX AEA] Carteiras EVM Geradas e Salvas com Segurança em .env');
  console.log('======================================================================');
  console.log(' Redes Configuradas no .env:');
  console.log('   - Base Sepolia  (Chain ID: 84532 | RPC: https://sepolia.base.org)');
  console.log('   - Polygon Amoy  (Chain ID: 80002 | RPC: https://rpc-amoy.polygon.technology)');
  console.log('----------------------------------------------------------------------');
  console.log(' 1. Endereço Público do Agente (envie USDC e Gas de teste para cá):');
  console.log(`    ${agentWallet.address}`);
  console.log('');
  console.log(' 2. Endereço Público da Carteira-Mãe (recebedora de 5% de royalties):');
  console.log(`    ${motherWallet.address}`);
  console.log('----------------------------------------------------------------------');
  console.log(' SEGURANÇA: As chaves privadas (PRIVATE_KEY e MOTHER_PRIVATE_KEY_BACKUP)');
  console.log(' foram gravadas apenas localmente no seu arquivo .env (ignorado pelo Git).');
  console.log('======================================================================');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
