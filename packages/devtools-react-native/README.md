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
