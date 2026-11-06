#!/usr/bin/env node
/**
 * ==============================================================================
 * APEX AEA (Autonomous Economic Agent) — Offline Build Script
 * ==============================================================================
 * Validates TypeScript syntax across the codebase without third-party dependencies
 * using Node.js 24's native type stripping engine and syntax checker.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function findTsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        files.push(...findTsFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function validateFile(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      '--no-warnings=ExperimentalWarning',
      '--check',
      filePath,
    ], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({
        file: filePath,
        relPath: path.relative(rootDir, filePath),
        success: false,
        output: err.message,
      });
    });

    child.on('close', (code) => {
      resolve({
        file: filePath,
        relPath: path.relative(rootDir, filePath),
        success: code === 0,
        output: (stderr + stdout).trim(),
      });
    });
  });
}

async function main() {
  const startTime = Date.now();
  console.log(`[APEX BUILD] Starting TypeScript syntax validation with Node.js ${process.version}...`);

  const srcDir = path.join(rootDir, 'src');
  const testDir = path.join(rootDir, 'test');

  const files = [
    ...findTsFiles(srcDir),
    ...findTsFiles(testDir),
  ];

  if (files.length === 0) {
    console.error('[APEX BUILD ERROR] No TypeScript source files found to validate.');
    process.exit(1);
  }

  console.log(`[APEX BUILD] Discovered ${files.length} TypeScript files across src/ and test/`);

  // Concurrently validate all files
  const results = await Promise.all(files.map(validateFile));

  let failureCount = 0;
  for (const res of results) {
    if (res.success) {
      console.log(`  ✓ ${res.relPath}`);
    } else {
      failureCount++;
      console.error(`  ✗ [SYNTAX ERROR] ${res.relPath}`);
      if (res.output) {
        console.error(`    ${res.output.replace(/\n/g, '\n    ')}`);
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (failureCount > 0) {
    console.error(`\n[APEX BUILD FAILED] ${failureCount} of ${files.length} files failed validation (${durationMs}ms).`);
    process.exit(1);
  }

  console.log(`\n[APEX BUILD SUCCESS] All ${files.length} TypeScript files passed syntax validation (${durationMs}ms).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[APEX BUILD FATAL ERROR]:', err);
  process.exit(1);
});
