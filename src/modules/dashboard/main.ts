/**
 * ==============================================================================
 * APEX AEA — Mission Control: entry point
 * ==============================================================================
 * `npm run dashboard` starts the observer only. It never creates a daemon and
 * never opens the database for writing.
 */

import { DashboardServer } from './server.ts';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const host = process.env.DASHBOARD_HOST || '127.0.0.1';
const token = (process.env.DASHBOARD_TOKEN || '').trim();
const port = Number(process.env.DASHBOARD_PORT || 7070);

if (!LOCAL_HOSTS.has(host) && !token) {
  console.error('DASHBOARD_TOKEN obrigatório fora de localhost');
  process.exit(1);
}

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('DASHBOARD_PORT inválido');
  process.exit(1);
}

const server = new DashboardServer({
  host,
  port,
  token: token || undefined,
  dbPath: process.env.DATABASE_PATH || './data/agent.db',
  tombstonePath: process.env.TOMBSTONE_PATH || 'tombstone.json',
});

const url = await server.listen();
console.log(`Mission Control em ${url}`);
if (token) {
  console.log('Autenticação por token habilitada (Authorization: Bearer <token> ou ?token=<token>).');
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
