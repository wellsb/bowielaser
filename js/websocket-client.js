/**
 * BowieLaser WebSocket Client
 * Connects to Python FastAPI backend on port 8765 (or custom configured port).
 */

class LaserWebSocketClient {
  constructor(options = {}) {
    this.host = options.host || window.location.hostname || '127.0.0.1';
    this.port = options.port || 8765;
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.reconnectInterval = 2500;
    this.pingTimer = null;
    this.eventListeners = {};

    // Load saved host/port if in localStorage
    const savedHost = localStorage.getItem('bowielaser_host');
    const savedPort = localStorage.getItem('bowielaser_port');
    if (savedHost) this.host = savedHost;
    if (savedPort) this.port = parseInt(savedPort, 10);
  }

  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`Error in [${event}] listener:`, e); }
      });
    }
  }

  getUrl() {
    return `ws://${this.host}:${this.port}/ws`;
  }

  connect(customHost = null, customPort = null) {
    if (customHost) this.host = customHost;
    if (customPort) this.port = customPort;

    localStorage.setItem('bowielaser_host', this.host);
    localStorage.setItem('bowielaser_port', this.port);

    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }

    const url = this.getUrl();
    this.isConnecting = true;
    this.emit('status', { state: 'connecting', url });

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        console.log(`[WS] Connected to BowieLaser Server: ${url}`);
        this.emit('status', { state: 'online', url });
        this.startHeartbeat();
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.stopHeartbeat();
        this.emit('status', { state: 'offline', url });
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn(`[WS] Connection error:`, err);
        this.emit('error', err);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') {
            this.emit('state', msg);
          } else if (msg.type === 'pong') {
            this.emit('pong');
          } else {
            this.emit('message', msg);
          }
        } catch (e) {
          console.error('[WS] Failed to parse message JSON:', e, event.data);
        }
      };

    } catch (err) {
      this.isConnected = false;
      this.isConnecting = false;
      this.emit('status', { state: 'offline', url });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isConnected && !this.isConnecting) {
        this.connect();
      }
    }, this.reconnectInterval);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping' });
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(payload) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.emit('status', { state: 'offline', url: this.getUrl() });
  }
}

window.LaserWebSocketClient = LaserWebSocketClient;
