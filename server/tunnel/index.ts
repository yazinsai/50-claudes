import type { TunnelType } from '../config.js';
import type { TunnelResult, TunnelProvider } from './types.js';
import { CloudflareTunnelProvider } from './cloudflare.js';
import { TailscaleTunnelProvider } from './tailscale.js';

export type { TunnelResult, TunnelProvider };

function createProvider(type: Exclude<TunnelType, 'auto' | 'none'>): TunnelProvider {
  switch (type) {
    case 'cloudflare':
      return new CloudflareTunnelProvider();
    case 'tailscale-serve':
      return new TailscaleTunnelProvider('serve');
    case 'tailscale-funnel':
      return new TailscaleTunnelProvider('funnel');
  }
}

export async function startTunnel(port: number, type: TunnelType): Promise<TunnelResult> {
  // No tunnel requested
  if (type === 'none') {
    return {
      url: null,
      type: 'none',
      cleanup: () => {},
    };
  }

  // Specific tunnel type requested (no fallback)
  if (type !== 'auto') {
    const provider = createProvider(type);
    const available = await provider.isAvailable();

    if (!available) {
      console.error(`${provider.name} is not available`);
      return {
        url: null,
        type,
        cleanup: () => {},
      };
    }

    return provider.start(port);
  }

  // Auto mode: try cloudflare first, then tailscale-serve
  const providers: TunnelProvider[] = [
    new CloudflareTunnelProvider(),
    new TailscaleTunnelProvider('serve'),
  ];

  for (const provider of providers) {
    const available = await provider.isAvailable();
    if (!available) continue;

    const result = await provider.start(port);
    if (result.url) {
      return result;
    }
  }

  // No tunnel available
  return {
    url: null,
    type: 'none',
    cleanup: () => {},
  };
}
