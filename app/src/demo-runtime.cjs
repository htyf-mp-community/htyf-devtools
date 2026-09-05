const WebSocket = require('ws');
const DESKTOP_VERSION = require('../package.json').version;

class DemoRuntime {
  constructor({endpoint, token, intervalMs = 3000} = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this.intervalMs = intervalMs;
    this.runtimeId = `demo_${Date.now().toString(36)}`;
    this.sequence = 0;
    this.sampleNumber = 0;
  }

  start() {
    if (this.socket) return;
    this.active = true;
    this.socket = new WebSocket(this.endpoint);
    this.socket.on('open', () => {
      if (!this.active) return;
      this.send('runtime.hello', {
        runtimeId: this.runtimeId, deviceId: 'desktop-demo',
        appId: 'com.htyfmp.devtools.demo', appName: '红糖云服调试 Demo', appVersion: '1.0.0',
        platform: 'electron-main', os: process.platform, deviceName: 'Built-in Demo',
        // Demo 也是正式 Reporter 协议客户端，必须携带完整版本信息，否则会被
        // Desktop 正确地识别为未知插件并弹出兼容性警告。
        reporter: {packageName: '@htyf-mp/devtools-desktop-demo', version: DESKTOP_VERSION},
        capabilities: ['console', 'http', 'websocket'], token: this.token,
      });
      // 连接即产生首批事件，后续由缓存回放保证 DevTools 初始化期间的数据不丢失。
      this.generateSample();
      this.sampleTimer = setInterval(() => this.generateSample(), this.intervalMs);
    });
    this.socket.on('message', raw => {
      if (!this.active) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'runtime.welcome') return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this.send('runtime.heartbeat', {}), message.payload?.heartbeatInterval || 15000);
      } catch { /* Demo ignores unknown desktop messages. */ }
    });
    this.socket.on('error', error => console.error('[demo] reporter connection failed', error.message));
  }

  send(type, payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({protocolVersion: 1, id: `demo_event_${Date.now().toString(36)}_${this.sequence}`, type, timestamp: Date.now(), runtimeId: this.runtimeId, sequence: this.sequence++, payload}));
  }

  generateSample() {
    // 一次 sample 同时覆盖 Console、HTTP、WebSocket，作为人工验收的最小完整数据集。
    const sample = ++this.sampleNumber;
    const requestId = `demo_request_${sample}`;
    const socketId = this.demoSocketId || (this.demoSocketId = `demo_socket_${Date.now().toString(36)}`);
    const url = `https://api.example.com/v1/demo?sample=${sample}`;
    this.send('console.entry', {level: 'log', arguments: ['HTYF Demo event', {sample, timestamp: new Date().toISOString()}]});
    this.send('console.entry', {level: sample % 3 === 0 ? 'warn' : 'info', arguments: [`Sample #${sample}`, 'Console pipeline is working']});
    this.send('http.request.started', {requestId, url, method: 'GET', headers: {'x-htyf-demo': 'true'}});
    this.send('http.response.received', {requestId, url, status: 200, statusText: 'OK', headers: {'content-type': 'application/json'}, mimeType: 'application/json'});
    this.send('http.response.body', {requestId, body: JSON.stringify({ok: true, sample, source: '红糖云服调试 Demo'}), truncated: false});
    this.send('http.request.completed', {requestId, duration: 20 + sample % 30, size: 64});
    if (!this.demoSocketOpened) {
      this.demoSocketOpened = true;
      this.send('websocket.created', {socketId, url: 'wss://echo.example.com/events'});
      this.send('websocket.opened', {socketId, url: 'wss://echo.example.com/events'});
    }
    this.send('websocket.frameSent', {socketId, data: JSON.stringify({action: 'ping', sample})});
    this.send('websocket.frameReceived', {socketId, data: JSON.stringify({action: 'pong', sample})});
  }

  stop() {
    // active 标记用于阻止已排队的 welcome 回调在 stop 后重新创建心跳。
    this.active = false;
    clearInterval(this.sampleTimer);
    clearInterval(this.heartbeatTimer);
    if (this.demoSocketOpened) this.send('websocket.closed', {socketId: this.demoSocketId, code: 1000, reason: 'Demo stopped'});
    this.demoSocketOpened = false;
    this.demoSocketId = undefined;
    this.socket?.close();
    this.socket = undefined;
  }
}

module.exports = {DemoRuntime};
