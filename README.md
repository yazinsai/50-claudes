# Claude Code Remote

Mobile-first remote access to Claude Code from your phone. Control your local Claude Code sessions, run commands, and preview local dev servers - all from anywhere.

## Features

- **Remote Chat**: Send messages to Claude Code from your phone
- **Multiple Sessions**: Run and switch between multiple Claude Code sessions
- **Port Preview**: View local dev servers (React, Vite, etc.) through the tunnel
- **Quick Actions**: Tap buttons when Claude asks questions (AskUserQuestion prompts)
- **Tool Output**: See file diffs, command results, and tool outputs
- **PWA Support**: Install as an app on your phone

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start the server
npm start
```

The server will display:
- Local URL: `http://localhost:3456`
- Auth token (save this!)
- Tunnel URL if cloudflared is installed

## Accessing Remotely

### Option 1: Cloudflared (Recommended)

Install cloudflared for automatic tunneling:

```bash
# macOS
brew install cloudflared

# Linux
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

# Then just run the server - it will auto-tunnel
npm start
```

### Option 2: Manual Tunnel

If cloudflared isn't available, use any tunnel service:

```bash
# ngrok
ngrok http 3456

# localtunnel
npx localtunnel --port 3456

# Tailscale (if you have it set up)
# Just access via your Tailscale IP
```

## Usage

1. Start the server: `npm start`
2. Copy the auth token shown in the terminal
3. Open the tunnel URL on your phone
4. Paste the auth token and connect
5. Create a new session or attach to an existing one
6. Start chatting with Claude Code!

### Port Preview

1. Start a local dev server (e.g., `npm run dev` in another terminal)
2. Click the "Preview" button in the app
3. Select the port from the dropdown
4. The dev server will load in an iframe

## Environment Variables

- `PORT` - Server port (default: 3456)
- `CLAUDE_REMOTE_TOKEN` - Custom auth token (default: randomly generated)

## Development

```bash
# Watch mode
npm run dev
```

## Architecture

```
┌──────────────────┐         ┌──────────────────────────────────────┐
│   Mobile PWA     │◄──────► │  Local Server                        │
│  (Your Phone)    │  WSS    │  (Your Computer)                     │
└──────────────────┘         │                                      │
                             │  ├── WebSocket API (chat)            │
                             │  ├── PTY Manager (Claude sessions)   │
                             │  ├── Port Proxy (dev server preview) │
                             │  └── Tunnel (cloudflared)            │
                             └──────────────────────────────────────┘
```

## License

MIT
