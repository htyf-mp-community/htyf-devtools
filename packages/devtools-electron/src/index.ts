import {PROTOCOL_VERSION, type ManualReporter, type ReportEventMap, type ConsoleLevel, type ReporterEnvelope, type RuntimeInfo} from '@htyf-mp/devtools-protocol';
import http from 'node:http';
import https from 'node:https';

export type {
  ConsoleLevel, ConsoleEntry, HttpRequestStarted, HttpResponseReceived,
  HttpResponseBody, HttpRequestCompleted, HttpRequestFailed,
  WebSocketCreated, WebSocketOpened, WebSocketFrame, WebSocketClosed,
  WebSocketError, ReportEventMap, ManualReporter,
} from '@htyf-mp/devtools-protocol';

export const REPORTER_VERSION = '0.1.2';

/** Electron 主进程 Reporter 配置；不依赖 renderer 或 Electron IPC。 */
export interface ElectronDevToolsOptions {
  endpoint: string;
  token?: string;
  app: Omit<RuntimeInfo, 'runtimeId' | 'deviceId' | 'platform' | 'capabilities'> & {
    deviceId?: string;
    deviceName?: string;
    os?: string;
  };
  /** 自动采集开关，未配置的项目默认开启；false 关闭全部自动采集，手动上报仍可用。 */
  capture?: false | {console?: boolean; fetch?: boolean; nodeHttp?: boolean; websocket?: boolean};
  /** Third-party Node WebSocket constructors, for example the default export from `ws`. */
  webSocketConstructors?: NodeWebSocketConstructor[];
  maxBodyBytes?: number;
}

export interface NodeWebSocketLike {
  url?: unknown;
  send(...args: any[]): any;
  on?(event: string, listener: (...args: any[]) => void): any;
  off?(event: string, listener: (...args: any[]) => void): any;
  removeListener?(event: string, listener: (...args: any[]) => void): any;
}

export interface NodeWebSocketConstructor {
  new (...args: any[]): NodeWebSocketLike;
  prototype: NodeWebSocketLike & {emit?(event: string, ...args: any[]): boolean};
}

export interface ObserveWebSocketOptions {
  url?: string;
  direction?: 'client' | 'server';
}

/** start/stop 幂等；observeWebSocket 用于 WebSocketServer 已接收的连接。 */
export interface ElectronDevToolsReporter extends ManualReporter {
  start(): void;
  stop(): void;
  observeWebSocket(socket: NodeWebSocketLike, metadata?: ObserveWebSocketOptions): () => void;
}

const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

