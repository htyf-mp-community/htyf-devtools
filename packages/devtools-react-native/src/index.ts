import {PROTOCOL_VERSION, type ConsoleLevel, type ReporterEnvelope, type ReporterVersionInfo, type RuntimeInfo, type RuntimePlatform} from '@htyf-mp/devtools-protocol';

export const REPORTER_VERSION = '0.1.0';

/** React Native Reporter 的最小配置。endpoint 与 token 可直接从 Desktop Welcome 页复制。 */
export interface DevToolsOptions {
  endpoint: string;
  token?: string;
  app: Omit<RuntimeInfo, 'runtimeId' | 'deviceId' | 'platform' | 'capabilities'> & {
    deviceId?: string;
    deviceName?: string;
    os?: string;
  };
  /**
   * 采集开关，未配置的项目默认开启。
   * Axios 在 React Native/浏览器中通常使用 XHR，因此默认同时开启 fetch 与 xhr。
   */
  capture?: {console?: boolean; fetch?: boolean; xhr?: boolean; websocket?: boolean};
  maxBodyBytes?: number;
}

/** start/stop 均可重复调用；stop 会恢复所有被包装的全局对象。 */
export interface DevToolsReporter { start(): void; stop(): void; }

const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

function safeValue(value: unknown, depth = 0): unknown {
  // console 参数可能包含循环引用、函数、Error 或超大对象；这里限制深度和宽度，保证上报本身不会抛错。
  if (depth > 4) return '[Max depth]';
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return {name: value.name, message: value.message, stack: value.stack};
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeValue(item, depth + 1));
  try {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).slice(0, 100)) {
      try { output[key] = safeValue((value as Record<string, unknown>)[key], depth + 1); }
      catch { output[key] = '[Unserializable]'; }
    }
    return output;
  } catch { return String(value); }
}

