// Claude Code Remote - xterm.js Client

// Notification Manager for input-required alerts
class NotificationManager {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.registration = null;
    this.lastNotificationTime = new Map();
    this.debounceTimers = new Map();
    this.DEBOUNCE_MS = 500;
    this.COOLDOWN_MS = 5000;

    this.loadSettings();
    this.registerServiceWorker();
    this.listenForServiceWorkerMessages();
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service worker registered');
      } catch (error) {
        console.warn('Service worker registration failed:', error);
      }
    }
  }

  listenForServiceWorkerMessages() {
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data.type === 'switch-session') {
        this.app.attachSession(event.data.sessionId);
      }
    });
  }

  loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('ccr-settings') || '{}');
      this.enabled = settings.notificationsEnabled || false;
    } catch {
      this.enabled = false;
    }
  }

  saveSettings() {
    localStorage.setItem('ccr-settings', JSON.stringify({
      notificationsEnabled: this.enabled
    }));
  }

  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async enable() {
    const granted = await this.requestPermission();
    if (granted) {
      this.enabled = true;
      this.saveSettings();
    }
    return granted;
  }

  disable() {
    this.enabled = false;
    this.saveSettings();
  }

  isActiveSession(sessionId) {
    return this.app.currentSessionId === sessionId;
  }

  shouldNotify(sessionId) {
    if (!this.enabled) return false;
    if (Notification.permission !== 'granted') return false;

    const now = Date.now();
    const lastTime = this.lastNotificationTime.get(sessionId) || 0;

    // Cooldown check
    if (now - lastTime < this.COOLDOWN_MS) return false;

    // Active session + focused check
    if (this.isActiveSession(sessionId) && document.hasFocus()) return false;

    return true;
  }

  notify(sessionId, sessionName, preview) {
    // Cancel existing debounce timer
    clearTimeout(this.debounceTimers.get(sessionId));

    // Set new debounce timer
    this.debounceTimers.set(sessionId, setTimeout(() => {
      if (this.shouldNotify(sessionId)) {
        this.showNotification(sessionId, sessionName, preview);
        this.lastNotificationTime.set(sessionId, Date.now());
      }
    }, this.DEBOUNCE_MS));
  }

  showNotification(sessionId, sessionName, preview) {
    const title = `Input needed: ${sessionName}`;
    const body = preview.length > 100 ? preview.slice(0, 100) + '...' : preview;

    if (this.registration?.active) {
      this.registration.active.postMessage({
        type: 'show-notification',
        title,
        body,
        sessionId,
        tag: `input-${sessionId}`
      });
    }
  }
}

class ClaudeRemote {
  constructor() {
    this.ws = null;
    this.terminal = null;
    this.fitAddon = null;
    this.currentSessionId = null;
    this.sessions = [];

    // Check URL for token first, then localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    this.token = urlToken || localStorage.getItem('authToken') || '';

    // Clean token from URL for security
    if (urlToken) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    this.initElements();
    this.bindEvents();
    this.initTerminal();

    // Initialize notification manager
    this.notificationManager = new NotificationManager(this);
    this.updateNotifyToggleState();

    // Auto-connect if we have a token
    if (urlToken) {
      this.elements.tokenInput.value = this.token;
      setTimeout(() => this.connect(), 100);
    } else if (this.token) {
      this.elements.tokenInput.value = this.token;
    }
  }