function safeValue(value: unknown, depth = 0): unknown {
  // 将任意 Node/Electron 值收敛为有界、可 JSON 序列化的数据。
  if (depth > 4) return '[Max depth]';
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return {name: value.name, message: value.message, stack: value.stack};
  // npm `ws` emits text frames as Buffer by default; keep them readable in the
  // DevTools Network panel instead of expanding every byte as an object key.
  const nodeBuffer = (globalThis as {
    Buffer?: {isBuffer(candidate: unknown): boolean};
  }).Buffer;
  if (nodeBuffer?.isBuffer(value)) {
    return (value as {toString(encoding: string): string}).toString('utf8');
  }
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

export function createElectronDevTools(options: ElectronDevToolsOptions): ElectronDevToolsReporter {
  const runtimeId = id('electron');
  const deviceId = options.app.deviceId ?? id('desktop');
  let sequence = 0;
  let socket: WebSocket | undefined;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectAttempt = 0;
  const queue: string[] = [];
  const cleanups: Array<() => void> = [];
  const observedSockets = new WeakMap<object, {socketId: string; url: string; opened: boolean; direction: 'client' | 'server'}>();
  const instrumentedPrototypes = new WeakSet<object>();
  const captureEnabled = (name: 'console' | 'fetch' | 'nodeHttp' | 'websocket') => options.capture !== false && options.capture?.[name] !== false;
  // DevTools is strictly observational: its failures must never escape into the application.
  const safely = <T>(operation: () => T): T | undefined => {
    try { return operation(); } catch { return undefined; }
  };

  const send = (type: string, payload: unknown) => {
    safely(() => {
      const message: ReporterEnvelope = {protocolVersion: PROTOCOL_VERSION, id: id('event'), type, timestamp: Date.now(), runtimeId, sequence: sequence++, payload};
      const encoded = JSON.stringify(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
      else { queue.push(encoded); if (queue.length > 2000) queue.shift(); }
    });
  };

  // 与自动采集共用传输队列和身份；仅序列化任意业务值，保留完整协议字段。
  const report: ManualReporter['report'] = (type, payload) => {
    if (stopped) return;
    safely(() => {
      const event: Record<string, unknown> = {...payload};
      if (type === 'console.entry') {
        event.arguments = (payload as ReportEventMap['console.entry']).arguments.map(value => safeValue(value));
      }
      if ('error' in event) event.error = safeValue(event.error);
      if ('data' in event) event.data = safeValue(event.data);
      if (typeof event.body === 'string') {
        const limit = options.maxBodyBytes ?? 1_000_000;
        const truncatedKey = type === 'http.request.started' ? 'bodyTruncated' : 'truncated';
        event[truncatedKey] = Boolean(event[truncatedKey]) || event.body.length > limit;
        event.body = event.body.slice(0, limit);
      }
      send(type, event);
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
    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      send('runtime.hello', {
        ...options.app,
        runtimeId,
        deviceId,
        platform: 'electron-main',
        // 手动上报始终支持三类事件，capture 仅控制自动采集。
        capabilities: ['console', 'http', 'websocket'],
        reporter: {
          packageName: '@htyf-mp/devtools-electron',
          version: REPORTER_VERSION,
        },
        token: options.token,
      });
      while (queue.length && socket?.readyState === WebSocket.OPEN) {
        const encoded = queue[0];
        if (safely(() => { socket?.send(encoded); return true; }) !== true) break;
        queue.shift();
      }
    });
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'runtime.welcome') return;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // Desktop 是心跳策略的唯一来源，Reporter 只负责执行。
        const interval = Math.max(1000, Number(message.payload?.heartbeatInterval) || 15000);
        heartbeatTimer = setInterval(() => send('runtime.heartbeat', {}), interval);
      } catch { /* Ignore messages from a newer desktop protocol. */ }
    });
    socket.addEventListener('close', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      if (stopped) return;
      const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(connect, delay);
    });
    socket.addEventListener('error', () => undefined);
  };

  const instrumentConsole = () => {
    // 调用原方法而非只上报，确保主进程原有 stdout/stderr 行为不变。
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
        // clone 后异步读取，不阻塞也不消费业务 Response。
        response.clone().text().then(body => {
          const limit = options.maxBodyBytes ?? 1_000_000;
          send('http.response.body', {requestId, body: body.slice(0, limit), truncated: body.length > limit});
        }).catch(() => undefined);
        send('http.request.completed', {requestId, duration: Date.now() - started});
      });
      return response;
    };
    cleanups.push(() => { globalThis.fetch = original; });
  };

  const instrumentNodeHttp = () => {
    // Axios、got 以及多数 Node SDK 最终都会进入这两个入口。只旁路观察
    // ClientRequest/IncomingMessage，不新增 data listener，避免改变流的消费模式。
    for (const transport of [http, https]) {
      const originalRequest = transport.request;
      const originalGet = transport.get;
      const wrappedRequest = function(this: unknown, ...args: any[]) {
        const requestId = id('request');
        const started = Date.now();
        let request: any;
        try {
          request = originalRequest.apply(transport, args as any);
        } catch (error) {
          send('http.request.failed', {requestId, duration: Date.now() - started, error: safeValue(error)});
          throw error;
        }

        safely(() => {
          const first = args[0];
          const requestOptions = (typeof first === 'object' && !(first instanceof URL) ? first : args[1]) ?? {};
          const protocol = requestOptions.protocol ?? (transport === https ? 'https:' : 'http:');
          const host = requestOptions.hostname ?? requestOptions.host ?? 'localhost';
          const path = requestOptions.path ?? '/';
          const url = typeof first === 'string' || first instanceof URL ? String(first) : `${protocol}//${host}${path}`;
          const method = requestOptions.method ?? request.method ?? 'GET';
          const requestChunks: Uint8Array[] = [];
          const requestLimit = options.maxBodyBytes ?? 1_000_000;
          let requestBytes = 0;
          let requestTruncated = false;
          let requestStarted = false;
          const captureRequestChunk = (value: unknown) => {
            if (value == null || requestBytes >= requestLimit) {
              if (value != null) requestTruncated = true;
              return;
            }
            if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) return;
            const chunk = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value as Uint8Array);
            const remaining = requestLimit - requestBytes;
            requestChunks.push(chunk.subarray(0, remaining));
            requestBytes += Math.min(chunk.length, remaining);
            if (chunk.length > remaining) requestTruncated = true;
          };
          const emitRequestStarted = () => {
            if (requestStarted) return;
            requestStarted = true;
            const body = requestChunks.length ? Buffer.concat(requestChunks).toString('utf8') : undefined;
            send('http.request.started', {
              requestId,
              url,
              method,
              headers: requestOptions.headers ?? request.getHeaders?.(),
              body,
              bodyTruncated: requestTruncated,
            });
          };
          const originalWrite = request.write;
          const originalEnd = request.end;
          if (typeof originalWrite === 'function') {
            request.write = function(this: unknown, ...writeArgs: unknown[]) {
              safely(() => captureRequestChunk(writeArgs[0]));
              return originalWrite.apply(this, writeArgs);
            };
          }
          if (typeof originalEnd === 'function') {
            request.end = function(this: unknown, ...endArgs: unknown[]) {
              safely(() => captureRequestChunk(endArgs[0]));
              safely(emitRequestStarted);
              return originalEnd.apply(this, endArgs);
            };
          } else {
            emitRequestStarted();
          }

          request.once?.('response', (response: any) => {
            emitRequestStarted();
            const headers = response.headers ?? {};
            send('http.response.received', {
              requestId,
              url,
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers,
              mimeType: headers['content-type'] ?? '',
            });
            // 不注册 `data` listener（注册会让 paused stream 进入 flowing 模式）。
            // 改为旁路包装实例的 emit：只有业务/Axios 本身消费响应时才复制数据，
            // 调用顺序、返回值和业务收到的 chunk 均保持不变。
            const originalEmit = response.emit;
            const chunks: Uint8Array[] = [];
            const limit = options.maxBodyBytes ?? 1_000_000;
            let capturedBytes = 0;
            let truncated = false;
            if (typeof originalEmit === 'function') {
              response.emit = function(this: unknown, event: string, ...eventArgs: unknown[]) {
                safely(() => {
                  if (event === 'data' && capturedBytes < limit) {
                    const value = eventArgs[0];
                    const chunk = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value as Uint8Array);
                    const remaining = limit - capturedBytes;
                    chunks.push(chunk.subarray(0, remaining));
                    capturedBytes += Math.min(chunk.length, remaining);
                    if (chunk.length > remaining) truncated = true;
                  } else if (event === 'data') {
                    truncated = true;
                  } else if (event === 'end') {
                    const body = Buffer.concat(chunks).toString('utf8');
                    send('http.response.body', {requestId, body, truncated});
                    response.emit = originalEmit;
                  } else if (event === 'aborted') {
                    response.emit = originalEmit;
                  }
                });
                return originalEmit.call(this, event, ...eventArgs);
              };
            }
            response.once?.('end', () => send('http.request.completed', {requestId, duration: Date.now() - started}));
            response.once?.('aborted', () => send('http.request.failed', {requestId, duration: Date.now() - started, error: 'Response aborted'}));
          });
          request.once?.('error', (error: unknown) => {
            emitRequestStarted();
            send('http.request.failed', {requestId, duration: Date.now() - started, error: safeValue(error)});
          });
        });
        return request;
      } as typeof transport.request;
      const wrappedGet = function(this: unknown, ...args: any[]) {
        const request = wrappedRequest.apply(this, args as any);
        request.end();
        return request;
      } as typeof transport.get;

      transport.request = wrappedRequest;
      transport.get = wrappedGet;
      cleanups.push(() => {
        if (transport.request === wrappedRequest) transport.request = originalRequest;
        if (transport.get === wrappedGet) transport.get = originalGet;
      });
    }
  };

  const instrumentWebSocket = () => {
    const OriginalWebSocket = globalThis.WebSocket;
    if (!OriginalWebSocket) return;
    const InstrumentedWebSocket = new Proxy(OriginalWebSocket, {
      construct(Target, args: ConstructorParameters<typeof WebSocket>) {
        const url = String(args[0]);
        const instance = Reflect.construct(Target, args) as WebSocket;
        // 排除 Reporter 传输连接，防止自观察形成递归事件。
        if (url === options.endpoint) return instance;
        safely(() => {
          const socketId = id('socket');
          send('websocket.created', {socketId, url});
          instance.addEventListener('open', () => send('websocket.opened', {socketId, url}));
          instance.addEventListener('message', event => send('websocket.frameReceived', {socketId, data: safeValue(event.data)}));
          instance.addEventListener('error', () => send('websocket.error', {socketId}));
          instance.addEventListener('close', event => send('websocket.closed', {socketId, code: event.code, reason: event.reason}));
          const originalSend = instance.send.bind(instance);
          instance.send = data => { send('websocket.frameSent', {socketId, data: safeValue(data)}); originalSend(data); };
        });
        return instance;
      },
    });
    globalThis.WebSocket = InstrumentedWebSocket;
    cleanups.push(() => { globalThis.WebSocket = OriginalWebSocket; });
  };

  const ensureObservedSocket = (instance: NodeWebSocketLike, metadata: ObserveWebSocketOptions = {}) => {
    const key = instance as object;
    const existing = observedSockets.get(key);
    if (existing) return existing;
    const state = {
      socketId: id('socket'),
      url: metadata.url ?? String(instance.url ?? 'ws://unknown'),
      opened: false,
      direction: metadata.direction ?? ('client' as const),
    };
    observedSockets.set(key, state);
    if (state.url !== options.endpoint) send('websocket.created', {socketId: state.socketId, url: state.url, direction: state.direction});
    return state;
  };

  const emitNodeWebSocketEvent = (instance: NodeWebSocketLike, event: string, args: any[], metadata?: ObserveWebSocketOptions) => {
    const state = ensureObservedSocket(instance, metadata);
    if (state.url === options.endpoint) return;
    if (event === 'open' && !state.opened) {
      state.opened = true;
      send('websocket.opened', {socketId: state.socketId, url: state.url, direction: state.direction});
    } else if (event === 'message') {
      send('websocket.frameReceived', {socketId: state.socketId, data: safeValue(args[0]), direction: state.direction});
    } else if (event === 'error') {
      send('websocket.error', {socketId: state.socketId, error: safeValue(args[0]), direction: state.direction});
    } else if (event === 'close') {
      send('websocket.closed', {socketId: state.socketId, code: args[0], reason: safeValue(args[1]), direction: state.direction});
    }
  };

  const instrumentNodeWebSocketConstructor = (Constructor: NodeWebSocketConstructor) => {
    const prototype = Constructor?.prototype;
    if (!prototype || instrumentedPrototypes.has(prototype)) return;
    instrumentedPrototypes.add(prototype);
    const originalSend = prototype.send;
    const originalEmit = prototype.emit;

    prototype.send = function(this: NodeWebSocketLike, data: unknown, ...args: any[]) {
      safely(() => {
        const state = ensureObservedSocket(this);
        if (state.url !== options.endpoint) send('websocket.frameSent', {socketId: state.socketId, data: safeValue(data), direction: state.direction});
      });
      return originalSend.call(this, data, ...args);
    };
    if (originalEmit) {
      prototype.emit = function(this: NodeWebSocketLike, event: string, ...args: any[]) {
        safely(() => emitNodeWebSocketEvent(this, event, args));
        return originalEmit.call(this, event, ...args);
      };
    }
    cleanups.push(() => {
      if (prototype.send !== originalSend) prototype.send = originalSend;
      if (originalEmit && prototype.emit !== originalEmit) prototype.emit = originalEmit;
      instrumentedPrototypes.delete(prototype);
    });
  };

  const observeWebSocket = (instance: NodeWebSocketLike, metadata: ObserveWebSocketOptions = {}) => {
    const state = ensureObservedSocket(instance, {...metadata, direction: metadata.direction ?? 'server'});
    if (state.url !== options.endpoint && !state.opened) {
      state.opened = true;
      send('websocket.opened', {socketId: state.socketId, url: state.url, direction: state.direction});
    }
    // A registered constructor already intercepts this instance through its
    // prototype. Explicit observation only supplies server metadata/open state.
    if (instrumentedPrototypes.has(Object.getPrototypeOf(instance))) return () => undefined;
    const listeners: Array<[string, (...args: any[]) => void]> = [];
    for (const event of ['message', 'error', 'close']) {
      const listener = (...args: any[]) => emitNodeWebSocketEvent(instance, event, args, metadata);
      instance.on?.(event, listener);
      listeners.push([event, listener]);
    }
    const originalSend = instance.send;
    instance.send = function(data: unknown, ...args: any[]) {
      safely(() => {
        if (state.url !== options.endpoint) send('websocket.frameSent', {socketId: state.socketId, data: safeValue(data), direction: state.direction});
      });
      return originalSend.call(this, data, ...args);
    };
    const cleanup = () => {
      for (const [event, listener] of listeners) {
        if (instance.off) instance.off(event, listener);
        else instance.removeListener?.(event, listener);
      }
      if (instance.send !== originalSend) instance.send = originalSend;
    };
    cleanups.push(cleanup);
    return cleanup;
  };

  return {
    report,
    reportConsole: event => report('console.entry', event),
    reportHttpRequestStarted: event => report('http.request.started', event),
    reportHttpResponseReceived: event => report('http.response.received', event),
    reportHttpResponseBody: event => report('http.response.body', event),
    reportHttpRequestCompleted: event => report('http.request.completed', event),
    reportHttpRequestFailed: event => report('http.request.failed', event),
    reportWebSocketCreated: event => report('websocket.created', event),
    reportWebSocketOpened: event => report('websocket.opened', event),
    reportWebSocketFrameSent: event => report('websocket.frameSent', event),
    reportWebSocketFrameReceived: event => report('websocket.frameReceived', event),
    reportWebSocketClosed: event => report('websocket.closed', event),
    reportWebSocketError: event => report('websocket.error', event),
    start() {
      if (!stopped) return;
      stopped = false;
      if (captureEnabled('console')) safely(instrumentConsole);
      if (captureEnabled('fetch')) safely(instrumentFetch);
      if (captureEnabled('nodeHttp')) safely(instrumentNodeHttp);
      if (captureEnabled('websocket')) {
        safely(instrumentWebSocket);
        options.webSocketConstructors?.forEach(Constructor => safely(() => instrumentNodeWebSocketConstructor(Constructor)));
      }
      safely(connect);
    },
    stop() {
      stopped = true;
      safely(() => { if (reconnectTimer) clearTimeout(reconnectTimer); });
      safely(() => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
      safely(() => socket?.close());
      cleanups.splice(0).reverse().forEach(cleanup => safely(cleanup));
    },
    observeWebSocket(instance, metadata) {
      return safely(() => observeWebSocket(instance, metadata)) ?? (() => undefined);
    },
  };
}
