#!/usr/bin/env node
/**
 * Zero-dependency cross-platform runner that sets INFERENCE_MODE and executes src/index.ts.
 * Usage: node scripts/start.js [free|paid]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modeArg = process.argv[2]?.trim().toLowerCase();
const mode = modeArg === 'paid' ? 'paid' : modeArg === 'free' ? 'free' : undefined;

const env = { ...process.env };
if (mode) {
  env.INFERENCE_MODE = mode;
}

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexScript = path.join(rootDir, 'src', 'index.ts');

const child = spawn(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', indexScript],
  {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
