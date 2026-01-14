#!/usr/bin/env node

import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode-terminal';
import { SessionManager } from './session-manager.js';
import { getAuthToken, validateToken, authMiddleware } from './auth.js';
import { PortDetector } from './port-detector.js';
import { createPortProxy } from './port-proxy.js';
import { startTunnel } from './tunnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3456', 10);
const sessionManager = new SessionManager();
const portDetector = new PortDetector();

const app = express();
app.use(express.json());
app.use(cookieParser());

// Serve static files (web frontend)
app.use(express.static(path.join(__dirname, '../web')));

// API routes (protected)
app.get('/api/sessions', authMiddleware, (_req, res) => {
  res.json(sessionManager.listSessions());
});

app.get('/api/ports', authMiddleware, async (_req, res) => {
  const ports = await portDetector.detectPorts();
  res.json(ports);
});

// Directory listing for autocomplete
app.get('/api/dirs', authMiddleware, (req, res) => {
  try {
    let inputPath = (req.query.path as string) || '';

    // Expand ~ to home directory
    if (inputPath.startsWith('~/')) {
      inputPath = inputPath.replace('~/', `${os.homedir()}/`);
    } else if (inputPath === '~') {
      inputPath = os.homedir();
    }

    // Determine base directory and prefix to search
    let dirToRead: string;
    let prefix: string;

    if (inputPath.endsWith('/')) {
      // User typed a complete directory path, list its contents
      dirToRead = inputPath;
      prefix = '';
    } else {
      // User is typing a name, list parent and filter
      dirToRead = path.dirname(inputPath) || '/';
      prefix = path.basename(inputPath).toLowerCase();
    }

    // Ensure path is absolute
    if (!path.isAbsolute(dirToRead)) {
      dirToRead = path.resolve(process.cwd(), dirToRead);
    }

    // Read directory
    const entries = fs.readdirSync(dirToRead, { withFileTypes: true });

    // Filter to directories only, apply prefix filter, limit results
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .filter(e => !prefix || e.name.toLowerCase().startsWith(prefix))
      .slice(0, 20)
      .map(e => {
        const fullPath = path.join(dirToRead, e.name);
        // Convert back to ~ notation for display
        const displayPath = fullPath.startsWith(os.homedir())
          ? fullPath.replace(os.homedir(), '~')
          : fullPath;
        return { name: e.name, path: displayPath + '/' };
      });

    res.json(dirs);
  } catch {
    res.json([]);
  }
});

// Port proxy routes (handles its own auth with cookie support)
app.use('/preview', createPortProxy());

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

interface ClientState {
  authenticated: boolean;
  sessionId: string | null;
  outputHandler: ((data: { raw: string }) => void) | null;
  exitHandler: ((code: number) => void) | null;
}

wss.on('connection', (ws: WebSocket) => {
  const state: ClientState = {
    authenticated: false,
    sessionId: null,
    outputHandler: null,
    exitHandler: null,
  };

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Binary messages = control (JSON)
    // Text messages = terminal input (raw)
    if (isBinary) {
      try {
        const str = Buffer.isBuffer(data) ? data.toString() : Buffer.from(data as ArrayBuffer).toString();
        const message = JSON.parse(str);
        handleControlMessage(ws, state, message);
      } catch {
        sendControl(ws, { type: 'error', error: 'Invalid control message' });
      }
    } else {
      // Raw terminal input - forward to PTY
      if (state.authenticated && state.sessionId) {
        const session = sessionManager.getSession(state.sessionId);
        if (session) {
          const str = Buffer.isBuffer(data) ? data.toString() : data.toString();
          session.write(str);
        }
      }
    }
  });

  ws.on('close', () => {
    // Clean up event handlers
    if (state.sessionId && state.outputHandler) {
      const session = sessionManager.getSession(state.sessionId);
      if (session) {
        session.off('output', state.outputHandler);
        if (state.exitHandler) {
          session.off('exit', state.exitHandler);
        }
      }
    }
  });
});

// Send control message (binary)
function sendControl(ws: WebSocket, message: object) {
  ws.send(Buffer.from(JSON.stringify(message)));
}

interface ControlMessage {
  type: string;
  token?: string;
  cwd?: string;
  sessionId?: string;
  cols?: number;
  rows?: number;
}

