# Claude Code Remote

Access Claude Code from your phone. Go for a walk, sit on the couch, or work from bed - your AI pair programmer comes with you.

```bash
npm start
```

That's it. Scan the QR code with your phone, and you're in.

---

## What You Get

**Full Terminal Access** - Not a chat wrapper. A real terminal. Everything Claude Code can do on your desktop, now in your pocket.

**Session Persistence** - Start a session, put your phone down, come back later. Your work is still there.

**Dev Server Preview** - Building a UI? Preview your local dev server right in the app. No tunnels to configure.

**Works Anywhere** - Uses Cloudflare Tunnel automatically. No port forwarding, no firewall headaches.

---

## Getting Started

```bash
git clone https://github.com/yazinsai/claude-code-remote.git
cd claude-code-remote
npm install
npm start
```

You'll see:

```
┌─────────────────────────────────────────┐
│  Claude Code Remote                     │
│  ─────────────────                      │
│  Local:  http://localhost:3456          │
│  Tunnel: https://abc123.trycloudflare.com│
│                                         │
│  Auth Token: xxxx-xxxx-xxxx             │
│                                         │
│  [QR CODE]                              │
│                                         │
│  Scan to connect from your phone        │
└─────────────────────────────────────────┘
```

Scan the QR code. Enter the token. Done.

---

## Requirements

- Node.js 18+
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) (optional, for remote access)

```bash
# macOS
brew install cloudflared
```

Without cloudflared, you can still use it locally or set up your own tunnel (ngrok, Tailscale, etc).

---

## License

MIT
