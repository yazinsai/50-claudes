import { spawn, execSync } from 'child_process';
import type { TunnelProvider, TunnelResult } from './types.js';
import type { TunnelType } from '../config.js';

interface TailscaleStatus {
  BackendState: string;
  Self?: {
    DNSName: string;
  };
}

export class TailscaleTunnelProvider implements TunnelProvider {
  name: string;
  private mode: 'serve' | 'funnel';
  private started = false;

  constructor(mode: 'serve' | 'funnel') {
    this.mode = mode;
    this.name = `tailscale-${mode}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check tailscale binary exists
      const versionProc = spawn('tailscale', ['--version'], { stdio: 'ignore' });
      const versionOk = await new Promise<boolean>((resolve) => {
        versionProc.on('error', () => resolve(false));
        versionProc.on('exit', (code) => resolve(code === 0));
      });

      if (!versionOk) return false;

      // Check tailscale is running
      const status = this.getStatus();
      return status?.BackendState === 'Running';
    } catch {
      return false;
    }
  }

  async start(port: number): Promise<TunnelResult> {
    try {
      const status = this.getStatus();
      if (!status?.Self?.DNSName) {
        return this.createResult(null);
      }

      // Get the hostname (remove trailing dot)
      const hostname = status.Self.DNSName.replace(/\.$/, '');
      const url = `https://${hostname}`;

      // Start tailscale serve/funnel in background
      // Using --bg flag for background mode
      const args = [this.mode, '--bg', `http://localhost:${port}`];

      return new Promise((resolve) => {
        const proc = spawn('tailscale', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('error', () => {
          resolve(this.createResult(null));
        });

        proc.on('exit', (code) => {
          if (code === 0) {
            this.started = true;
            resolve(this.createResult(url));
          } else {
            // Check if funnel is not enabled
            if (stderr.includes('Funnel not available')) {
              console.error('Tailscale Funnel is not enabled for this device.');
              console.error('Enable it at: https://login.tailscale.com/admin/machines');
            }
            resolve(this.createResult(null));
          }
        });
      });
    } catch {
      return this.createResult(null);
    }
  }

  private getStatus(): TailscaleStatus | null {
    try {
      const output = execSync('tailscale status --json', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return JSON.parse(output);
    } catch {
      return null;
    }
  }

  private createResult(url: string | null): TunnelResult {
    const type: TunnelType = this.mode === 'serve' ? 'tailscale-serve' : 'tailscale-funnel';
    return {
      url,
      type,
      isPrivate: this.mode === 'serve', // serve is tailnet-only
      cleanup: () => this.cleanup(),
    };
  }

  private cleanup() {
    if (this.started) {
      try {
        // Reset the serve/funnel configuration
        execSync(`tailscale ${this.mode} reset`, {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {
        // Ignore cleanup errors
      }
      this.started = false;
    }
  }
}
