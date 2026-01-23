export type TunnelType = 'auto' | 'cloudflare' | 'tailscale-serve' | 'tailscale-funnel' | 'none';

export interface Config {
  port: number;
  tunnelType: TunnelType;
  devMode: boolean;
}

const VALID_TUNNEL_TYPES: TunnelType[] = ['auto', 'cloudflare', 'tailscale-serve', 'tailscale-funnel', 'none'];

export function parseConfig(): Config {
  const args = process.argv.slice(2);

  // Parse --tunnel=<type> or --tunnel <type>
  let tunnelType: TunnelType = 'auto';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--tunnel=')) {
      const value = arg.slice('--tunnel='.length) as TunnelType;
      if (VALID_TUNNEL_TYPES.includes(value)) {
        tunnelType = value;
      } else {
        console.error(`Invalid tunnel type: ${value}`);
        console.error(`Valid types: ${VALID_TUNNEL_TYPES.join(', ')}`);
        process.exit(1);
      }
    } else if (arg === '--tunnel' && args[i + 1]) {
      const value = args[i + 1] as TunnelType;
      if (VALID_TUNNEL_TYPES.includes(value)) {
        tunnelType = value;
        i++; // Skip next arg
      } else {
        console.error(`Invalid tunnel type: ${value}`);
        console.error(`Valid types: ${VALID_TUNNEL_TYPES.join(', ')}`);
        process.exit(1);
      }
    }
  }

  // Fallback to TUNNEL_TYPE env var
  if (tunnelType === 'auto' && process.env.TUNNEL_TYPE) {
    const envValue = process.env.TUNNEL_TYPE as TunnelType;
    if (VALID_TUNNEL_TYPES.includes(envValue)) {
      tunnelType = envValue;
    }
  }

  return {
    port: parseInt(process.env.PORT || '3456', 10),
    tunnelType,
    devMode: process.env.DEV_MODE === 'true',
  };
}
