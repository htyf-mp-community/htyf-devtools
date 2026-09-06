# @htyf-mp/devtools-desktop

红糖开发助手桌面客户端。它在 Electron 中运行定制的 DevTools Frontend，同时启动 HTTP/WebSocket 服务，把 HTYF Reporter 协议转换为 Chrome DevTools Protocol（CDP）。

## 架构

```text
React Native / Electron Main
          │ Reporter WebSocket
          ▼
  红糖云服 DevTools Server
          │ 协议转换与事件缓存
          ▼
 Chrome DevTools Protocol
          │
          ▼
React Native DevTools Frontend
```

Desktop 内部包含四个主要模块：

- `main.cjs`：Electron 生命周期、窗口、Runtime 菜单和优雅退出；
- `server.cjs`：HTTP、Reporter WebSocket、CDP WebSocket、鉴权和事件转换；
- `htyf-welcome.js`：向上游 Welcome 页面注入连接 URL、token 和二维码；
- `demo-runtime.cjs`：通过正式 Reporter 协议生成验收数据。

## 启动

```bash
pnpm --filter @htyf-mp/devtools-desktop start
```

也可以从仓库根目录启动：

```bash
pnpm devtools
pnpm devtools:background
pnpm devtools:demo
pnpm devtools:demo:background
pnpm devtools:inspect
pnpm devtools:lan
pnpm devtools:pack
pnpm devtools:test
```

`devtools` 和 `devtools:demo` 默认以前台方式运行，便于直接查看服务、Frontend 和自动更新日志；`Ctrl+C` 会优雅关闭服务。需要脱离终端运行时使用对应的 `:background` 命令。`devtools:inspect` 会开启主进程 `9229` 调试端口，可用 Chrome DevTools 或编辑器附加调试。

默认监听：

```text
HTTP/CDP: http://<当前电脑局域网 IP>:17654
Reporter: ws://<当前电脑局域网 IP>:17654/reporter
```

客户端通过 `systeminformation.networkInterfaces()` 自动选择默认实体网卡 IPv4，不再生成 `127.0.0.1` 地址。
默认绑定 `0.0.0.0`，因此自动启用配对 token。从 Welcome 页面复制配置，或扫描包含 `endpoint + token` 的二维码。

