# @htyf-mp/devtools-web

红糖云服 App 调试工具的浏览器端 Reporter。支持采集 Console、Fetch、XMLHttpRequest 和 WebSocket，并通过 WebSocket 上报到 Desktop。

浏览器版 Axios 默认使用 `XMLHttpRequest` adapter，已由 Reporter 底层统一采集，无需修改 Axios 实例或添加 interceptor。

## 安装

```bash
pnpm add @htyf-mp/devtools-web @htyf-mp/devtools-protocol
```

## 使用

建议只在开发环境启用：

```ts
import {createWebDevTools} from '@htyf-mp/devtools-web';

const reporter = createWebDevTools({
  endpoint: 'ws://192.168.1.10:17654/reporter',
  token: '123456',
  app: {
    appId: 'htyf-web-demo',
    appName: '红糖云服 Web Demo',
    appVersion: '1.0.0',
  },
});

reporter.start();

// 热更新卸载或应用退出时恢复所有全局 API。
reporter.stop();
```

通过 `capture` 控制采集项；未配置的项目默认开启：

```ts
createWebDevTools({
  endpoint,
  token,
  app,
  capture: {console: true, fetch: true, xhr: true, websocket: true},
});
```

Reporter 严格遵循旁路原则：上报服务不可用、数据无法序列化或插件自身发生异常时，不会改变业务 API 的返回结果和异常语义。离线事件队列最多保存 2000 条，响应体默认最多采集 1 MB。

连接时会自动上报 Web 插件版本和支持的 Desktop 版本范围；Desktop 会展示兼容状态，版本不匹配不会阻断页面请求。

## 自定义采集与手动上报

三个插件提供相同的手动上报 API，并从包入口导出 `ManualReporter`、`ReportEventMap` 和各事件 payload 类型。
`capture: false` 关闭全部自动采集；也可以逐项关闭对应采集器，避免与自定义采集重复上报。

```ts
import {createWebDevTools} from '@htyf-mp/devtools-web';

const reporter = createWebDevTools({
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