  initElements() {
    this.elements = {
      // Screens
      authScreen: document.getElementById('auth-screen'),
      mainScreen: document.getElementById('main-screen'),
      previewScreen: document.getElementById('preview-screen'),

      // Auth
      tokenInput: document.getElementById('token-input'),
      connectBtn: document.getElementById('connect-btn'),
      authError: document.getElementById('auth-error'),

      // Main
      header: document.getElementById('header'),
      sessionSelect: document.getElementById('session-select'),
      sessionTabs: document.getElementById('session-tabs'),
      newSessionBtn: document.getElementById('new-session-btn'),
      previewBtn: document.getElementById('preview-btn'),
      attachBtn: document.getElementById('attach-btn'),
      imageInput: document.getElementById('image-input'),
      toggleHeaderBtn: document.getElementById('toggle-header-btn'),
      expandHeaderBtn: document.getElementById('expand-header-btn'),
      terminalContainer: document.getElementById('terminal-container'),

      // Preview
      backBtn: document.getElementById('back-btn'),
      portSelect: document.getElementById('port-select'),
      portInput: document.getElementById('port-input'),
      goPortBtn: document.getElementById('go-port-btn'),
      refreshPreviewBtn: document.getElementById('refresh-preview-btn'),
      previewFrame: document.getElementById('preview-frame'),

      // Modal
      newSessionModal: document.getElementById('new-session-modal'),
      cwdInput: document.getElementById('cwd-input'),
      cwdSuggestions: document.getElementById('cwd-suggestions'),
      cancelSessionBtn: document.getElementById('cancel-session-btn'),
      createSessionBtn: document.getElementById('create-session-btn'),

      // Reconnect
      reconnectBanner: document.getElementById('reconnect-banner'),
      reconnectBtn: document.getElementById('reconnect-btn'),

      // Mobile keys
      mobileKeys: document.getElementById('mobile-keys'),

      // Scroll to bottom
      scrollBottomBtn: document.getElementById('scroll-bottom-btn'),

      // Settings
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      closeSettingsBtn: document.getElementById('close-settings-btn'),
      notifyToggle: document.getElementById('notify-toggle'),
    };

    // Mobile keys state
    this.ctrlActive = false;
    this.shiftActive = false;
    this.lastViewportHeight = window.visualViewport?.height || window.innerHeight;

    // Autocomplete state
    this.selectedSuggestionIndex = -1;
    this.suggestions = [];
    this.debounceTimer = null;
  }