首个 Reporter 连接后，窗口会自动从 Welcome 切换到对应的 React Native DevTools Frontend。
桌面端会向 Reporter 下发心跳周期；连接在默认 45 秒内没有任何消息时会被主动断开，并在 Runtime 菜单中显示为离线。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTYF_DEVTOOLS_HOST` | `0.0.0.0` | HTTP/WebSocket 监听地址 |
| `HTYF_DEVTOOLS_PORT` | `17654` | 服务端口；`0` 表示自动分配空闲端口 |
| `HTYF_DEVTOOLS_DEMO` | 未设置 | 为 `1` 时自动启动内置 Demo Runtime |

监听地址与展示地址是分离的：服务监听 `0.0.0.0`，Welcome 和二维码展示 `systeminformation` 选出的当前电脑实体网卡 IPv4。
指定端口被占用时，Desktop 使用 `portfinder` 自动在后续 100 个端口内选择可用端口；最终端口会同步用于 Welcome、二维码和复制配置。

## 调试面板

- Console：保留日志级别，对象和数组使用 CDP RemoteObject，可逐层展开；
- Network：显示 Fetch/XHR 请求、响应状态、Header、耗时和文本 Response；
- Network / WS：显示 WebSocket 生命周期以及发送、接收帧；
- Runtime 菜单：在多个 RN 或 Electron Runtime 之间切换。

React Native、Electron 和 Web Reporter 建连时会自动上报自身 `packageName` 与 `version`。兼容范围由 Desktop 的 `src/reporter-compatibility.json` 统一维护和判断，Reporter 不能自行声明兼容；未知包、缺失版本或超出支持区间时，Desktop 会显示版本提示，但不会拒绝连接或影响业务运行。

Reporter 通常早于 DevTools Frontend 连接。Desktop 会为每个 Runtime 缓存最近 5,000 条事件，并在对应 CDP Domain 启用后回放。

## 内置 Demo

无需启动 RN 或其他 Electron 应用即可验证完整链路：

```bash
pnpm devtools:demo
```

客户端会自动连接 `红糖云服调试 Demo` Runtime，并持续生成 Console、HTTP 和 WebSocket 示例事件。也可以在应用菜单 `Demo` 中启动、停止或手动生成一组事件，快捷键为 `Cmd/Ctrl + Shift + D`。
Demo 命令会自动选择空闲端口，因此可以与正在运行的普通 DevTools 实例并存；请确认窗口标题以 `红糖开发助手` 开头。

Demo 每三秒产生一组 Console、HTTP 和 WebSocket 事件。菜单 `Demo → Generate Sample Events` 可立即产生一组数据。

## 打包

### 最新包下载地址

- macOS Universal：[下载 latest.dmg](https://dagouzhi.oss-cn-qingdao.aliyuncs.com/com.dagouzhi.mp.devtools/latest/mac/universal/latest.dmg)
- Windows x64：[下载 latest.exe](https://dagouzhi.oss-cn-qingdao.aliyuncs.com/com.dagouzhi.mp.devtools/latest/win/x64/latest.exe)

生成当前平台的未签名应用目录，用于本地验证：

```bash
pnpm devtools:pack
```

生成未签名的 macOS 或 Windows 分发包：

```bash
pnpm devtools:dist:mac
pnpm devtools:dist:win
```

macOS 命令生成一个同时包含 Intel (`x64`) 与 Apple Silicon (`arm64`) 原生切片的 universal DMG/ZIP；Windows 命令为 `x64` 生成可选择安装目录的 NSIS 安装包和免安装 ZIP。Windows 安装包固定为所有用户安装，不再显示“所有用户/当前用户”选择页；安装时会按 Windows 规范请求管理员权限，安装后的应用本身仍以普通用户权限运行。产物按版本、系统和架构存放在 `app/release/v${version}/${os}/${arch}`：

```text
v0.1.0/mac/universal/latest.dmg
v0.1.0/mac/universal/latest.zip
v0.1.0/win/x64/latest.exe
v0.1.0/win/x64/latest.zip
```

`dist:*` 明确关闭证书自动发现，适合本地测试和内部分发。默认更新目录为：

```text
https://dagouzhi.oss-cn-qingdao.aliyuncs.com/com.dagouzhi.mp.devtools/latest/
```

需要使用其他更新服务时，可在构建时通过环境变量覆盖：

```bash
HTYF_DEVTOOLS_UPDATE_URL=https://download.example.com/devtools pnpm devtools:release:mac
HTYF_DEVTOOLS_UPDATE_URL=https://download.example.com/devtools pnpm devtools:release:win
```

签名构建由 electron-builder 读取标准签名配置：macOS 可使用钥匙串中的 Developer ID Application 证书，或配置 `CSC_LINK`、`CSC_KEY_PASSWORD`；Windows 可配置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。Apple 公证仍需在发布 CI 中配置 Apple 账号或 App Store Connect API Key。不要把证书、密码或 API Key 写进仓库。

Windows 安装包通常可以在 macOS CI 上交叉构建；macOS 应用必须在 macOS 上完成签名与公证。建议发布流水线分别使用 macOS runner 和 Windows runner 验证最终产物。

## 自动更新

正式发布时，electron-builder 默认把 COS 地址写入 generic provider 配置，并生成 Windows `latest.yml` 与 macOS `latest-mac.yml`；`HTYF_DEVTOOLS_UPDATE_URL` 可以覆盖默认值。将安装包、ZIP、blockmap 和对应 YAML 原样上传到更新目录即可。

应用启动 3 秒后检查一次，之后每 4 小时检查；更新在后台下载，完成后提示立即重启或退出时安装。菜单 `Help → 检查更新…` 支持手动检查。更新服务不可用时会安静失败，不影响调试服务。

开发环境默认不检查更新。如需联调更新服务器：

```bash
HTYF_DEVTOOLS_AUTO_UPDATE=1 \
HTYF_DEVTOOLS_UPDATE_URL=http://127.0.0.1:8080 \
pnpm devtools
```

macOS 自动更新要求应用完成代码签名；Windows 自动更新使用 NSIS 安装目标。生产更新地址应使用 HTTPS。

## 用户级系统环境变量

菜单 `红糖开发助手 → 系统环境变量…` 可以读取和修改以下用户级环境变量：

- `HTYF_DEVTOOLS_ENDPOINT`
- `HTYF_DEVTOOLS_TOKEN`
- `HTYF_DEVTOOLS_ENABLED`
- `HTYF_DEVTOOLS_AUTO_UPDATE`
- `HTYF_DEVTOOLS_UPDATE_URL`

内置白名单和页面说明统一配置在 `src/environment-variables.json`。配置页底部的“添加环境变量”可以动态扩展当前用户的白名单，自定义项保存在应用用户数据目录的 `environment-variables.user.json`，升级应用后仍会保留。变量名会规范为大写，只允许字母、数字和下划线，且不能以数字开头；主进程仍会拒绝内置与用户白名单之外的读写请求。

桌面端只允许修改上述白名单，不会枚举或展示其他敏感环境变量。空字符串是有效值，取消勾选才表示删除变量。

Windows 使用当前用户的 `HKCU\\Environment`，修改后会广播环境变化。macOS 使用当前登录用户的 `launchctl` 和 `~/Library/LaunchAgents` 持久化。卸载应用不会修改或恢复已经保存的环境变量。

环境变量只对修改后新启动的应用生效。保存或恢复后，请完全退出并重新启动需要读取这些变量的业务应用。`HTYF_DEVTOOLS_TOKEN` 可能属于敏感凭证，请勿在公共设备上保留。

打包时会先执行 `prepare-frontend`：复制固定版本的 `@react-native/debugger-frontend` 到 `frontend-dist`，再注入 HTYF Welcome 脚本。不会直接修改 `node_modules`。

## 安全

- LAN 监听默认要求随机配对 token；
- token 使用常量时间比较，只在本机 Welcome/IPC 状态中返回；
- token 不写入 Runtime 状态或事件缓存；
- Reporter 单条消息最大 1 MiB，CDP 单条消息最大 256 KiB；
- 静态文件路径经过目录约束，禁止访问 `frontend-dist` 之外的文件；
- 当前传输是局域网明文 `ws://`，不要在不可信网络中使用。

