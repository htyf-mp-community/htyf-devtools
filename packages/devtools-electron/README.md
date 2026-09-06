# @htyf-mp/devtools-electron

Electron 主进程开发环境 Reporter。它不依赖 renderer 或 IPC，直接采集主进程 Console、Fetch、Node HTTP/HTTPS 和 WebSocket。Axios、got 及多数 Node SDK 最终使用的 `http.request`/`https.request` 默认会被统一采集。

## 安装

```bash
pnpm add -D @htyf-mp/devtools-electron
```

## 接入

从 Desktop Welcome 页面复制 `endpoint` 和 `token`：

```ts
import {app} from 'electron';
import {createElectronDevTools} from '@htyf-mp/devtools-electron';

if (!app.isPackaged) {
  createElectronDevTools({
    endpoint: 'ws://192.168.199.174:17654/reporter',
    token: 'welcome-page-token',
    app: {
      appId: 'com.example.desktop',
      appName: 'Example Desktop',
      appVersion: app.getVersion(),
      deviceName: 'Main Process',
    },
  }).start();
}
```

仅应在开发环境启用。正式发布应用中建议使用 `app.isPackaged` 或项目自身的开发开关排除 Reporter。

Reporter 是旁路诊断模块。其连接、序列化、传输、响应检查、第三方 `ws` 适配或清理错误均在内部隔离，不会因为 Desktop 离线或 Reporter 自身故障中断业务调用。

连接时会自动上报当前插件版本及支持的 Desktop 版本范围，Desktop 会在窗口标题和 Runtime 菜单显示兼容状态；不匹配时仅提示，不阻断调试或业务。

## 配置

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `endpoint` | 是 | Desktop Reporter WebSocket URL |
| `token` | LAN 模式 | Desktop 临时配对凭据 |
| `app.appId` | 是 | Electron 应用稳定标识 |
| `app.appName` | 是 | Runtime 菜单显示名称 |
| `app.appVersion` | 否 | 可使用 `app.getVersion()` |
| `capture` | 否 | 分别控制 console/fetch/nodeHttp/websocket；未配置项默认开启 |
| `maxBodyBytes` | 否 | 文本响应体最大字符数，默认 1,000,000 |

## 运行特性

- Runtime 平台固定标记为 `electron-main`；
- 离线最多缓存最近 2,000 条事件；
- 500ms 至 10 秒指数退避重连；
- 按 Desktop 下发周期发送心跳；
- Fetch 通过 clone 异步读取正文；
- `stop()` 恢复 Console、Fetch、Node HTTP/HTTPS 和 WebSocket。

## 监控第三方 `ws`

全局 `WebSocket` 与 npm `ws` 是不同的构造器。将项目使用的构造器显式传入，Reporter 会监控该构造器的所有实例：

```ts
import WebSocket, {WebSocketServer} from 'ws';

const reporter = createElectronDevTools({
  endpoint,
  token,
  app: {appId: 'com.example.desktop', appName: 'Example Desktop'},
  webSocketConstructors: [WebSocket],
});
reporter.start();
```

对于 `WebSocketServer` 已接收的连接，也可以显式观察：

```ts
const wss = new WebSocketServer({port: 8080});
wss.on('connection', (socket, request) => {
  reporter.observeWebSocket(socket, {
    url: request.url ?? '/websocket',
    direction: 'server',
  });
});
```

`observeWebSocket` 返回取消观察函数；`reporter.stop()` 也会统一恢复。适配器会采集 created/opened、发送帧、接收帧、error 和 close，不修改 `require.cache`。

## 注意事项

- 默认采集全局 `fetch`、Node `http/https` 和全局 `WebSocket`；Axios 无需额外适配，第三方 `ws` 仍需通过上述接口显式注册；
- Node HTTP 层旁路复制 `write`/`end` 的请求参数，以及 Axios/业务实际消费的响应 chunk；不会抢占或改变业务请求和响应流；
- 日志和响应体可能包含敏感数据，不要连接不可信的 Desktop；
- Reporter 连接自身会被排除，避免递归上报。

## 开发验证

```bash
pnpm --filter @htyf-mp/devtools-electron type-check
pnpm --filter @htyf-mp/devtools-electron test
pnpm --filter @htyf-mp/devtools-electron build
```

## 自定义采集与手动上报

三个插件提供相同的手动上报 API，并从包入口导出 `ManualReporter`、`ReportEventMap` 和各事件 payload 类型。
`capture: false` 关闭全部自动采集；也可以逐项关闭对应采集器，避免与自定义采集重复上报。

```ts
import {createElectronDevTools} from '@htyf-mp/devtools-electron';

const reporter = createElectronDevTools({
  endpoint: 'ws://localhost:17654/reporter',
  app: {appId: 'custom', appName: 'Custom App'},
  capture: false,
});
reporter.start();

// 方法可以解构，接到已有日志库或拦截器中。
const {reportConsole} = reporter;
const log = (...args: unknown[]) => reportConsole({level: 'info', arguments: args});
log('自定义日志', {source: 'business'});

// 同一次请求各阶段使用相同 requestId；不同请求应使用不同 ID。
const requestId = 'request-1';
reporter.reportHttpRequestStarted({requestId, method: 'GET', url: 'https://api.example/items'});
reporter.reportHttpResponseReceived({requestId, url: 'https://api.example/items', status: 200});
reporter.reportHttpResponseBody({requestId, body: '{"items":[]}'});
reporter.reportHttpRequestCompleted({requestId, duration: 120});
// 失败时调用 reportHttpRequestFailed({requestId, error, duration})。

// 同一连接各阶段使用相同 socketId；data 为自行采集的帧内容。
const socketId = 'socket-1';
reporter.reportWebSocketCreated({socketId, url: 'wss://api.example/socket'});
reporter.reportWebSocketOpened({socketId, url: 'wss://api.example/socket'});
reporter.reportWebSocketFrameSent({socketId, data: 'ping'});
reporter.reportWebSocketFrameReceived({socketId, data: 'pong'});
reporter.reportWebSocketClosed({socketId, code: 1000, reason: 'done'});
// 异常时调用 reportWebSocketError({socketId, error})。

// 通用原始事件入口：事件名和 payload 有对应的 TypeScript 约束。
reporter.report('console.entry', {level: 'warn', arguments: ['自定义封装']});
```

手动方法只上报，不执行实际日志输出、HTTP 请求或 WebSocket 操作。调用前需 `start()`；
启动后尚未连接时复用最近 2,000 条事件的离线队列，未启动或 `stop()` 后的手动调用会被忽略。
协议版本、事件 ID、运行时 ID、时间戳及序号由插件填充，握手和心跳由插件管理。
日志参数、错误和帧数据经过安全序列化；HTTP 文本正文按 `maxBodyBytes` 截断（当前按字符数计）。
手动上报不受 `capture` 开关影响，三类能力始终会在握手时声明。