/** @internal 仅供 HTYF 官方 Reporter 包复用采集内核。 */
export function createDevToolsWithIdentity(
  options: DevToolsOptions,
  identity: {platform: RuntimePlatform; reporter: ReporterVersionInfo},
): DevToolsReporter {
  const runtimeId = id('runtime');
  let sequence = 0;
  let socket: WebSocket | undefined;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectAttempt = 0;
  const queue: string[] = [];
  const cleanups: Array<() => void> = [];
  const captureEnabled = (name: 'console' | 'fetch' | 'xhr' | 'websocket') => options.capture?.[name] !== false;

  // Reporter 是旁路诊断模块：任何内部异常都不得逃逸到业务调用栈。
  const safely = <T>(operation: () => T): T | undefined => {
    try { return operation(); } catch { return undefined; }
  };

  const send = (type: string, payload: unknown) => {
    safely(() => {
      const message: ReporterEnvelope = {protocolVersion: PROTOCOL_VERSION, id: id('event'), type, timestamp: Date.now(), runtimeId, sequence: sequence++, payload};
      const encoded = JSON.stringify(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
      // Reload/切网期间保留最近事件；设上限以免调试服务长期离线时持续占用 RN 内存。
      else { queue.push(encoded); if (queue.length > 2000) queue.shift(); }
    });
  };

  const connect = () => {
    if (stopped) return;
    const nextSocket = safely(() => new WebSocket(options.endpoint));
    if (!nextSocket) {
      reconnectTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** reconnectAttempt++));
      return;
    }
    socket = nextSocket;
    socket.onopen = () => {
      reconnectAttempt = 0;
      send('runtime.hello', {
        ...options.app,
        runtimeId,
        deviceId: options.app.deviceId ?? id('device'),
        platform: identity.platform,
        capabilities: [
          captureEnabled('console') && 'console',
          (captureEnabled('fetch') || captureEnabled('xhr')) && 'http',
          captureEnabled('websocket') && 'websocket',
        ].filter((name): name is string => Boolean(name)),
        reporter: identity.reporter,
        token: options.token,
      });
      while (queue.length && socket?.readyState === WebSocket.OPEN) {
        const encoded = queue[0];
        if (safely(() => { socket?.send(encoded); return true; }) !== true) break;
        queue.shift();
      }
    };
    socket.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'runtime.welcome') return;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // 心跳周期由 Desktop 决定，但 Reporter 强制最小 1 秒，避免错误配置形成忙循环。
        const interval = Math.max(1000, Number(message.payload?.heartbeatInterval) || 15000);
        heartbeatTimer = setInterval(() => send('runtime.heartbeat', {}), interval);
      } catch { /* Ignore messages from a newer desktop protocol. */ }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      // 指数退避兼顾开发时快速恢复和 Desktop 不在线时的资源消耗。
      if (!stopped) reconnectTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** reconnectAttempt++));
    };
  };

  const instrumentConsole = () => {
    // 保留原 console 的 this 绑定与行为，上报失败不能改变业务日志语义。
    for (const level of ['debug', 'log', 'info', 'warn', 'error'] as ConsoleLevel[]) {
      const original = console[level];
      console[level] = (...args: unknown[]) => {
        send('console.entry', {level, arguments: args.map(arg => safeValue(arg)), stack: level === 'error' ? new Error().stack : undefined});
        original.apply(console, args);
      };
      cleanups.push(() => { console[level] = original; });
    }
  };

  const instrumentFetch = () => {
    const original = globalThis.fetch;
    if (!original) return;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestId = id('request');
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      const started = Date.now();
      send('http.request.started', {requestId, url, method, headers: init?.headers, body: typeof init?.body === 'string' ? init.body : undefined});
      let response: Response;
      try {
        response = await original(input, init);
      } catch (error) {
        send('http.request.failed', {requestId, duration: Date.now() - started, error: safeValue(error)});
        throw error;
      }
      safely(() => {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        send('http.response.received', {requestId, url, status: response.status, statusText: response.statusText, headers, mimeType: headers['content-type']});
        // clone 避免消费业务方随后要读取的原始 Response body。
        response.clone().text().then(body => send('http.response.body', {requestId, body: body.slice(0, options.maxBodyBytes ?? 1_000_000), truncated: body.length > (options.maxBodyBytes ?? 1_000_000)})).catch(() => undefined);
        send('http.request.completed', {requestId, duration: Date.now() - started});
      });
      return response;
    };
    cleanups.push(() => { globalThis.fetch = original; });
  };

  const instrumentXhr = () => {
    const Xhr = globalThis.XMLHttpRequest;
    if (!Xhr) return;
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    const originalSetHeader = Xhr.prototype.setRequestHeader;
    // WeakMap 让请求元数据跟随 XHR 实例回收，不延长业务对象生命周期。
    const metadata = new WeakMap<XMLHttpRequest, {requestId: string; method: string; url: string; started: number; headers: Record<string, string>}>();

    Xhr.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]) {
      metadata.set(this, {requestId: id('request'), method, url: String(url), started: 0, headers: {}});
      const [async = true, username, password] = rest as [boolean?, string?, string?];
      return originalOpen.call(this, method, url, async, username, password);
    };
    Xhr.prototype.setRequestHeader = function(name: string, value: string) {
      const meta = metadata.get(this);
      if (meta) meta.headers[name] = value;
      return originalSetHeader.call(this, name, value);
    };
    Xhr.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = metadata.get(this);
      safely(() => { if (meta) {
        meta.started = Date.now();
        send('http.request.started', {...meta, body: typeof body === 'string' ? body : undefined});
        this.addEventListener('load', () => {
          const responseHeaders: Record<string, string> = {};
          this.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).forEach(line => {
            const separator = line.indexOf(':');
            if (separator > 0) responseHeaders[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
          });
          send('http.response.received', {requestId: meta.requestId, url: meta.url, status: this.status, statusText: this.statusText, headers: responseHeaders, mimeType: this.getResponseHeader('content-type') || ''});
          try {
            if (typeof this.responseText === 'string') send('http.response.body', {requestId: meta.requestId, body: this.responseText.slice(0, options.maxBodyBytes ?? 1_000_000), truncated: this.responseText.length > (options.maxBodyBytes ?? 1_000_000)});
          } catch { /* Binary response types do not expose responseText. */ }
          send('http.request.completed', {requestId: meta.requestId, duration: Date.now() - meta.started});
        });
        this.addEventListener('error', () => send('http.request.failed', {requestId: meta.requestId, error: 'XHR network error', duration: Date.now() - meta.started}));
        this.addEventListener('abort', () => send('http.request.failed', {requestId: meta.requestId, error: 'XHR aborted', canceled: true, duration: Date.now() - meta.started}));
      }});
      return originalSend.call(this, body);
    };
    cleanups.push(() => {
      Xhr.prototype.open = originalOpen;
      Xhr.prototype.send = originalSend;
      Xhr.prototype.setRequestHeader = originalSetHeader;
    });
  };

  const instrumentWebSocket = () => {
    const OriginalWebSocket = globalThis.WebSocket;
    if (!OriginalWebSocket) return;
    const InstrumentedWebSocket = new Proxy(OriginalWebSocket, {
      construct(Target, args: ConstructorParameters<typeof WebSocket>) {
        const url = String(args[0]);
        const instance = Reflect.construct(Target, args) as WebSocket;
        // Reporter 自己也是 WebSocket，必须排除，否则每次上报会递归产生新的调试事件。
        if (url === options.endpoint) return instance;
        safely(() => {
          const socketId = id('socket');
          send('websocket.created', {socketId, url});
          instance.addEventListener('open', () => send('websocket.opened', {socketId, url}));
          instance.addEventListener('message', event => send('websocket.frameReceived', {socketId, data: safeValue(event.data)}));
          instance.addEventListener('error', () => send('websocket.error', {socketId}));
          instance.addEventListener('close', event => send('websocket.closed', {socketId, code: event.code, reason: event.reason}));
          const originalSend = instance.send.bind(instance);
          instance.send = data => {
            send('websocket.frameSent', {socketId, data: safeValue(data)});
            originalSend(data);
          };
        });
        return instance;
      },
    });
    globalThis.WebSocket = InstrumentedWebSocket;
    cleanups.push(() => { globalThis.WebSocket = OriginalWebSocket; });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (captureEnabled('console')) safely(instrumentConsole);
      if (captureEnabled('fetch')) safely(instrumentFetch);
      if (captureEnabled('xhr')) safely(instrumentXhr);
      if (captureEnabled('websocket')) safely(instrumentWebSocket);
      safely(connect);
    },
    stop() {
      stopped = true;
      safely(() => { if (reconnectTimer) clearTimeout(reconnectTimer); });
      safely(() => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
      safely(() => socket?.close());
      // 逆序恢复，确保多层包装时遵循与安装相反的析构顺序。
      cleanups.splice(0).reverse().forEach(cleanup => safely(cleanup));
    },
  };
}

/** 创建 React Native Reporter；包名和版本由插件内部注入，接入方无法配置。 */
export function createDevTools(options: DevToolsOptions): DevToolsReporter {
  return createDevToolsWithIdentity(options, {
    platform: 'react-native',
    reporter: {packageName: '@htyf-mp/devtools-react-native', version: REPORTER_VERSION},
  });
}
