import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentControl } from '../../src/modules/dashboard/agent_control.ts';

class FakeChild extends EventEmitter {
  unrefCalled = false;
  pid: number;
  constructor(pid: number) { super(); this.pid = pid; }
  unref(): void { this.unrefCalled = true; }
  ready(): void { this.emit('message', 'agent-ready'); }
}

function fixture(options: { live?: Set<number>; autoReady?: boolean; failSpawn?: boolean } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-agent-control-'));
  const live = options.live ?? new Set<number>();
  let spawnCount = 0;
  let child: FakeChild | undefined;
  const control = new AgentControl({
    rootDir,
    waitIntervalMs: 2,
    startTimeoutMs: 1000,
    isAlive: (pid) => live.has(pid),
    spawnAgent: () => {
      spawnCount++;
      if (options.failSpawn) throw new Error('spawn denied');
      child = new FakeChild(32145 + spawnCount);
      live.add(child.pid);
      if (options.autoReady !== false) setImmediate(() => child?.ready());
      return child;
    },
  });
  return { rootDir, control, live, get child() { return child; }, get spawnCount() { return spawnCount; } };
}

describe('Agent process control', () => {
  it('start spawns detached agent and reserves pid returning running', async () => {
    const f = fixture();
    try {
      const result = await f.control.start();
      assert.deepEqual(result, { state: 'running', pid: 32146 });
      assert.equal(fs.readFileSync(path.join(f.rootDir, '.agent.pid'), 'utf8').trim(), '32146');
      assert.equal(f.child?.unrefCalled, true);
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('control state stays starting until the child confirms', async () => {
    const f = fixture({ autoReady: false });
    try {
      const pending = f.control.start();
      assert.equal(f.control.snapshot().state, 'starting');
      f.child?.ready();
      assert.equal((await pending).state, 'running');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('start with live pid returns 409 AlreadyRunning', async () => {
    const live = new Set([1234]);
    const f = fixture({ live });
    try {
      fs.writeFileSync(path.join(f.rootDir, '.agent.pid'), '1234\n');
      assert.deepEqual(await f.control.start(), { state: 'running', pid: 1234, error: 'AlreadyRunning' });
      assert.equal(f.spawnCount, 0);
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('start with tombstone returns 409 Permadeath', async () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.rootDir, 'tombstone.json'), '{}');
      assert.deepEqual(await f.control.start(), { state: 'stopped', pid: null, error: 'Permadeath' });
      assert.equal(f.spawnCount, 0);
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('two concurrent starts create exactly one process', async () => {
    const f = fixture({ autoReady: false });
    try {
      const first = f.control.start();
      const second = await f.control.start();
      assert.equal(second.error, 'AlreadyRunning');
      assert.equal(f.spawnCount, 1);
      f.child?.ready();
      assert.equal((await first).state, 'running');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('stop while running records stopping immediately and returns stopped after exit', async () => {
    const f = fixture();
    try {
      await f.control.start();
      const stopping = f.control.stop();
      assert.equal(f.control.snapshot().state, 'stopping');
      assert.equal(fs.existsSync(path.join(f.rootDir, '.agent.stop')), true);
      f.live.delete(32146);
      assert.deepEqual(await stopping, { state: 'stopped', pid: null });
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('stop never kills an unresponsive agent', async () => {
    const f = fixture();
    try {
      await f.control.start();
      let settled = false;
      const stopping = f.control.stop().then((result) => { settled = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 12));
      assert.equal(settled, false);
      assert.equal(f.control.snapshot().state, 'stopping');
      f.live.delete(32146);
      assert.equal((await stopping).state, 'stopped');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('stop when already stopped returns 200 stopped with no effect', async () => {
    const f = fixture();
    try {
      assert.deepEqual(await f.control.stop(), { state: 'stopped', pid: null });
      assert.equal(fs.existsSync(path.join(f.rootDir, '.agent.stop')), false);
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('stop during starting settles when the process settles', async () => {
    const f = fixture({ autoReady: false });
    try {
      const started = f.control.start();
      const stopped = f.control.stop();
      assert.equal(fs.existsSync(path.join(f.rootDir, '.agent.stop')), true);
      f.child?.ready();
      await started;
      f.live.clear();
      assert.equal((await stopped).state, 'stopped');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('control state returns to stopped when the child exits alone', async () => {
    const f = fixture();
    try {
      await f.control.start();
      f.live.clear();
      assert.deepEqual(f.control.snapshot(), { state: 'stopped', pid: null, error: undefined });
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('dashboard restart adopts a live pid as running', async () => {
    const live = new Set([4321]);
    const f = fixture({ live });
    try {
      fs.writeFileSync(path.join(f.rootDir, '.agent.pid'), '4321\n');
      const restarted = new AgentControl({ rootDir: f.rootDir, isAlive: (pid) => live.has(pid) });
      assert.deepEqual(restarted.snapshot(), { state: 'running', pid: 4321 });
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('failed spawn returns stopped with reason in the trail', async () => {
    const f = fixture({ failSpawn: true });
    const reasons: string[] = [];
    const control = new AgentControl({ rootDir: f.rootDir, spawnAgent: () => { throw new Error('spawn denied'); }, onStartFailure: (reason) => reasons.push(reason) });
    try {
      assert.deepEqual(await control.start(), { state: 'stopped', pid: null, error: 'spawn denied' });
      assert.deepEqual(reasons, ['spawn denied']);
      assert.equal(control.snapshot().state, 'stopped');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });

  it('unreadable process file shows unknown then stopped', () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.rootDir, '.agent.pid'), 'not-a-pid');
      assert.equal(f.control.snapshot().state, 'unknown');
      assert.equal(f.control.snapshot().state, 'stopped');
    } finally { fs.rmSync(f.rootDir, { recursive: true, force: true }); }
  });
});
