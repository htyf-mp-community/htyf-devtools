# 红糖开发助手

红糖开发助手独立 monorepo，使用 pnpm workspace 与 Lerna 管理。

## 目录结构

```text
htyf-devtools/
├── app/                       # Electron 桌面端
├── packages/
│   ├── devtools-protocol/     # Reporter 通信协议
│   ├── devtools-react-native/ # React Native Reporter
│   ├── devtools-web/          # Web Reporter
│   └── devtools-electron/     # Electron 主进程 Reporter
├── lerna.json
└── pnpm-workspace.yaml
```

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm dev
```

运行带示例数据的桌面端：

```bash
pnpm dev:demo
```

## 发布 npm 包

使用 Lerna 的 independent 模式管理四个 Reporter/协议包的版本。先检查构建、类型和测试，再更新有变更的包版本：

```bash
pnpm release:check
pnpm release:version
```

`release:version` 会更新包版本和内部依赖、创建 Git 提交和标签并推送到远端，需要工作区干净。只在本地创建版本提交和标签可用 `pnpm release:version --no-push`。

预览各包的发布内容（不会上传到 npm）：

```bash
pnpm release:npm:dry-run
```

Lerna publish 不支持 `--dry-run`，预览由 Lerna 调度各包的 pnpm 发布预演。

登录 npm 后，发布当前版本尚未存在于 npm 的包：

```bash
npm login --registry=https://registry.npmjs.org/
pnpm release:npm
```

`release:npm` 使用 `lerna publish from-package`，自动跳过已发布版本，也可用于失败后的补发。预览和正式发布都会先运行构建、类型检查和测试。发布预发布版本时使用 `pnpm release:npm --dist-tag next`。

所有 npm 包公开发布到 npm 官方 registry；`app` 为私有桌面应用，不参与 npm 版本管理和发布。Lerna 发布流程参考[官方文档](https://lerna.js.org/docs/features/version-and-publish)。

桌面端的开发、配置和打包说明参见 [app/README.md](app/README.md)。
