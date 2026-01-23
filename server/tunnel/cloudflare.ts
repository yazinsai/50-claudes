import { spawn, ChildProcess } from 'child_process';
import type { TunnelProvider, TunnelResult } from './types.js';

export class CloudflareTunnelProvider implements TunnelProvider {
  name = 'cloudflare';
  private process: ChildProcess | null = null;

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('cloudflared', ['--version'], { stdio: 'ignore' });
      proc.on('error', () => resolve(false));
      proc.on('exit', (code) => resolve(code === 0));
    });
  }

  async start(port: number): Promise<TunnelResult> {
    return new Promise((resolve) => {
      try {
        const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.process = proc;

        let output = '';
        const timeout = setTimeout(() => {
          resolve(this.createResult(null));
        }, 10000);

        proc.stderr.on('data', (data: Buffer) => {
          output += data.toString();

          // cloudflared outputs the URL to stderr
          const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (urlMatch) {
            clearTimeout(timeout);
            resolve(this.createResult(urlMatch[0]));
          }
        });

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(this.createResult(null));
        });

        proc.on('exit', () => {
          clearTimeout(timeout);
          this.process = null;
          resolve(this.createResult(null));
        });
      } catch {
        resolve(this.createResult(null));
      }
    });
  }

  private createResult(url: string | null): TunnelResult {
    return {
      url,
      type: 'cloudflare',
      isPrivate: false,
      cleanup: () => this.cleanup(),
    };
  }

  private cleanup() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