function handleControlMessage(ws: WebSocket, state: ClientState, message: ControlMessage) {
  // Auth required for all commands except 'auth'
  if (message.type !== 'auth' && !state.authenticated) {
    sendControl(ws, { type: 'error', error: 'Not authenticated' });
    return;
  }

  switch (message.type) {
    case 'auth': {
      if (message.token && validateToken(message.token)) {
        state.authenticated = true;
        sendControl(ws, { type: 'auth:success' });
      } else {
        sendControl(ws, { type: 'auth:failed', error: 'Invalid token' });
      }
      break;
    }

    case 'session:create': {
      // Clean up previous session handlers if any
      cleanupSessionHandlers(state);

      let cwd = message.cwd || process.cwd();
      // Expand ~ to home directory (shell doesn't do this for cwd)
      if (cwd.startsWith('~/')) {
        cwd = cwd.replace('~/', `${process.env.HOME || ''}/`);
      } else if (cwd === '~') {
        cwd = process.env.HOME || process.cwd();
      }
      const session = sessionManager.createSession(cwd);
      state.sessionId = session.id;

      // Subscribe to session output - send as raw text
      state.outputHandler = ({ raw }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(raw); // Send as text (not binary)
        }
      };
      session.on('output', state.outputHandler);

      state.exitHandler = (code) => {
        sendControl(ws, { type: 'session:exit', sessionId: session.id, exitCode: code });
      };
      session.on('exit', state.exitHandler);

      sendControl(ws, { type: 'session:created', session: session.getInfo() });
      break;
    }

    case 'session:list': {
      sendControl(ws, { type: 'session:list', sessions: sessionManager.listSessions() });
      break;
    }

    case 'session:attach': {
      const session = sessionManager.getSession(message.sessionId!);
      if (!session) {
        sendControl(ws, { type: 'error', error: 'Session not found' });
        return;
      }

      // Clean up previous session handlers if any
      cleanupSessionHandlers(state);

      state.sessionId = session.id;

      // Subscribe to session output - send as raw text
      state.outputHandler = ({ raw }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(raw); // Send as text (not binary)
        }
      };
      session.on('output', state.outputHandler);

      state.exitHandler = (code) => {
        sendControl(ws, { type: 'session:exit', sessionId: session.id, exitCode: code });
      };
      session.on('exit', state.exitHandler);

      // Send session info first
      sendControl(ws, { type: 'session:attached', session: session.getInfo() });

      // Then replay history as terminal output
      const history = session.getHistory();
      if (history && ws.readyState === WebSocket.OPEN) {
        ws.send(history); // Send as text (terminal output)
      }
      break;
    }

    case 'resize': {
      const session = sessionManager.getSession(state.sessionId!);
      if (session && message.cols && message.rows) {
        session.resize(message.cols, message.rows);
      }
      break;
    }

    case 'session:destroy': {
      if (message.sessionId) {
        sessionManager.destroySession(message.sessionId);
        sendControl(ws, { type: 'session:destroyed', sessionId: message.sessionId });
      }
      break;
    }

    default:
      sendControl(ws, { type: 'error', error: `Unknown message type: ${message.type}` });
  }
}

function cleanupSessionHandlers(state: ClientState) {
  if (state.sessionId) {
    const session = sessionManager.getSession(state.sessionId);
    if (session) {
      if (state.outputHandler) {
        session.off('output', state.outputHandler);
      }
      if (state.exitHandler) {
        session.off('exit', state.exitHandler);
      }
    }
  }
  state.outputHandler = null;
  state.exitHandler = null;
}

// Start server
server.listen(PORT, async () => {
  const token = getAuthToken();

  console.log('\n=================================');
  console.log('  Claude Code Remote');
  console.log('=================================\n');
  console.log(`Local: http://localhost:${PORT}?token=${token}`);

  // Start tunnel if available
  const tunnelUrl = await startTunnel(PORT);
  const connectUrl = tunnelUrl
    ? `${tunnelUrl}?token=${token}`
    : `http://localhost:${PORT}?token=${token}`;

  console.log(`\nScan to connect:\n`);
  qrcode.generate(connectUrl, { small: true });

  if (tunnelUrl) {
    console.log(`\nPublic: ${connectUrl}`);
  } else {
    console.log('\nNo tunnel. Use ngrok or cloudflared:');
    console.log(`  cloudflared tunnel --url http://localhost:${PORT}`);
  }

  console.log('\n=================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  sessionManager.destroyAll();
  server.close();
  process.exit(0);
});
