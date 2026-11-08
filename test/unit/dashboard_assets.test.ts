/**
 * ==============================================================================
 * Unit Test Suite: Mission Control — static assets
 * ==============================================================================
 * Proof for C33 plus the asset inventory the SPA depends on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.join(process.cwd(), 'src', 'modules', 'dashboard', 'public');

describe('Mission Control assets', () => {
  it('C33 provider badge: the models screen states that no inference provider is configured', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    assert.match(html, /sem provedor de inferência configurado/);
  });

  it('ships every asset the SPA imports, with no external origin', () => {
    for (const name of ['index.html', 'app.js', 'ui_core.js', 'styles.css']) {
      const filePath = path.join(PUBLIC_DIR, name);
      assert.equal(fs.existsSync(filePath), true, `${name} is missing`);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.equal(/https?:\/\//.test(content), false, `${name} references an external origin`);
    }
  });
});
