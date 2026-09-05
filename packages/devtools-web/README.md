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