  initTerminal() {
    // Create terminal with mobile-friendly settings
    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      letterSpacing: 0,
      lineHeight: 1.2,
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor: '#f0a500',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(240, 165, 0, 0.25)',
        selectionForeground: '#f0f6fc',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      scrollback: 5000,
      allowTransparency: true,
      convertEol: true,
    });

    // Add fit addon for responsive sizing
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    this.terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    this.terminal.open(this.elements.terminalContainer);

    // Handle terminal input -> send to server
    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
        // Apply modifiers if active
        if (data.length === 1) {
          const char = data.charCodeAt(0);

          // Apply Shift modifier (convert lowercase to uppercase)
          if (this.shiftActive && char >= 97 && char <= 122) {
            data = String.fromCharCode(char - 32);
            this.setShiftActive(false);
          }

          // Apply Ctrl modifier (Ctrl+A = 0x01, Ctrl+Z = 0x1A)
          if (this.ctrlActive) {
            if (char >= 65 && char <= 90) { // A-Z
              data = String.fromCharCode(char - 64);
            } else if (char >= 97 && char <= 122) { // a-z
              data = String.fromCharCode(char - 96);
            }
            this.setCtrlActive(false);
          }

          // Auto-dismiss keyboard on Enter (mobile only)
          if ((char === 13 || char === 10) && this.elements.mobileKeys.classList.contains('visible')) {
            this.terminal.blur();
          }
        }
        this.ws.send(data); // Send as text
      }
    });

    // Handle resize -> notify server
    this.terminal.onResize(({ cols, rows }) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
        this.sendControl({ type: 'resize', cols, rows });
      }
    });

    // Fit terminal on window resize
    window.addEventListener('resize', () => this.fitTerminal());

    // Use ResizeObserver for container changes
    const resizeObserver = new ResizeObserver(() => this.fitTerminal());
    resizeObserver.observe(this.elements.terminalContainer);

    // Track scroll position for scroll-to-bottom button
    this.terminal.onScroll(() => this.updateScrollButton());
    // Also check when new content is written
    this.terminal.onWriteParsed(() => this.updateScrollButton());
  }

  fitTerminal() {
    if (this.fitAddon && this.elements.mainScreen.classList.contains('active')) {
      try {
        this.fitAddon.fit();
      } catch (e) {
        // Ignore fit errors during transitions
      }
    }
  }

  bindEvents() {
    // Auth
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.connect();
    });

    // Main
    this.elements.sessionSelect.addEventListener('change', (e) => {
      if (e.target.value) this.attachSession(e.target.value);
    });
    this.elements.newSessionBtn.addEventListener('click', () => this.showNewSessionModal());
    this.elements.previewBtn.addEventListener('click', () => this.showPreview());
    this.elements.attachBtn.addEventListener('click', () => this.elements.imageInput.click());
    this.elements.imageInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        this.handleImageAttachment(e.target.files[0]);
        e.target.value = ''; // Reset for same file selection
      }
    });
    this.elements.toggleHeaderBtn.addEventListener('click', () => this.toggleHeader(true));
    this.elements.expandHeaderBtn.addEventListener('click', () => this.toggleHeader(false));

    // Preview
    this.elements.backBtn.addEventListener('click', () => this.hidePreview());
    this.elements.portSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        this.elements.portInput.value = e.target.value;
        this.loadPreview(e.target.value);
      }
    });
    this.elements.goPortBtn.addEventListener('click', () => this.loadCustomPort());
    this.elements.portInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadCustomPort();
    });
    this.elements.refreshPreviewBtn.addEventListener('click', () => {
      const port = this.elements.portInput.value || this.elements.portSelect.value;
      if (port) this.loadPreview(port);
    });

    // Modal
    this.elements.cancelSessionBtn.addEventListener('click', () => this.hideNewSessionModal());
    this.elements.createSessionBtn.addEventListener('click', () => this.createSession());

    // Autocomplete
    this.elements.cwdInput.addEventListener('input', () => this.onCwdInput());
    this.elements.cwdInput.addEventListener('keydown', (e) => this.onCwdKeydown(e));
    this.elements.cwdInput.addEventListener('blur', () => {
      // Delay to allow click on suggestion
      setTimeout(() => this.hideSuggestions(), 150);
    });

    // Reconnect
    this.elements.reconnectBtn.addEventListener('click', () => this.reconnect());

    // Scroll to bottom
    this.elements.scrollBottomBtn.addEventListener('click', () => this.scrollToBottom());

    // Mobile keys
    this.initMobileKeys();

    // Settings
    this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
    this.elements.closeSettingsBtn.addEventListener('click', () => this.hideSettings());
    this.elements.notifyToggle.addEventListener('click', () => this.toggleNotifications());
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    // Fit terminal when showing main screen
    if (screenId === 'main-screen') {
      setTimeout(() => this.fitTerminal(), 50);
    }
  }

  toggleHeader(collapse) {
    const isCollapsed = collapse !== undefined
      ? (collapse ? this.elements.header.classList.add('collapsed') || true : this.elements.header.classList.remove('collapsed') || false)
      : this.elements.header.classList.toggle('collapsed');

    const collapsed = this.elements.header.classList.contains('collapsed');
    this.elements.toggleHeaderBtn.setAttribute('aria-expanded', !collapsed);
    this.elements.expandHeaderBtn.classList.toggle('hidden', !collapsed);
    setTimeout(() => this.fitTerminal(), 300);
  }

  showSettings() {
    this.elements.settingsModal.classList.remove('hidden');
    this.updateNotifyToggleState();
  }

  hideSettings() {
    this.elements.settingsModal.classList.add('hidden');
  }

  updateNotifyToggleState() {
    const enabled = this.notificationManager?.enabled || false;
    this.elements.notifyToggle.setAttribute('aria-checked', enabled);
  }

  async toggleNotifications() {
    if (this.notificationManager.enabled) {
      this.notificationManager.disable();
    } else {
      const success = await this.notificationManager.enable();
      if (!success && Notification.permission === 'denied') {
        alert('Notifications are blocked. Please enable them in your browser settings.');
      }
    }
    this.updateNotifyToggleState();
  }

  connect() {
    const token = this.elements.tokenInput.value.trim();
    if (!token) {
      this.elements.authError.textContent = 'Please enter a token';
      return;
    }

    this.token = token;
    this.elements.authError.textContent = '';
    this.elements.connectBtn.disabled = true;
    this.elements.connectBtn.classList.add('loading');

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Send auth as binary (control message)
      this.sendControl({ type: 'auth', token });
    };

    this.ws.onmessage = (event) => {
      // Check if binary (control) or text (terminal output)
      if (event.data instanceof Blob) {
        // Binary = control message
        event.data.text().then(text => {
          const message = JSON.parse(text);
          this.handleControlMessage(message);
        });
      } else if (event.data instanceof ArrayBuffer) {
        // Binary = control message
        const text = new TextDecoder().decode(event.data);
        const message = JSON.parse(text);
        this.handleControlMessage(message);
      } else {
        // Text = terminal output -> write to xterm
        this.terminal.write(event.data);
      }
    };

    this.ws.onerror = () => {
      this.elements.authError.textContent = 'Connection failed';
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.classList.remove('loading');
    };

    this.ws.onclose = () => {
      if (this.elements.mainScreen.classList.contains('active')) {
        this.terminal.writeln('\r\n\x1b[33mDisconnected.\x1b[0m');
        this.elements.reconnectBanner.classList.remove('hidden');
      }
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.classList.remove('loading');
    };
  }

  reconnect() {
    this.elements.reconnectBanner.classList.add('hidden');
    this.terminal.writeln('\x1b[90mReconnecting...\x1b[0m');
    this.connect();
  }

  sendControl(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send as binary (ArrayBuffer)
      const data = new TextEncoder().encode(JSON.stringify(message));
      this.ws.send(data);
    }
  }

  handleControlMessage(message) {
    switch (message.type) {
      case 'auth:success':
        localStorage.setItem('authToken', this.token);
        this.elements.reconnectBanner.classList.add('hidden');
        this.showScreen('main-screen');
        this.sendControl({ type: 'session:list' });
        this.loadPorts();
        this.fitTerminal();
        // Re-attach to previous session if we have one
        if (this.currentSessionId) {
          this.sendControl({ type: 'session:attach', sessionId: this.currentSessionId });
        }
        break;

      case 'auth:failed':
        this.elements.authError.textContent = message.error || 'Authentication failed';
        this.elements.connectBtn.disabled = false;
        this.elements.connectBtn.classList.remove('loading');
        break;

      case 'session:list':
        this.updateSessionList(message.sessions);
        break;

      case 'session:created':
      case 'session:attached':
        this.currentSessionId = message.session.id;
        this.terminal.clear();
        this.terminal.writeln(`\x1b[32mConnected to session: ${message.session.id}\x1b[0m`);
        this.terminal.writeln(`\x1b[90mWorking directory: ${message.session.cwd}\x1b[0m\r\n`);
        this.sendControl({ type: 'session:list' });
        // Send initial size
        const { cols, rows } = this.terminal;
        this.sendControl({ type: 'resize', cols, rows });
        // Focus terminal
        this.terminal.focus();
        break;

      case 'session:exit':
        this.terminal.writeln(`\r\n\x1b[33mSession exited with code ${message.exitCode}\x1b[0m`);
        // Auto-remove the session after it exits
        if (message.sessionId) {
          this.removeSession(message.sessionId);
        }
        break;

      case 'session:destroyed':
        if (message.sessionId) {
          this.removeSession(message.sessionId);
        }
        break;

      case 'image:uploaded':
        // Insert file path into terminal (simulating paste)
        if (message.path) {
          this.terminal.paste(message.path);
        }
        break;

      case 'session:input_required':
        // Trigger notification when session needs input
        this.notificationManager.notify(
          message.sessionId,
          message.sessionName,
          message.preview
        );
        break;

      case 'error':
        this.terminal.writeln(`\r\n\x1b[31mError: ${message.error}\x1b[0m`);
        break;
    }
  }

  handleImageAttachment(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]; // Remove data URL prefix
      this.sendControl({
        type: 'image:upload',
        data: base64,
        filename: file.name,
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  }

  updateSessionList(sessions) {
    this.sessions = sessions;
    const select = this.elements.sessionSelect;
    const tabs = this.elements.sessionTabs;
    const currentValue = select.value;

    // Count folder name occurrences to detect duplicates
    const folderCounts = new Map();
    for (const session of sessions) {
      const dirName = session.cwd.split('/').pop() || session.cwd;
      folderCounts.set(dirName, (folderCounts.get(dirName) || 0) + 1);
    }

    // Helper to get display name - just folder, or "ID folder" if duplicate
    const getDisplayName = (session) => {
      const dirName = session.cwd.split('/').pop() || session.cwd;
      if (folderCounts.get(dirName) > 1) {
        return `${session.id.slice(0, 3)} ${dirName}`;
      }
      return dirName;
    };

    // Update dropdown (mobile)
    select.innerHTML = '<option value="">Select session...</option>';
    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = getDisplayName(session);
      select.appendChild(option);
    }

    // Update tabs (desktop)
    if (sessions.length === 0) {
      tabs.innerHTML = '<span class="session-tab-empty">No sessions</span>';
    } else {
      tabs.innerHTML = sessions.map(session => {
        const isActive = session.id === this.currentSessionId;
        return `<button class="session-tab" role="tab" aria-selected="${isActive}" data-session-id="${session.id}">
          <span class="session-tab-name">${getDisplayName(session)}</span>
          <span class="session-tab-close" data-close-session="${session.id}" title="Close session">&times;</span>
        </button>`;
      }).join('');

      // Add click handlers
      tabs.querySelectorAll('.session-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          // Don't switch session if clicking close button
          if (e.target.classList.contains('session-tab-close')) return;
          const sessionId = tab.dataset.sessionId;
          if (sessionId) this.attachSession(sessionId);
        });
      });

      // Add close button handlers
      tabs.querySelectorAll('.session-tab-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.closeSession;
          if (sessionId) this.closeSession(sessionId);
        });
      });
    }

    // Restore selection
    if (this.currentSessionId) {
      select.value = this.currentSessionId;
    } else if (currentValue) {
      select.value = currentValue;
    }
  }

  attachSession(sessionId) {
    this.terminal.clear();
    this.sendControl({ type: 'session:attach', sessionId });
    // Update tab selection immediately for responsive feel
    this.updateTabSelection(sessionId);
  }

  closeSession(sessionId) {
    this.sendControl({ type: 'session:destroy', sessionId });
  }

  removeSession(sessionId) {
    // Remove from local sessions list
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.updateSessionList(this.sessions);

    // If we were attached to this session, clear the terminal
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      this.terminal.clear();
      this.terminal.writeln('\x1b[33mSession closed.\x1b[0m');

      // Auto-attach to another session if available
      if (this.sessions.length > 0) {
        this.attachSession(this.sessions[0].id);
      }
    }
  }

  updateTabSelection(sessionId) {
    // Update dropdown
    this.elements.sessionSelect.value = sessionId || '';

    // Update tabs
    this.elements.sessionTabs.querySelectorAll('.session-tab').forEach(tab => {
      const isSelected = tab.dataset.sessionId === sessionId;
      tab.setAttribute('aria-selected', isSelected);
    });
  }

  showNewSessionModal() {
    this.elements.newSessionModal.classList.remove('hidden');
    this.elements.cwdInput.focus();
  }

  hideNewSessionModal() {
    this.elements.newSessionModal.classList.add('hidden');
    this.elements.cwdInput.value = '';
  }

  createSession() {
    const cwd = this.elements.cwdInput.value.trim() || undefined;
    this.terminal.clear();
    this.sendControl({ type: 'session:create', cwd });
    this.hideNewSessionModal();
  }

  async loadPorts() {
    try {
      const response = await fetch('/api/ports', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const ports = await response.json();

      const select = this.elements.portSelect;
      select.innerHTML = '<option value="">Select port...</option>';

      for (const port of ports) {
        const option = document.createElement('option');
        option.value = port.port;
        option.textContent = `${port.port} - ${port.process}`;
        select.appendChild(option);
      }
    } catch (err) {
      console.error('Failed to load ports:', err);
    }
  }

  showPreview() {
    this.showScreen('preview-screen');
    this.loadPorts();
  }

  hidePreview() {
    this.showScreen('main-screen');
    this.elements.previewFrame.src = 'about:blank';
  }

  loadPreview(port) {
    if (!port) return;
    this.elements.previewFrame.src = `/preview/${port}/?token=${encodeURIComponent(this.token)}`;
  }

  loadCustomPort() {
    const port = this.elements.portInput.value.trim();
    if (port && port > 0 && port <= 65535) {
      this.loadPreview(port);
    }
  }

  // Autocomplete methods
  onCwdInput() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fetchSuggestions(), 150);
  }

  async fetchSuggestions() {
    const value = this.elements.cwdInput.value;
    if (!value) {
      this.hideSuggestions();
      return;
    }

    try {
      const response = await fetch(`/api/dirs?path=${encodeURIComponent(value)}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.suggestions = await response.json();
      this.selectedSuggestionIndex = -1;
      this.renderSuggestions();
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
      this.hideSuggestions();
    }
  }

  renderSuggestions() {
    const ul = this.elements.cwdSuggestions;

    if (this.suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    ul.innerHTML = this.suggestions.map((s, i) => `
      <li role="option" data-index="${i}" class="${i === this.selectedSuggestionIndex ? 'selected' : ''}">
        <span class="dir-name">${s.name}/</span>
      </li>
    `).join('');

    // Add click handlers
    ul.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const index = parseInt(li.dataset.index, 10);
        this.selectSuggestion(index);
      });
    });

    ul.classList.remove('hidden');
  }

  hideSuggestions() {
    this.elements.cwdSuggestions.classList.add('hidden');
    this.suggestions = [];
    this.selectedSuggestionIndex = -1;
  }

  selectSuggestion(index) {
    if (index >= 0 && index < this.suggestions.length) {
      this.elements.cwdInput.value = this.suggestions[index].path;
      this.hideSuggestions();
      // Trigger another fetch for subdirectories
      this.fetchSuggestions();
    }
  }

  onCwdKeydown(e) {
    // Handle Enter even when no suggestions
    if (e.key === 'Enter' && this.suggestions.length === 0) {
      this.createSession();
      return;
    }

    if (this.suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedSuggestionIndex = Math.min(
          this.selectedSuggestionIndex + 1,
          this.suggestions.length - 1
        );
        this.renderSuggestions();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
        this.renderSuggestions();
        break;

      case 'Tab':
        if (this.selectedSuggestionIndex >= 0) {
          e.preventDefault();
          this.selectSuggestion(this.selectedSuggestionIndex);
        } else if (this.suggestions.length > 0) {
          e.preventDefault();
          this.selectSuggestion(0);
        }
        break;

      case 'Enter':
        if (this.selectedSuggestionIndex >= 0) {
          e.preventDefault();
          this.selectSuggestion(this.selectedSuggestionIndex);
        } else {
          // No suggestion selected - submit the form
          this.hideSuggestions();
          this.createSession();
        }
        break;

      case 'Escape':
        this.hideSuggestions();
        break;
    }
  }

  // Mobile keys methods
  initMobileKeys() {
    // Only init on touch devices
    if (window.matchMedia('(pointer: fine)').matches) return;

    // Handle mobile key button clicks
    this.elements.mobileKeys.addEventListener('click', (e) => {
      const btn = e.target.closest('.mobile-key');
      if (!btn) return;

      const key = btn.dataset.key;
      this.handleMobileKey(key);

      // Keep terminal focused
      this.terminal.focus();
    });

    // Detect keyboard visibility using visualViewport API
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.onViewportChange());
      window.visualViewport.addEventListener('scroll', () => this.onViewportChange());
    }
  }

  onViewportChange() {
    const viewport = window.visualViewport;
    const heightDiff = window.innerHeight - viewport.height;

    // If viewport is significantly smaller than window, keyboard is likely open
    // Using 150px threshold to account for keyboard
    const keyboardOpen = heightDiff > 150;

    if (keyboardOpen && this.elements.mainScreen.classList.contains('active')) {
      // Position toolbar just above the keyboard
      // Account for visual viewport offset when page is scrolled
      const keyboardHeight = window.innerHeight - viewport.height - viewport.offsetTop;
      this.elements.mobileKeys.style.bottom = `${Math.max(0, keyboardHeight)}px`;
      this.showMobileKeys();
    } else {
      this.hideMobileKeys();
    }
  }

  showMobileKeys() {
    this.elements.mobileKeys.classList.remove('hidden');
    this.elements.mobileKeys.classList.add('visible');
    this.elements.mainScreen.classList.add('mobile-keys-visible');
    this.fitTerminal();
  }

  hideMobileKeys() {
    this.elements.mobileKeys.classList.remove('visible');
    this.elements.mainScreen.classList.remove('mobile-keys-visible');
    // Reset modifier states when hiding
    this.setCtrlActive(false);
    this.setShiftActive(false);
    this.fitTerminal();
    // Hide after animation
    setTimeout(() => {
      if (!this.elements.mobileKeys.classList.contains('visible')) {
        this.elements.mobileKeys.classList.add('hidden');
      }
    }, 300);
  }

  handleMobileKey(key) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.currentSessionId) return;

    switch (key) {
      case 'escape':
        this.ws.send('\x1b'); // ESC
        break;
      case 'ctrl':
        this.setCtrlActive(!this.ctrlActive);
        return; // Don't send anything, just toggle state
      case 'shift':
        this.setShiftActive(!this.shiftActive);
        return; // Don't send anything, just toggle state
      case 'tab':
        this.ws.send(this.shiftActive ? '\x1b[Z' : '\t'); // Shift+Tab or Tab
        break;
      case 'slash':
        this.ws.send('/');
        break;
      case 'up':
        this.ws.send('\x1b[A'); // Arrow up
        break;
      case 'down':
        this.ws.send('\x1b[B'); // Arrow down
        break;
    }

    // Clear modifiers after sending a key (except when toggling modifiers)
    if (key !== 'ctrl' && key !== 'shift') {
      if (this.ctrlActive) this.setCtrlActive(false);
      if (this.shiftActive) this.setShiftActive(false);
    }
  }

  setCtrlActive(active) {
    this.ctrlActive = active;
    const ctrlBtn = this.elements.mobileKeys.querySelector('[data-key="ctrl"]');
    if (ctrlBtn) {
      ctrlBtn.setAttribute('aria-pressed', active);
    }
  }

  setShiftActive(active) {
    this.shiftActive = active;
    const shiftBtn = this.elements.mobileKeys.querySelector('[data-key="shift"]');
    if (shiftBtn) {
      shiftBtn.setAttribute('aria-pressed', active);
    }
  }

  // Scroll button methods
  updateScrollButton() {
    if (!this.terminal) return;

    const buffer = this.terminal.buffer.active;
    const totalLines = buffer.baseY + this.terminal.rows;
    const currentScroll = buffer.viewportY;
    const maxScroll = buffer.baseY;

    // Show button if not at bottom (with small threshold for rounding)
    const isAtBottom = currentScroll >= maxScroll - 1;

    if (isAtBottom) {
      this.elements.scrollBottomBtn.classList.add('hidden');
    } else {
      this.elements.scrollBottomBtn.classList.remove('hidden');
    }
  }

  scrollToBottom() {
    if (this.terminal) {
      this.terminal.scrollToBottom();
      this.elements.scrollBottomBtn.classList.add('hidden');
    }
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ClaudeRemote());
} else {
  new ClaudeRemote();
}
