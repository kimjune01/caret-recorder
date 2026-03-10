import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const SIDECAR_PATH = path.join(__dirname, '..', '..', 'sidecar-bin', 'observer-sidecar');
const binaryExists = fs.existsSync(SIDECAR_PATH);

describe.skipIf(!binaryExists)('Sidecar binary — real process', () => {
  let proc: ChildProcess;
  let lines: string[] = [];

  beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    proc = spawn(SIDECAR_PATH, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    const rl = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    // Collect lines for up to 3 seconds
    await new Promise<void>((resolve) => {
      rl.on('line', (line: string) => {
        lines.push(line);
      });
      setTimeout(() => {
        rl.close();
        resolve();
      }, 3000);
    });
  });

  afterAll(async () => {
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        setTimeout(resolve, 2000);
      });
    }
  });

  it('emits SIDECAR_STARTED system event', () => {
    const parsed = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const startEvent = parsed.find(
      (e: { event: number; payload?: { internalId?: string } }) =>
        e.event === 7 && e.payload?.internalId === 'SIDECAR_STARTED',
    );
    expect(startEvent).toBeDefined();
  });

  it('every stdout line is valid JSON', () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('exits on SIGTERM without hanging', async () => {
    // Start a fresh instance for this test
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const p = spawn(SIDECAR_PATH, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    // Wait a moment for it to start
    await new Promise((r) => setTimeout(r, 500));

    const result = await new Promise<{ code: number | null; signal: string | null; timedOut: boolean }>((resolve) => {
      const timeout = setTimeout(() => resolve({ code: null, signal: null, timedOut: true }), 3000);
      p.on('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, timedOut: false });
      });
      p.kill('SIGTERM');
    });

    // Process should exit (not hang). Exit code 0 or SIGTERM signal are both acceptable.
    expect(result.timedOut).toBe(false);
    const exitedCleanly = result.code === 0 || result.signal === 'SIGTERM';
    expect(exitedCleanly).toBe(true);
  });
});
