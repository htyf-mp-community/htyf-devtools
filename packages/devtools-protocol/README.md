# @htyf-mp/devtools-protocol

HTYF DevTools 的共享 TypeScript 协议类型。该包不依赖 Node、Electron 或 React Native；三个运行时模块必须使用同一个 `PROTOCOL_VERSION`。

## 职责

- 定义 Runtime 身份、能力和平台；
- 定义 Reporter 上行消息信封；
- 定义 Console、HTTP 等基础 payload；
- 提供编译期约束，不包含网络连接或运行时代码。

## 消息信封

```ts
interface ReporterEnvelope<T = unknown> {
  protocolVersion: 1;
  id: string;
  type: string;
  timestamp: number; // Unix 毫秒
  runtimeId: string;
  sequence: number;  // 单个 Reporter 生命周期内递增
  payload: T;
}
```

Reporter 建立 WebSocket 后必须首先发送 `runtime.hello`。Desktop 会校验协议版本、Runtime 信息和配对 token。

`runtime.hello.payload.reporter` 同时携带插件包名、插件版本，以及支持的 Desktop 半开版本区间。Desktop 会显示兼容状态；缺少版本信息或版本不匹配只产生提示，不会中断应用连接。

## 事件一览

| 事件 | 说明 |
| --- | --- |
| `runtime.hello` / `runtime.heartbeat` | Runtime 注册与保活 |
| `console.entry` | Console 方法调用 |
| `http.request.started` | HTTP 请求开始 |
| `http.response.received` / `http.response.body` | HTTP 响应与正文 |
| `http.request.completed` / `http.request.failed` | HTTP 结束状态 |
| `websocket.created` / `opened` | WebSocket 生命周期 |
| `websocket.frameSent` / `frameReceived` | WebSocket 帧 |
| `websocket.closed` / `error` | WebSocket 关闭或异常 |

## 版本策略

破坏消息结构或语义时升级 `PROTOCOL_VERSION`；新增可选字段或 Desktop 可忽略的新事件可以保持当前版本。Desktop 会拒绝未知的未来版本，避免静默产生错误调试结果。

## 开发

```bash
pnpm --filter @htyf-mp/devtools-protocol type-check
pnpm --filter @htyf-mp/devtools-protocol build
pnpm --filter @htyf-mp/devtools-protocol pack --dry-run
```
