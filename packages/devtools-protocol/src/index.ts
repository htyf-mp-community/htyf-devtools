/** 当前 Reporter 与 Desktop 之间的线协议版本。版本不匹配时连接会被拒绝。 */
export const PROTOCOL_VERSION = 1 as const;

export type RuntimePlatform = 'react-native' | 'electron-main' | 'web';
export type ConsoleLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

/** Reporter 自动上报自身包名和版本；兼容规则完全由 Desktop 维护。 */
export interface ReporterVersionInfo {
  packageName: '@htyf-mp/devtools-react-native' | '@htyf-mp/devtools-electron' | '@htyf-mp/devtools-web';
  version: string;
}

/** Reporter 首次连接时声明的 Runtime 身份与能力。 */
export interface RuntimeInfo {
  runtimeId: string;
  deviceId: string;
  appId: string;
  appName: string;
  appVersion?: string;
  platform: RuntimePlatform;
  os?: string;
  deviceName?: string;
  capabilities: Array<'console' | 'http' | 'websocket'>;
  reporter?: ReporterVersionInfo;
}

/**
 * Reporter 上行消息的统一信封。
 * sequence 在单个 Reporter 生命周期内单调递增，timestamp 使用 Unix 毫秒。
 */
export interface ReporterEnvelope<T = unknown> {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  type: string;
  timestamp: number;
  runtimeId: string;
  sequence: number;
  payload: T;
}

/** WebSocket 建连后的第一条消息，也是 Desktop 建立 Runtime 的唯一入口。 */
export interface RuntimeHello extends ReporterEnvelope<RuntimeInfo & { token?: string }> {
  type: 'runtime.hello';
}

/** console 方法调用在传输前经过安全序列化后的数据。 */
export interface ConsoleEntry {
  level: ConsoleLevel;
  arguments: unknown[];
  stack?: string;
}

/** HTTP 请求开始事件；body 只记录可安全表示的文本请求体。 */
export interface HttpRequestStarted {
  requestId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
}

/** HTTP 响应头已可用，不代表响应体已经读取完成。 */
export interface HttpResponseReceived {
  requestId: string;
  url: string;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  mimeType?: string;
}

export interface HttpResponseBody {
  requestId: string;
  body: string;
  truncated?: boolean;
}

export interface HttpRequestCompleted {
  requestId: string;
  /** 耗时，单位毫秒。 */
  duration?: number;
  size?: number;
}

export interface HttpRequestFailed {
  requestId: string;
  error: unknown;
  duration?: number;
  canceled?: boolean;
}

export interface WebSocketCreated {
  socketId: string;
  url: string;
  direction?: 'client' | 'server';
}

export interface WebSocketOpened extends WebSocketCreated {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface WebSocketFrame {
  socketId: string;
  data: unknown;
  direction?: 'client' | 'server';
}

export interface WebSocketClosed {
  socketId: string;
  code?: number;
  reason?: string;
  direction?: 'client' | 'server';
}

export interface WebSocketError {
  socketId: string;
  error?: unknown;
  direction?: 'client' | 'server';
}

/** 可手动上报的业务事件；运行时握手和心跳由 Reporter 管理。 */
export interface ReportEventMap {
  'console.entry': ConsoleEntry;
  'http.request.started': HttpRequestStarted;
  'http.response.received': HttpResponseReceived;
  'http.response.body': HttpResponseBody;
  'http.request.completed': HttpRequestCompleted;
  'http.request.failed': HttpRequestFailed;
  'websocket.created': WebSocketCreated;
  'websocket.opened': WebSocketOpened;
  'websocket.frameSent': WebSocketFrame;
  'websocket.frameReceived': WebSocketFrame;
  'websocket.closed': WebSocketClosed;
  'websocket.error': WebSocketError;
}

/** 方法可解构后用于二次封装。需先 start；stop 后调用会被忽略。 */
export interface ManualReporter {
  report<K extends keyof ReportEventMap>(type: K, payload: ReportEventMap[K]): void;
  reportConsole(entry: ConsoleEntry): void;
  reportHttpRequestStarted(event: HttpRequestStarted): void;
  reportHttpResponseReceived(event: HttpResponseReceived): void;
  reportHttpResponseBody(event: HttpResponseBody): void;
  reportHttpRequestCompleted(event: HttpRequestCompleted): void;
  reportHttpRequestFailed(event: HttpRequestFailed): void;
  reportWebSocketCreated(event: WebSocketCreated): void;
  reportWebSocketOpened(event: WebSocketOpened): void;
  reportWebSocketFrameSent(event: WebSocketFrame): void;
  reportWebSocketFrameReceived(event: WebSocketFrame): void;
  reportWebSocketClosed(event: WebSocketClosed): void;
  reportWebSocketError(event: WebSocketError): void;
}
