import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { SidecarEvent } from './types';

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private rl: Interface | null = null;
  private retryCount = 0;
  private maxRetries = 5;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  getSidecarPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'observer-sidecar');
    }
    // Dev: look in sidecar-bin/ relative to project root
    return path.join(__dirname, '..', '..', 'sidecar-bin', 'observer-sidecar');
  }

  start(): void {
    this.stopped = false;
    const binaryPath = this.getSidecarPath();
    console.log(`[SidecarManager] Starting: ${binaryPath}`);

    // Verify binary exists
    if (!fs.existsSync(binaryPath)) {
      console.error(`[SidecarManager] Binary not found: ${binaryPath}`);
      console.error('[SidecarManager] Build it with: cd sidecar-swift && swift build && cp .build/debug/caret-sidecar ../sidecar-bin/observer-sidecar');
      return;
    }

    // Strip Electron-specific env vars that interfere with native binaries
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    try {
      this.process = spawn(binaryPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
    } catch (err) {
      console.error('[SidecarManager] Failed to spawn:', err);
      this.scheduleRestart();
      return;
    }

    // Parse JSON Lines from stdout
    this.rl = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line: string) => {
      try {
        const event: SidecarEvent = JSON.parse(line);
        this.emit('event', event);
      } catch {
        // Non-JSON output from sidecar (e.g. Swift print statements)
        console.log('[SidecarManager]', line);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[SidecarManager stderr]', data.toString().trim());
    });

    this.process.on('error', (err) => {
      console.error('[SidecarManager] Process error:', err);
      this.cleanup();
      this.scheduleRestart();
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[SidecarManager] Exited: code=${code} signal=${signal}`);
      this.cleanup();
      if (!this.stopped && signal !== 'SIGTERM') {
        this.scheduleRestart();
      }
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      // Force kill after 3 seconds
      const pid = this.process.pid;
      setTimeout(() => {
        if (this.process && this.process.pid === pid) {
          this.process.kill('SIGKILL');
        }
      }, 3000);
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.process = null;
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    if (this.retryCount >= this.maxRetries) {
      console.error(`[SidecarManager] Max retries (${this.maxRetries}) exceeded, giving up`);
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    this.retryCount++;
    console.log(`[SidecarManager] Restarting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delay);
  }
}
