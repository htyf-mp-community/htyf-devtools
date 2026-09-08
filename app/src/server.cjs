const http = require('node:http');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {timingSafeEqual} = require('node:crypto');
const QRCode = require('qrcode');
const portfinder = require('portfinder');
const systeminformation = require('systeminformation');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.WebSocketServer || WebSocket.Server;
const DEFAULT_DESKTOP_VERSION = require('../package.json').version;
const REPORTER_COMPATIBILITY = require('./reporter-compatibility.json').reporters;

function parseVersion(value) {
  const match = String(value || '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-|$)/);
  return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/** 版本异常只产生诊断状态，不阻止 Reporter 建连或业务继续运行。 */
function evaluateCompatibility(desktopVersion, reporter) {
  const base = {desktopVersion, reporterPackage: reporter?.packageName, reporterVersion: reporter?.version};
  if (!reporter?.packageName || !reporter?.version) {
    return {...base, status: 'unknown', message: '插件未提供完整包名和版本信息，请升级接入插件后重新连接。'};
  }
  const supported = REPORTER_COMPATIBILITY[reporter.packageName];
  if (!supported) {
    return {...base, status: 'unknown', message: `桌面端没有 ${reporter.packageName} 的兼容规则。`};
  }
  const plugin = parseVersion(reporter.version);
  const minimum = parseVersion(supported.min);
  const maximum = parseVersion(supported.maxExclusive);
  if (!plugin || !minimum || !maximum) {
    return {...base, status: 'unknown', message: '无法解析插件版本或桌面端兼容规则。'};
  }
  const compatible = compareVersions(plugin, minimum) >= 0 && compareVersions(plugin, maximum) < 0;
  return {
    ...base,
    status: compatible ? 'compatible' : 'incompatible',
    supportedReporter: `>=${supported.min} <${supported.maxExclusive}`,
    message: compatible
      ? `插件 v${reporter.version} 与桌面端 v${desktopVersion} 兼容。`
      : `桌面端 v${desktopVersion} 支持的 ${reporter.packageName} 版本为 >=${supported.min} <${supported.maxExclusive}，当前插件为 v${reporter.version}。`,
  };
}

function selectNetworkAddress(interfaces) {
  // Windows 上 systeminformation 可能把 Wi-Fi/以太网误标成 virtual。virtual 只能作为
  // 选择优先级，不能作为硬过滤条件，否则部分机器会在启动阶段完全找不到地址。
  return interfaces
    .filter(item => item.ip4 && item.ip4 !== '127.0.0.1' && !item.ip4.startsWith('169.254.') && !item.internal && item.operstate !== 'down')
    .sort((left, right) => {
      const score = item => Number(!item.virtual) * 4 + Number(Boolean(item.default)) * 2 + Number(item.operstate === 'up');
      return score(right) - score(left);
    })[0]?.ip4;
}

const COMPAT_NOOP_METHODS = new Set([
  'Animation.enable', 'Audits.enable', 'Autofill.enable', 'Autofill.setAddresses',
  'CSS.enable', 'DOM.enable', 'DOMDebugger.setBreakOnCSPViolation',
  'Debugger.enable', 'Debugger.setAsyncCallStackDepth', 'Debugger.setBlackboxPatterns',
  'Debugger.setPauseOnExceptions', 'Emulation.setEmulatedMedia',
  'Emulation.setEmulatedVisionDeficiency', 'Emulation.setFocusEmulationEnabled',
  'Inspector.enable', 'Log.enable', 'Log.startViolationsReport',
  'HeapProfiler.enable',
  'Network.clearAcceptedEncodingsOverride', 'Network.disable', 'Network.enable',
  'Network.setAttachDebugStack', 'Overlay.enable', 'Overlay.setShowGridOverlays',
  'Overlay.setShowFlexOverlays', 'Overlay.setShowScrollSnapOverlays',
  'Overlay.setShowContainerQueryOverlays', 'Overlay.setShowIsolatedElements',
  'Overlay.setShowViewportSizeOnResize', 'Overlay.hideHighlight', 'Page.enable', 'Page.setAdBlockingEnabled',
  'Profiler.enable', 'ReactNativeApplication.enable', 'Runtime.addBinding',
  'Runtime.disable', 'Runtime.enable', 'Runtime.runIfWaitingForDebugger',
  'ServiceWorker.enable', 'Target.setAutoAttach', 'Target.setDiscoverTargets',
  'Target.setRemoteLocations',
]);

class DevToolsServer extends EventEmitter {
  constructor({host = '127.0.0.1', port = 17654, frontendDir, requirePairing, pairingToken, desktopVersion = DEFAULT_DESKTOP_VERSION, maxPayloadBytes = 1024 * 1024, heartbeatIntervalMs = 15000, heartbeatTimeoutMs = 45000, heartbeatSweepMs = 5000, networkInterfacesProvider = systeminformation.networkInterfaces} = {}) {
    super();
    this.host = host;
    this.port = port;
    this.runtimes = new Map();
    this.bodyStore = new Map();
    this.cdpClients = new Map();
    this.cdpClientState = new WeakMap();
    this.remoteObjects = new Map();
    this.nextRemoteObjectId = 1;
    this.frontendDir = frontendDir;
    this.requirePairing = requirePairing ?? host === '0.0.0.0';
    this.pairingToken = pairingToken ?? '123456';
    this.maxPayloadBytes = maxPayloadBytes;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.heartbeatSweepMs = heartbeatSweepMs;
    this.networkInterfacesProvider = networkInterfacesProvider;
    this.desktopVersion = desktopVersion;
  }

  async start() {
    // 监听地址与展示地址分离：0.0.0.0 用于接收真机连接，advertisedHost 用于 URL/二维码。
    await this.refreshAdvertisedHost({initial: true});
    // port=0 明确表示由操作系统分配随机端口，主要用于测试和临时实例。
    // 其他端口先通过 portfinder 探测，占用时从目标端口开始向后寻找。
    if (this.port !== 0) {
      this.port = await portfinder.getPortPromise({
        port: this.port,
        stopPort: Math.min(65535, this.port + 100),
        host: this.host,
      });
    }
    this.httpServer = http.createServer((request, response) => this.handleHttp(request, response));
    this.reporterServer = new WebSocketServer({noServer: true, maxPayload: this.maxPayloadBytes});
    this.cdpServer = new WebSocketServer({noServer: true, maxPayload: 256 * 1024});
    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/reporter') {
        this.reporterServer.handleUpgrade(request, socket, head, ws => this.handleReporter(ws));
      } else if (url.pathname.startsWith('/cdp/')) {
        const runtimeId = decodeURIComponent(url.pathname.slice('/cdp/'.length));
        this.cdpServer.handleUpgrade(request, socket, head, ws => this.handleCdp(ws, runtimeId));
      } else socket.destroy();
    });
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.port, this.host, () => resolve());
    });
    const address = this.httpServer.address();
    this.port = typeof address === 'object' ? address.port : this.port;
    this.heartbeatSweep = setInterval(() => this.expireStaleRuntimes(), this.heartbeatSweepMs);
    this.heartbeatSweep.unref?.();
    const state = this.getState();
    this.emit('listening', state);
    return state;
  }

  async refreshAdvertisedHost({initial = false} = {}) {
    if (this.refreshingNetwork) return false;
    this.refreshingNetwork = true;
    try {
      let lanAddress;
      if (this.host === '0.0.0.0') {
        try { lanAddress = selectNetworkAddress(await this.networkInterfacesProvider()); }
        catch (error) {
          console.warn('[server] unable to inspect LAN interfaces; keeping current address', error);
          return false;
        }
      }
      const advertisedHost = this.host === '0.0.0.0' ? lanAddress || 'localhost' : this.host;
      const lanAvailable = this.host === '0.0.0.0' ? Boolean(lanAddress) : !['127.0.0.1', 'localhost', '::1'].includes(this.host);
      const changed = advertisedHost !== this.advertisedHost || lanAvailable !== this.lanAvailable;
      this.advertisedHost = advertisedHost;
      this.lanAvailable = lanAvailable;
      if (changed && !initial) {
        const state = this.getState();
        this.emit('state', state);
        this.emit('listening', state);
      }
      return changed;
    } finally {
      this.refreshingNetwork = false;
    }
  }

  expireStaleRuntimes() {
    // WebSocket 半开连接不一定及时触发 close，通过应用层心跳修正 Runtime 在线状态。
    const cutoff = Date.now() - this.heartbeatTimeoutMs;
    for (const runtime of this.runtimes.values()) {
      if (runtime.connected && runtime.lastSeenAt < cutoff) runtime.socket.terminate();
    }
  }

  getState(includeSecret = false) {
    // pairingToken 只允许本机调用方显式请求；Runtime 元数据永远不保存握手 token。
    return {
      status: 'listening',
      desktopVersion: this.desktopVersion,
      url: `http://${this.advertisedHost}:${this.port}`,
      reporterUrl: `ws://${this.advertisedHost}:${this.port}/reporter`,
      lanAvailable: this.lanAvailable,
      lanReporterUrl: this.host === '0.0.0.0' && this.lanAvailable ? `ws://${this.advertisedHost}:${this.port}/reporter` : undefined,
      requirePairing: this.requirePairing,
      pairingToken: includeSecret && this.requirePairing ? this.pairingToken : undefined,
      runtimes: [...this.runtimes.values()].map(({socket, events, ...runtime}) => runtime),
    };
  }

  getPairingPayload() {
    const state = this.getState();
    return {type: 'htyf.devtools.pairing', version: 1, endpoint: state.lanReporterUrl || state.reporterUrl, token: this.requirePairing ? this.pairingToken : ''};
  }

  setPairingToken(token) {
    if (typeof token !== 'string') throw new TypeError('Pairing token must be a string');
    this.pairingToken = token;
    // 凭证变化后旧会话不再可信：立即断开全部 Reporter，应用必须使用
    // 新凭证重新握手。CDP 客户端保留，待应用重连后可继续接收数据。
    for (const runtime of this.runtimes.values()) {
      if (!runtime.connected) continue;
      runtime.connected = false;
      runtime.socket.close(4001, 'Pairing token changed');
    }
    this.emit('state', this.getState());
    return this.getState(true);
  }

  isAuthorized(token) {
    if (!this.requirePairing) return true;
    if (typeof token !== 'string') return false;
    const actual = Buffer.from(token);
    const expected = Buffer.from(this.pairingToken);
    // 先校验长度是 timingSafeEqual 的调用要求，再做常量时间比较。
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async handleHttp(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (url.pathname === '/health') return response.end(JSON.stringify({ok: true}));
    if (url.pathname === '/state') {
      const remote = request.socket.remoteAddress;
      const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      // LAN 客户端能读取连接状态，但不能通过 HTTP 获取配对密钥。
      return response.end(JSON.stringify(this.getState(isLoopback)));
    }
    if (url.pathname === '/pairing.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      return response.end(await QRCode.toString(JSON.stringify(this.getPairingPayload()), {type: 'svg', margin: 1}));
    }
    if (url.pathname.startsWith('/devtools/') && this.frontendDir) {
      const relative = decodeURIComponent(url.pathname.slice('/devtools/'.length));
      const file = path.resolve(this.frontendDir, relative || 'rn_fusebox.html');
      if (!file.startsWith(path.resolve(this.frontendDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.statusCode = 404; return response.end(JSON.stringify({error: 'Not found'}));
      }
      const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      return fs.createReadStream(file).pipe(response);
    }
    if (url.pathname === '/json' || url.pathname === '/json/list') {
      return response.end(JSON.stringify([...this.runtimes.values()].map(runtime => ({
        id: runtime.runtimeId,
        type: 'node',
        title: runtime.appName,
        description: `${runtime.platform}${runtime.deviceName ? ` · ${runtime.deviceName}` : ''}`,
        webSocketDebuggerUrl: `ws://${request.headers.host}/cdp/${encodeURIComponent(runtime.runtimeId)}`,
        devtoolsFrontendUrl: `/rn_fusebox.html?ws=${request.headers.host}/cdp/${encodeURIComponent(runtime.runtimeId)}`,
      }))));
    }
    if (url.pathname === '/json/version') return response.end(JSON.stringify({'Browser': 'Hongtang Cloud DevTools/0.1', 'Protocol-Version': '1.3'}));
    response.statusCode = 404;
    response.end(JSON.stringify({error: 'Not found'}));
  }

  handleReporter(socket) {
    // Reporter 必须先发送 runtime.hello；在完成版本、身份和 token 校验前不接受业务事件。
    let runtimeId;
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1007, 'Invalid JSON'); return; }
      if (message.type === 'runtime.hello') {
        if (message.protocolVersion !== 1) {
          socket.close(1002, 'Unsupported protocol version');
          return;
        }
        if (!message.payload?.runtimeId || !message.payload?.appName || message.runtimeId !== message.payload.runtimeId) {
          socket.close(1008, 'Invalid runtime metadata');
          return;
        }
        if (!this.isAuthorized(message.payload?.token)) {
          socket.close(1008, 'Invalid pairing token');
          return;
        }
        runtimeId = message.runtimeId || message.payload.runtimeId;
        const now = Date.now();
        // token 是一次握手凭据，不属于可展示或可持久化的 Runtime 信息。
        const {token: _pairingToken, ...runtimeInfo} = message.payload;
        const compatibility = evaluateCompatibility(this.desktopVersion, runtimeInfo.reporter);
        this.runtimes.set(runtimeId, {...runtimeInfo, compatibility, runtimeId, connected: true, connectedAt: now, lastSeenAt: now, socket, events: []});
        socket.send(JSON.stringify({protocolVersion: 1, type: 'runtime.welcome', payload: {sessionId: runtimeId, heartbeatInterval: this.heartbeatIntervalMs, desktopVersion: this.desktopVersion, compatibility}}));
        this.emit('state', this.getState());
        return;
      }
      if (!runtimeId) return;
      const runtime = this.runtimes.get(runtimeId);
      if (!runtime) return;
      runtime.lastSeenAt = Date.now();
      if (message.type === 'runtime.heartbeat') return;
      runtime.events.push(message);
      if (runtime.events.length > 5000) runtime.events.shift();
      if (message.type === 'http.response.body') this.bodyStore.set(`${runtimeId}:${message.payload.requestId}`, message.payload);
      this.emitCdp(runtimeId, this.toCdp(message, runtimeId));
    });
    socket.on('close', () => {
      const runtime = this.runtimes.get(runtimeId);
      if (runtime) { runtime.connected = false; this.emit('state', this.getState()); }
    });
  }

  handleCdp(socket, runtimeId) {
    // 每个 DevTools 前端独立订阅 Domain，未 enable 的 Domain 不推送事件。
    if (!this.cdpClients.has(runtimeId)) this.cdpClients.set(runtimeId, new Set());
    this.cdpClients.get(runtimeId).add(socket);
    this.cdpClientState.set(socket, {runtime: false, network: false});
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString());
      let result = {};
      if (request.method === 'Network.getResponseBody') {
        const stored = this.bodyStore.get(`${runtimeId}:${request.params.requestId}`);
        result = stored ? {body: stored.body || '', base64Encoded: false} : {body: '', base64Encoded: false};
      } else if (request.method === 'Page.getResourceTree') {
        result = {frameTree: {frame: {id: 'root', loaderId: 'root', url: '', domainAndRegistry: '', securityOrigin: '', mimeType: 'text/html'}, childFrames: [], resources: []}};
      } else if (request.method === 'Runtime.getIsolateId') {
        result = {id: `htyf-${runtimeId}`};
      } else if (request.method === 'Runtime.getHeapUsage') {
        result = {usedSize: 0, totalSize: 0};
      } else if (request.method === 'Runtime.getProperties') {
        // Console 展开对象时按 objectId 懒加载属性，行为与真实 CDP Runtime 一致。
        const value = this.remoteObjects.get(request.params?.objectId);
        result = {result: value && typeof value === 'object' ? Object.entries(value).map(([name, property]) => ({name, value: this.toRemoteObject(runtimeId, property), writable: false, configurable: true, enumerable: true, isOwn: true})) : [], internalProperties: []};
      } else if (request.method === 'Runtime.releaseObject') {
        this.remoteObjects.delete(request.params?.objectId);
      } else if (request.method === 'Debugger.enable') {
        result = {debuggerId: `htyf-debugger-${runtimeId}`};
      } else if (request.method === 'Storage.getStorageKeyForFrame') {
        result = {storageKey: ''};
      } else if (request.method === 'Page.addScriptToEvaluateOnNewDocument') {
        result = {identifier: 'htyf-bootstrap'};
      } else if (request.method === 'Runtime.evaluate') {
        result = {result: {type: 'undefined'}};
      } else if (request.method === 'Schema.getDomains') {
        result = {domains: [{name: 'Runtime', version: '1.3'}, {name: 'Network', version: '1.3'}]};
      } else if (!COMPAT_NOOP_METHODS.has(request.method)) {
        socket.send(JSON.stringify({id: request.id, error: {code: -32601, message: `Method not found: ${request.method}`}}));
        return;
      }
      socket.send(JSON.stringify({id: request.id, result}));
      if (request.method === 'Runtime.enable') {
        this.cdpClientState.get(socket).runtime = true;
        socket.send(JSON.stringify({method: 'Runtime.executionContextCreated', params: {context: {id: 1, origin: '', name: 'HTYF Reporter', uniqueId: `htyf-${runtimeId}`, auxData: {isDefault: true, type: 'default'}}}}));
        this.replayDomain(socket, runtimeId, 'Runtime.');
      } else if (request.method === 'Network.enable') {
        this.cdpClientState.get(socket).network = true;
        this.replayDomain(socket, runtimeId, 'Network.');
      } else if (request.method === 'Runtime.disable') {
        this.cdpClientState.get(socket).runtime = false;
      } else if (request.method === 'Network.disable') {
        this.cdpClientState.get(socket).network = false;
      }
    });
    socket.on('close', () => this.cdpClients.get(runtimeId)?.delete(socket));
  }

  emitCdp(runtimeId, event) {
    if (!event) return;
    if (Array.isArray(event)) {
      for (const item of event) this.emitCdp(runtimeId, item);
      return;
    }
    for (const client of this.cdpClients.get(runtimeId) || []) {
      const state = this.cdpClientState.get(client);
      const enabled = event.method.startsWith('Runtime.') ? state?.runtime : event.method.startsWith('Network.') ? state?.network : true;
      if (enabled && client.readyState === 1) client.send(JSON.stringify(event));
    }
  }

  replayDomain(socket, runtimeId, domain) {
    // Reporter 通常早于 DevTools 前端连接；Domain enable 后回放缓存，避免丢失启动日志。
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) return;
    for (const message of runtime.events) {
      const event = this.toCdp(message, runtimeId);
      for (const item of Array.isArray(event) ? event : event ? [event] : []) {
        if (item.method.startsWith(domain) && socket.readyState === 1) socket.send(JSON.stringify(item));
      }
    }
  }

  toRemoteObject(runtimeId, value) {
    if (value === null) return {type: 'object', subtype: 'null', value: null, description: 'null'};
    const type = typeof value;
    if (type !== 'object') return {type, value, description: String(value)};
    const objectId = `htyf:${runtimeId}:${this.nextRemoteObjectId++}`;
    this.remoteObjects.set(objectId, value);
    // RemoteObject 只服务于调试 UI；采用有界 FIFO，防止长时间会话无限占用内存。
    if (this.remoteObjects.size > 10000) this.remoteObjects.delete(this.remoteObjects.keys().next().value);
    const array = Array.isArray(value);
    const description = array ? `Array(${value.length})` : 'Object';
    const entries = Object.entries(value);
    const properties = entries.slice(0, 5).map(([name, property]) => {
      const propertyType = property === null ? 'object' : typeof property;
      const propertyArray = Array.isArray(property);
      return {name, type: propertyType, subtype: property === null ? 'null' : propertyArray ? 'array' : undefined, value: propertyType === 'object' ? property === null ? 'null' : propertyArray ? `Array(${property.length})` : 'Object' : String(property)};
    });
    return {type: 'object', subtype: array ? 'array' : undefined, className: array ? 'Array' : 'Object', description, objectId, preview: {type: 'object', subtype: array ? 'array' : undefined, description, overflow: entries.length > properties.length, properties}};
  }

  toCdp(message, runtimeId = message.runtimeId) {
    // 这是自定义 Reporter 协议到 Chrome DevTools Protocol 的唯一转换 seam。
    const p = message.payload || {};
    const timestamp = message.timestamp / 1000;
    if (message.type === 'console.entry') return {method: 'Runtime.consoleAPICalled', params: {type: p.level === 'log' ? 'log' : p.level, args: (p.arguments || []).map(value => this.toRemoteObject(runtimeId, value)), executionContextId: 1, timestamp: message.timestamp}};
    if (message.type === 'http.request.started') return {method: 'Network.requestWillBeSent', params: {requestId: p.requestId, loaderId: p.requestId, documentURL: p.url, request: {url: p.url, method: p.method, headers: p.headers || {}, hasPostData: p.body !== undefined, postData: p.body}, timestamp, wallTime: timestamp, initiator: {type: 'script'}, type: 'Fetch'}};
    if (message.type === 'http.response.received') return {method: 'Network.responseReceived', params: {requestId: p.requestId, loaderId: p.requestId, timestamp, type: 'Fetch', response: {url: p.url, status: p.status, statusText: p.statusText || '', headers: p.headers || {}, mimeType: p.mimeType || '', connectionReused: false, connectionId: 0, encodedDataLength: 0, securityState: 'unknown'}}};
    if (message.type === 'http.request.completed') return {method: 'Network.loadingFinished', params: {requestId: p.requestId, timestamp, encodedDataLength: p.size || 0}};
    if (message.type === 'http.request.failed') return {method: 'Network.loadingFailed', params: {requestId: p.requestId, timestamp, type: 'Fetch', errorText: p.error?.message || String(p.error || 'Request failed'), canceled: false}};
    if (message.type === 'websocket.created') return [
      {method: 'Network.webSocketCreated', params: {requestId: p.socketId, url: p.url, initiator: {type: 'script'}}},
      {method: 'Network.webSocketWillSendHandshakeRequest', params: {requestId: p.socketId, timestamp, wallTime: timestamp, request: {url: p.url, method: 'GET', headers: p.requestHeaders || {Connection: 'Upgrade', Upgrade: 'websocket'}}}},
    ];
    if (message.type === 'websocket.opened') return {method: 'Network.webSocketHandshakeResponseReceived', params: {requestId: p.socketId, timestamp, response: {url: p.url, status: 101, statusText: 'Switching Protocols', headers: p.responseHeaders || {Connection: 'Upgrade', Upgrade: 'websocket'}, headersText: '', requestHeaders: p.requestHeaders || {Connection: 'Upgrade', Upgrade: 'websocket'}}}};
    const ws = {frameSent: 'Network.webSocketFrameSent', frameReceived: 'Network.webSocketFrameReceived', closed: 'Network.webSocketClosed'}[message.type.replace('websocket.', '')];
    if (ws) return {method: ws, params: {requestId: p.socketId, url: p.url, timestamp, response: p.data == null ? undefined : {opcode: typeof p.data === 'string' ? 1 : 2, mask: false, payloadData: typeof p.data === 'string' ? p.data : JSON.stringify(p.data)}}};
    return null;
  }

  async stop() {
    clearInterval(this.heartbeatSweep);
    for (const runtime of this.runtimes.values()) runtime.socket.close();
    for (const clients of this.cdpClients.values()) for (const client of clients) client.close();
    await new Promise(resolve => this.httpServer.close(resolve));
  }
}

module.exports = {DevToolsServer, selectNetworkAddress, evaluateCompatibility};
