import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InferenceMode } from '../../types.ts';

export type AgentControlState = 'stopped' | 'starting' | 'running' | 'stopping' | 'unknown';

export interface AgentControlSnapshot {
  state: AgentControlState;
  pid: number | null;
  error?: string;
}

export interface AgentStartOptions {
  /** Forces INFERENCE_MODE for the spawned agent; omitted means the .env value. */
  mode?: InferenceMode;
}

interface SpawnedAgent {
  pid?: number;
  once(event: string, listener: (...args: any[]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  unref(): void;
}

export interface AgentControlOptions {
  rootDir?: string;
  processFile?: string;
  tombstonePath?: string;
  spawnAgent?: (options: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedAgent;
  isAlive?: (pid: number) => boolean;
  waitIntervalMs?: number;
  startAgentCommand?: string;
  startTimeoutMs?: number;
  onStartFailure?: (reason: string) => void;
}

const READY_TIMEOUT_MS = 30_000;

export class AgentControl {
  private readonly rootDir: string;
  private readonly processFile: string;
  private readonly lockFile: string;
  private readonly stopFile: string;
  private readonly tombstonePath: string;
  private readonly spawnAgent: (options: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedAgent;
  private readonly isAlive: (pid: number) => boolean;
  private readonly waitIntervalMs: number;
  private readonly startAgentCommand?: string;
  private readonly startTimeoutMs: number;
  private readonly onStartFailure?: (reason: string) => void;
  private state: AgentControlState = 'stopped';
  private pid: number | null = null;
  private error?: string;
  private invalidPidObserved = false;
  private startPromise: Promise<AgentControlSnapshot> | null = null;

  private recordStartFailure(reason: string): void {
    try {
      fs.appendFileSync(path.join(this.rootDir, '.agent-control.log'), `${JSON.stringify({ event: 'AGENT_START_FAILED', reason, timestamp: Date.now() })}\n`);
    } catch {
      // The response still carries the failure reason if the local trail is unavailable.
    }
    this.onStartFailure?.(reason);
  }

  constructor(options: AgentControlOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.processFile = path.resolve(this.rootDir, options.processFile ?? '.agent.pid');
    this.lockFile = `${this.processFile}.lock`;
    this.stopFile = path.join(this.rootDir, '.agent.stop');
    this.tombstonePath = path.resolve(options.tombstonePath ?? path.join(this.rootDir, 'tombstone.json'));
    this.spawnAgent = options.spawnAgent ?? ((spawnOptions) => {
      const script = options.startAgentCommand ?? fileURLToPath(new URL('../../index.ts', import.meta.url));
      return nodeSpawn(process.execPath, [...process.execArgv, script], {
        ...spawnOptions,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }) as ChildProcess;
    });
    this.isAlive = options.isAlive ?? ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    });
    this.waitIntervalMs = options.waitIntervalMs ?? 50;
    this.startTimeoutMs = options.startTimeoutMs ?? READY_TIMEOUT_MS;
    this.onStartFailure = options.onStartFailure;
  }

  snapshot(): AgentControlSnapshot {
    if (this.state === 'starting' || this.state === 'stopping') {
      return { state: this.state, pid: this.pid, error: this.error };
    }
    if (!fs.existsSync(this.processFile)) {
      if (this.invalidPidObserved) {
        this.invalidPidObserved = false;
        this.state = 'stopped';
      }
      this.pid = null;
      return { state: this.state === 'unknown' ? 'stopped' : this.state, pid: null, error: this.error };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.processFile, 'utf8').trim();
    } catch {
      this.state = 'unknown';
      this.invalidPidObserved = true;
      return { state: 'unknown', pid: null, error: 'ProcessFileUnreadable' };
    }
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
      if (this.invalidPidObserved) {
        try { fs.unlinkSync(this.processFile); } catch { /* no longer present */ }
        this.invalidPidObserved = false;
        this.state = 'stopped';
        this.pid = null;
        return { state: 'stopped', pid: null };
      }
      this.state = 'unknown';
      this.invalidPidObserved = true;
      return { state: 'unknown', pid: null, error: 'InvalidProcessId' };
    }
    const pid = Number(raw);
    if (this.isAlive(pid)) {
      this.state = 'running';
      this.pid = pid;
      this.invalidPidObserved = false;
      return { state: 'running', pid };
    }
    try {
      fs.unlinkSync(this.processFile);
    } catch {
      // A concurrent controller may already have cleared the stale reservation.
    }
    this.state = 'stopped';
    this.pid = null;
    return { state: 'stopped', pid: null, error: this.error };
  }