## 故障排查

### Reporter 无法连接

确认设备与电脑网络互通，并使用 Welcome 页面显示的 IP、端口和 token。切换 Wi-Fi 后请重新启动 Desktop 获取新地址。
Windows 如果把物理网卡标记为虚拟适配器，Desktop 仍会按默认路由选择可用局域网 IPv4；完全没有可用局域网时会降级为 `localhost` 模式打开界面，而不会退出，此时真机 Reporter 需等电脑接入局域网后重启 Desktop。

Windows 首次监听局域网端口时，系统可能询问是否允许网络访问，请只勾选“专用网络”并点击“允许”。红糖开发助手不会主动查询或修改 Windows 防火墙规则；Welcome 页面只提供连接排查文案，因此权限检查不会影响应用启动。

### Console 或 Network 没有数据

确认窗口标题对应正确 Runtime，并在 `Runtime` 菜单中检查连接状态。可以运行 `pnpm devtools:demo` 区分 Desktop 问题与业务 Reporter 接入问题。

### 端口被占用

Desktop 会从配置端口开始自动寻找可用端口，无需手动关闭旧实例；最终使用的端口以 Welcome 页面显示为准。

### 前台退出显示 SIGINT

前台开发命令按 `Ctrl+C` 会执行优雅退出；后台命令直接关闭应用窗口即可。

## 开发验证

```bash
pnpm devtools:build
pnpm devtools:test
pnpm devtools:pack
```

桌面测试覆盖目标发现、CDP 转换、事件回放、Response body、RemoteObject 展开、二维码、协议鉴权、心跳失联和内置 Demo。

## 当前能力

- Welcome、连接 URL 和二维码；
- Runtime 自动发现；
- React Native DevTools Frontend；
- Console 到 `Runtime.consoleAPICalled`；
- HTTP 到 CDP Network 生命周期；
- WebSocket Frame 到 CDP Network WebSocket 事件；
- Runtime 心跳、失联检测和在线状态更新。
