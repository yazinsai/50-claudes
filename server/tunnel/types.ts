import type { TunnelType } from '../config.js';

export interface TunnelResult {
  url: string | null;
  type: TunnelType;
  cleanup: () => void;
  isPrivate?: boolean; // true for tailscale-serve (tailnet-only)
}

export interface TunnelProvider {
  name: string;
  start(port: number): Promise<TunnelResult>;
  isAvailable(): Promise<boolean>;
}
