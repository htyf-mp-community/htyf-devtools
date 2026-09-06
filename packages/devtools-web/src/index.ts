import {
  createDevToolsWithIdentity,
  REPORTER_VERSION,
  type DevToolsOptions,
  type DevToolsReporter,
} from '@htyf-mp/devtools-react-native';

/** 浏览器 Reporter 配置。endpoint 和 token 可从 Desktop Welcome 页获得。 */
export type WebDevToolsOptions = DevToolsOptions;

/** start/stop 幂等；停止后会恢复全部被包装的浏览器 API。 */
export type WebDevToolsReporter = DevToolsReporter;

/**
 * 创建浏览器调试 Reporter。
 *
 * Reporter 只做旁路观测；内部连接或序列化失败不会影响页面的 Console、
 * Fetch、XMLHttpRequest 和 WebSocket 正常执行。
 */
export function createWebDevTools(options: WebDevToolsOptions): WebDevToolsReporter {
  return createDevToolsWithIdentity(options, {
    platform: 'web',
    reporter: {
      packageName: '@htyf-mp/devtools-web',
      version: REPORTER_VERSION,
    },
  });
}

export type {
  ConsoleLevel, ConsoleEntry, HttpRequestStarted, HttpResponseReceived,
  HttpResponseBody, HttpRequestCompleted, HttpRequestFailed,
  WebSocketCreated, WebSocketOpened, WebSocketFrame, WebSocketClosed,
  WebSocketError, ReportEventMap, ManualReporter,
} from '@htyf-mp/devtools-react-native';
