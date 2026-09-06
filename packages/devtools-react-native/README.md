# @htyf-mp/devtools-react-native

React Native 开发环境 Reporter。它包装 Console、Fetch、XMLHttpRequest 和 WebSocket，将事件发送到 HTYF DevTools Desktop。

Axios 在 React Native 中通常使用 `XMLHttpRequest` adapter，默认已被统一采集，不需要为 Axios 单独安装拦截器。

## 安装

```bash
pnpm add -D @htyf-mp/devtools-react-native @htyf-mp/devtools-protocol
```

`@htyf-mp/devtools-protocol` 是 Reporter 与 Desktop 共用的线协议 peer dependency；应用需要显式安装，以保证双方使用兼容的协议版本。

## 接入

从 Desktop Welcome 页面复制 `endpoint` 和 `token`：

```ts
import {createDevTools} from '@htyf-mp/devtools-react-native';

const reporter = __DEV__ ? createDevTools({
  endpoint: 'ws://192.168.199.174:17654/reporter',
  token: 'welcome-page-token',
  app: {
    appId: 'com.example.app',
    appName: 'Example App',
    appVersion: '1.0.0',
    deviceName: 'iPhone',
    os: 'ios',
  },
}) : undefined;

reporter?.start();
```

`start()` 和 `stop()` 均为幂等操作。`stop()` 会关闭连接、清除定时器并恢复所有被包装的全局方法。

Reporter 遵循严格的旁路原则：连接、序列化、发送、响应体检查或清理失败都会在包内部被隔离，不会改变业务 Console、Fetch、XHR 或 WebSocket 的返回值与异常语义。

连接时会自动上报插件版本和支持的 Desktop 版本范围，由 Desktop 展示兼容状态；版本不匹配不会影响应用正常运行。

## 配置

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `endpoint` | 是 | Welcome 页面显示的 Reporter WebSocket URL |
| `token` | LAN 模式 | Welcome 页面显示的临时配对凭据 |
| `app.appId` | 是 | 稳定应用标识 |
| `app.appName` | 是 | Runtime 菜单显示名称 |
| `app.appVersion` | 否 | 应用版本 |
| `app.deviceId` | 否 | 未指定时自动生成 |
| `capture` | 否 | 分别控制 console/fetch/xhr/websocket；未配置项默认开启 |
| `maxBodyBytes` | 否 | 单个响应体最大字符数，默认 1,000,000 |

## 运行特性

- 离线最多缓存最近 2,000 条事件；
- 500ms 起步指数退避重连，最大 10 秒；
- 按 Desktop 下发周期发送心跳；
- Console 参数限制为 4 层、每层最多 100 个属性；
- Fetch 使用 `response.clone()`，不会消费业务响应体；
- 自动排除 Reporter 自己的 WebSocket，避免递归采集。

## 限制与安全

- 只应在 `__DEV__` 条件内启用；
- 设备必须能访问 Desktop 显示的电脑局域网 IP；
- iOS/Android 如限制明文流量，需要在开发配置中允许局域网 `ws://`；
- 当前不采集二进制请求体和响应体；
- 日志和响应体可能含敏感数据，避免连接不可信的 Desktop。

## 开发验证

```bash
pnpm --filter @htyf-mp/devtools-react-native type-check
pnpm --filter @htyf-mp/devtools-react-native test
pnpm --filter @htyf-mp/devtools-react-native build
```

## 自定义采集与手动上报

三个插件提供相同的手动上报 API，并从包入口导出 `ManualReporter`、`ReportEventMap` 和各事件 payload 类型。
`capture: false` 关闭全部自动采集；也可以逐项关闭对应采集器，避免与自定义采集重复上报。

```ts
import {createDevTools} from '@htyf-mp/devtools-react-native';

const reporter = createDevTools({
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
