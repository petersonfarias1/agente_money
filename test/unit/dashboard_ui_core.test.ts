/**
 * ==============================================================================
 * Unit Test Suite: Mission Control — pure UI helpers
 * ==============================================================================
 * Proofs for C1, C2, C9, C14, C20, C21 and C24.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detailView,
  controlViewModel,
  downsample,
  formatUsd,
  listState,
  overviewModel,
  parseSseFrame,
  reconnectDelay,
} from '../../src/modules/dashboard/public/ui_core.js';

describe('Mission Control UI core', () => {
  it('initial snapshot shows stopped with start enabled', () => {
    assert.deepEqual(controlViewModel(), {
      state: 'stopped', startEnabled: true, stopEnabled: false, label: 'stopped',
    });
  });

  it('screen renders starting while the child has not confirmed', () => {
    assert.deepEqual(controlViewModel({ state: 'starting', pid: 123 }), {
      state: 'starting', startEnabled: false, stopEnabled: true, label: 'starting',
    });
  });

  it('C1 overviewModel: projects tier, formatted balance, cycles and liveness', () => {
    const snapshot = {
      tier: { tier: 'VERDE', modelClass: 'advanced' },
      balance: { totalUsd: 123.45 },
      kpi: { cycles: 7, actions: 42 },
      liveness: { state: 'ALIVE', ageMs: 3000 },
    };

    const view = overviewModel(snapshot);

    assert.equal(view.tier, 'VERDE');
    assert.equal(view.modelClass, 'advanced');
    assert.equal(view.balanceUsd, 123.45);
    assert.equal(view.balanceText, 'US$ 123,45');
    assert.equal(view.cycles, 7);
    assert.equal(view.liveness, 'ALIVE');
    assert.equal(view.livenessLabel, 'vivo');
  });

  it('C2 formatUsd: pt-BR grouping and cents', () => {
    assert.equal(formatUsd(1234.5), 'US$ 1.234,50');
    assert.equal(formatUsd(0), 'US$ 0,00');
    assert.equal(formatUsd(1234567.891), 'US$ 1.234.567,89');
  });

  it('C9 reconnectDelay: 2000, 4000, 8000, 16000, 30000 and capped at 30000', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelay(attempt));
    assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('C14 parseSseFrame: event, id and parsed JSON data', () => {
    const frame = 'id: 42\nevent: snapshot\ndata: {"seq":42,"tier":{"tier":"VERDE"}}';
    const parsed = parseSseFrame(frame);

    assert.equal(parsed.event, 'snapshot');
    assert.equal(parsed.id, '42');
    assert.equal(parsed.data.seq, 42);
    assert.equal(parsed.data.tier.tier, 'VERDE');
  });

  it('C20 detailView: valid JSON is parsed, plain text falls back to raw', () => {
    assert.deepEqual(detailView('{"a":1}'), { a: 1 });
    assert.deepEqual(detailView('texto'), { raw: 'texto' });
  });

  it('C21 listState loading: five skeleton rows and load-more disabled', () => {
    const state = listState({ status: 'loading' });
    assert.equal(state.skeletonRows, 5);
    assert.equal(state.loadMoreDisabled, true);
  });

  it('C24 downsample: at most 240 points keeping the last value of each bucket', () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({ t: index, usd: index }));
    const capped = downsample(points, 240);

    assert.ok(capped.length <= 240);
    assert.equal(capped[capped.length - 1].usd, 999);
    assert.equal(capped[0].usd, points[Math.floor(1000 / 240) - 1].usd);
  });
});
