#!/usr/bin/env node
/**
 * ==============================================================================
 * APEX AEA — Verificador de Saldo On-Chain (Base Sepolia & Polygon Amoy)
 * ==============================================================================
 * Consulta em tempo real os saldos de Gas nativo (ETH / POL) e de USDC
 * da carteira do agente configurada no `.env` via JSON-RPC nativo.
 */

import { loadConfig } from '../src/config.ts';
import { ApexWallet } from '../src/core/wallet.ts';
import { deriveEthereumAddress } from './setup-testnet.js';

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

async function getNativeBalance(rpcUrl, address) {
  const hex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  return Number(BigInt(hex)) / 1e18;
}

async function getErc20Balance(rpcUrl, tokenAddress, walletAddress) {
  // balanceOf(address) selector: 0x70a08231 + 32-byte padded address
  const cleanAddr = walletAddress.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  const data = '0x70a08231' + cleanAddr;
  const hex = await rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
  if (!hex || hex === '0x') return 0;
  return Number(BigInt(hex)) / 1e6; // USDC 6 decimals
}

async function main() {
  const config = loadConfig();
  const wallet = new ApexWallet(config);
  const address = deriveEthereumAddress(config.privateKey);

  console.log('======================================================================');
  console.log(` [APEX AEA] Diagnóstico de Carteira (${config.networkMode.toUpperCase()})`);
  console.log('======================================================================');
  console.log(` Endereço do Agente  : ${address}`);
  console.log(` Carteira-Mãe (Clã)  : ${config.motherWalletAddress}`);
  console.log('----------------------------------------------------------------------');

  if (config.networkMode === 'mock') {
    const breakdown = await wallet.getBalanceBreakdown();
    console.log(` [MOCK] Base USDC    : $${breakdown.baseUsdc.toFixed(2)}`);
    console.log(` [MOCK] Polygon USDC : $${breakdown.polygonUsdc.toFixed(2)}`);
    console.log(` [MOCK] Saldo Total  : $${breakdown.totalUsd.toFixed(2)} USD`);
    console.log('======================================================================');
    return;
  }

  try {
    const [baseEth, baseUsdc, polyPol, polyUsdc] = await Promise.all([
      getNativeBalance(config.network.baseRpcUrl, address),
      getErc20Balance(config.network.baseRpcUrl, config.network.baseUsdcAddress, address),
      getNativeBalance(config.network.polygonRpcUrl, address),
      getErc20Balance(config.network.polygonRpcUrl, config.network.polygonUsdcAddress, address),
    ]);

    const totalUsdc = baseUsdc + polyUsdc;

    console.log(` Base (${config.network.baseChainId}):`);
    console.log(`   - Gas (ETH)       : ${baseEth.toFixed(6)} ETH`);
    console.log(`   - Saldo USDC      : $${baseUsdc.toFixed(2)} USDC`);
    console.log('');
    console.log(` Polygon (${config.network.polygonChainId}):`);
    console.log(`   - Gas (POL)       : ${polyPol.toFixed(6)} POL`);
    console.log(`   - Saldo USDC      : $${polyUsdc.toFixed(2)} USDC`);
    console.log('----------------------------------------------------------------------');
    console.log(` SALDO TOTAL DO AGENTE: $${totalUsdc.toFixed(2)} USDC`);
    if (totalUsdc === 0) {
      console.log(' ⚠️  ATENÇÃO: Saldo total é $0.00 USDC!');
      console.log('    Abasteça o endereço acima no Faucet da Circle antes de rodar');
      console.log('    "npm start" em modo testnet, senão o protocolo Permadeath será');
      console.log('    acionado imediatamente por insolvência (Saldo == $0.00).');
    }
    console.log('======================================================================');
  } catch (err) {
    console.error(` Erro ao consultar RPCs: ${err.message}`);
    process.exit(1);
  }
}

main();
