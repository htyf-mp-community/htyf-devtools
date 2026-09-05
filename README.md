# 红糖开发助手

红糖开发助手独立 monorepo，使用 pnpm workspace 与 Lerna 管理。

## 目录结构

```text
mp-devtools/
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

预览发布内容：

```bash
pnpm release:npm --dry-run
```

正式发布固定的四个 Reporter/协议包：

```bash
pnpm release:npm
```

`app` 为私有桌面应用，不会发布到 npm。

桌面端的开发、配置和打包说明参见 [app/README.md](app/README.md)。