  start(options: AgentStartOptions = {}): Promise<AgentControlSnapshot> {
    if (this.startPromise) {
      return Promise.resolve({ state: 'starting', pid: this.pid, error: 'AlreadyRunning' });
    }
    this.startPromise = this.startExclusive(options).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startExclusive(options: AgentStartOptions): Promise<AgentControlSnapshot> {
    if (fs.existsSync(this.tombstonePath)) return { state: 'stopped', pid: null, error: 'Permadeath' };
    const current = this.snapshot();
    if (current.state === 'running' || current.state === 'starting' || current.state === 'stopping') {
      return { state: current.state, pid: current.pid, error: 'AlreadyRunning' };
    }
    let lock: number;
    try {
      lock = fs.openSync(this.lockFile, 'wx');
    } catch {
      return { state: 'stopped', pid: null, error: 'AlreadyRunning' };
    }
    try {
      const afterLock = this.snapshot();
      if (afterLock.state === 'running') return { ...afterLock, error: 'AlreadyRunning' };
      if (fs.existsSync(this.tombstonePath)) return { state: 'stopped', pid: null, error: 'Permadeath' };
      this.state = 'starting';
      this.error = undefined;
      const child = this.spawnAgent({
        cwd: this.rootDir,
        env: {
          ...process.env,
          AGENT_CONTROL_FILE: this.processFile,
          AGENT_STOP_FILE: this.stopFile,
          ...(options.mode ? { INFERENCE_MODE: options.mode } : {}),
        },
      });
      if (!child.pid || !Number.isSafeInteger(child.pid) || child.pid < 1) {
        throw new Error('Spawn returned an invalid pid');
      }
      this.pid = child.pid;
      fs.writeFileSync(this.processFile, `${child.pid}\n`, { flag: 'wx' });
      child.unref();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let refusedReason: string | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error('Agent startup confirmation timed out')), this.startTimeoutMs);
        child.on('message', (message: unknown) => {
          if (message === 'agent-ready') {
            finish();
            return;
          }
          const record = message as { type?: unknown; reason?: unknown } | null;
          if (record && typeof record === 'object' && record.type === 'agent-start-failed') {
            refusedReason = typeof record.reason === 'string' && record.reason ? record.reason : 'Agent refused to start';
          }
        });
        child.once('error', (error: Error) => finish(error));
        child.once('exit', (code: number | null) =>
          finish(new Error(refusedReason ?? `Agent exited before confirmation (${code ?? 'signal'})`))
        );
      });
      this.state = fs.existsSync(this.stopFile) ? 'stopping' : 'running';
      return { state: this.state, pid: this.pid };
    } catch (error) {
      const reason = (error as Error).message;
      this.error = reason;
      this.state = 'stopped';
      this.pid = null;
      try { fs.unlinkSync(this.processFile); } catch { /* no reservation to clear */ }
      this.recordStartFailure(reason);
      return { state: 'stopped', pid: null, error: reason };
    } finally {
      fs.closeSync(lock);
      try { fs.unlinkSync(this.lockFile); } catch { /* another request may own a replacement lock */ }
    }
  }

  async stop(): Promise<AgentControlSnapshot> {
    const current = this.snapshot();
    if (current.state === 'stopped') return { state: 'stopped', pid: null };
    if (current.state === 'unknown') return current;
    this.state = 'stopping';
    this.pid = current.pid;
    fs.writeFileSync(this.stopFile, `${Date.now()}\n`);
    if (this.startPromise) await this.startPromise;
    while (this.pid !== null && this.isAlive(this.pid)) {
      await new Promise((resolve) => setTimeout(resolve, this.waitIntervalMs));
    }
    try { fs.unlinkSync(this.processFile); } catch { /* child may have removed it */ }
    try { fs.unlinkSync(this.stopFile); } catch { /* consumed or already removed */ }
    this.state = 'stopped';
    this.pid = null;
    return { state: 'stopped', pid: null };
  }
}
