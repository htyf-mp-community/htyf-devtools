const path = require('node:path');
const fs = require('node:fs');
const {app, BrowserWindow, Menu, ipcMain, clipboard, dialog} = require('electron');
const QRCode = require('qrcode');
const {DevToolsServer} = require('./server.cjs');
const {DemoRuntime} = require('./demo-runtime.cjs');
const {createAutoUpdateController} = require('./updater.cjs');
const {getEnvironmentState, setEnvironmentValues, addEnvironmentVariable} = require('./environment.cjs');

let window;
let environmentWindow;
let server;
let activeRuntimeId;
let demoRuntime;
let shutdownPromise;
const updater = createAutoUpdateController(() => window);
const compatibilityNotices = new Map();
const demoSessionDir = process.env.HTYF_DEVTOOLS_DEMO === '1' ? path.join(app.getPath('temp'), `htyf-devtools-demo-${process.pid}`) : undefined;
if (demoSessionDir) app.setPath('sessionData', demoSessionDir);

function hasLiveWindow() {
  // Electron JS 包装对象在原生窗口销毁后仍可能非空，必须同时检查两层状态。
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function shutdown() {
  // shutdownPromise 将窗口关闭、系统信号和菜单退出收敛为一次析构。
  if (!shutdownPromise) {
    demoRuntime?.stop();
    demoRuntime = undefined;
    updater.stop();
    shutdownPromise = server?.stop().catch(error => console.error('[desktop] shutdown failed', error)) || Promise.resolve();
  }
  return shutdownPromise;
}

async function handleSignal() {
  await shutdown();
  app.exit(0);
}

function startDemo() {
  if (demoRuntime) return;
  // Demo 也走正式 Reporter WebSocket，不直接写 Server 内存，才能验证完整链路。
  demoRuntime = new DemoRuntime({endpoint: `ws://${server.advertisedHost}:${server.port}/reporter`, token: server.requirePairing ? server.pairingToken : undefined});
  demoRuntime.start();
  updateMenu(server.getState());
}

function stopDemo() {
  demoRuntime?.stop();
  demoRuntime = undefined;
  updateMenu(server.getState());
}

async function openRuntime(runtimeId) {
  if (!hasLiveWindow()) return;
  activeRuntimeId = runtimeId;
  const runtime = server.getState().runtimes.find(item => item.runtimeId === runtimeId);
  const versionLabel = runtime?.compatibility?.reporterVersion ? `插件 v${runtime.compatibility.reporterVersion}` : '插件版本未知';
  const compatibilityLabel = runtime?.compatibility?.status === 'compatible' ? '兼容' : '需检查';
  window.setTitle(`红糖开发助手 — ${runtime?.appName || runtimeId} · ${versionLabel} · ${compatibilityLabel}`);
  const ws = `${server.advertisedHost}:${server.port}/cdp/${encodeURIComponent(runtimeId)}`;
  await window.loadURL(`http://${server.advertisedHost}:${server.port}/devtools/rn_fusebox.html?ws=${encodeURIComponent(ws)}&panel=network`);
}

async function openWelcome() {
  if (!hasLiveWindow()) return;
  activeRuntimeId = undefined;
  window.setTitle('红糖开发助手 — 欢迎');
  const ws = `${server.advertisedHost}:${server.port}/cdp/welcome`;
  await window.loadURL(`http://${server.advertisedHost}:${server.port}/devtools/rn_fusebox.html?ws=${encodeURIComponent(ws)}`);
}

function updateMenu(state) {
  const runtimes = state.runtimes.map(runtime => ({
    label: `${runtime.connected ? '●' : '○'} ${runtime.compatibility?.status === 'compatible' ? '✓' : '⚠'} ${runtime.appName} · ${runtime.compatibility?.reporterVersion ? `插件 v${runtime.compatibility.reporterVersion}` : '插件版本未知'}`,
    enabled: runtime.connected,
    type: 'radio',
    checked: runtime.runtimeId === activeRuntimeId,
    click: () => openRuntime(runtime.runtimeId).catch(console.error),
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: '红糖开发助手', submenu: [
      {label: '欢迎页', accelerator: 'CmdOrCtrl+Shift+H', click: () => openWelcome().catch(console.error)},
      {label: '系统环境变量…', accelerator: 'CmdOrCtrl+,', click: openEnvironmentWindow},
      {type: 'separator'}, {label: '退出红糖开发助手', role: 'quit'},
    ]},
    {label: '运行时', submenu: runtimes.length ? runtimes : [{label: '暂无已连接应用', enabled: false}]},
    {label: '演示', submenu: [
      {label: demoRuntime ? '演示正在运行' : '启动演示运行时', accelerator: 'CmdOrCtrl+Shift+D', enabled: !demoRuntime, click: startDemo},
      {label: '生成示例数据', enabled: Boolean(demoRuntime), click: () => demoRuntime?.generateSample()},
      {label: '停止演示运行时', enabled: Boolean(demoRuntime), click: stopDemo},
    ]},
    {label: '视图', submenu: [
      {label: '重新加载', role: 'reload'},
      {label: '切换开发者工具', role: 'toggleDevTools'},
      {type: 'separator'},
      {label: '重置缩放', role: 'resetZoom'},
      {label: '放大', role: 'zoomIn'},
      {label: '缩小', role: 'zoomOut'},
      {label: '切换全屏', role: 'togglefullscreen'},
    ]},
    {label: '帮助', submenu: [{label: '检查更新…', click: () => void updater.check()}]},
  ]));
}

function openEnvironmentWindow() {
  if (environmentWindow && !environmentWindow.isDestroyed()) {
    environmentWindow.show();
    environmentWindow.focus();
    return;
  }
  environmentWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 700,
    minHeight: 560,
    title: '系统环境变量 — 红糖开发助手',
    icon: path.resolve(__dirname, '../build/icon.png'),
    parent: hasLiveWindow() ? window : undefined,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true},
  });
  environmentWindow.once('closed', () => { environmentWindow = undefined; });
  void environmentWindow.loadFile(path.join(__dirname, 'environment.html')).catch(error => {
    console.error('[environment] failed to open settings', error);
  });
}

async function createWindow() {
  window = new BrowserWindow({width: 1440, height: 960, minWidth: 900, minHeight: 600, title: '红糖开发助手 — 欢迎', icon: path.resolve(__dirname, '../build/icon.png'), backgroundColor: '#f8f9fa', webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.webContents.on('did-fail-load', (_event, code, description, url) => console.error('[frontend] load failed', {code, description, url}));
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error('[frontend]', details.message, `${details.sourceId}:${details.lineNumber}`);
  });
  window.once('closed', () => { window = undefined; });
  const ws = `${server.advertisedHost}:${server.port}/cdp/welcome`;
  await window.loadURL(`http://${server.advertisedHost}:${server.port}/devtools/rn_fusebox.html?ws=${encodeURIComponent(ws)}`);
}

app.whenReady().then(async () => {
  server = new DevToolsServer({host: process.env.HTYF_DEVTOOLS_HOST || '0.0.0.0', port: Number(process.env.HTYF_DEVTOOLS_PORT || 17654), frontendDir: path.resolve(__dirname, '../frontend-dist')});
  await server.start();
  ipcMain.handle('devtools:get-state', async () => {
    const state = server.getState(true);
    return {...state, qr: await QRCode.toDataURL(JSON.stringify(server.getPairingPayload()))};
  });
  ipcMain.handle('devtools:set-pairing-token', async (_event, token) => {
    const state = server.setPairingToken(token);
    return {...state, qr: await QRCode.toDataURL(JSON.stringify(server.getPairingPayload()))};
  });
  ipcMain.handle('devtools:open-runtime', (_event, runtimeId) => openRuntime(runtimeId));
  ipcMain.handle('devtools:copy', (_event, text) => clipboard.writeText(text));
  ipcMain.handle('devtools:environment:get', () => getEnvironmentState());
  ipcMain.handle('devtools:environment:set', (_event, values) => setEnvironmentValues(values));
  ipcMain.handle('devtools:environment:add', (_event, variable) => addEnvironmentVariable(variable));
  server.on('state', state => {
    // close 事件可能晚于 BrowserWindow 销毁，不能仅依赖 window 可选链。
    if (!hasLiveWindow()) return;
    window.webContents.send('devtools:state', state);
    updateMenu(state);
    for (const runtime of state.runtimes.filter(item => item.connected)) {
      const compatibility = runtime.compatibility;
      const noticeKey = `${compatibility?.status}:${compatibility?.reporterVersion || 'unknown'}:${compatibility?.desktopVersion || 'unknown'}`;
      if (compatibilityNotices.get(runtime.runtimeId) === noticeKey) continue;
      compatibilityNotices.set(runtime.runtimeId, noticeKey);
      if (compatibility?.status !== 'compatible') {
        void dialog.showMessageBox(window, {
          type: 'warning',
          title: '插件版本兼容性提示',
          message: compatibility?.message || '无法确认接入插件与桌面端是否兼容。',
          detail: `应用：${runtime.appName}\n插件：${compatibility?.reporterPackage || '未知'}\n桌面端：v${state.desktopVersion}`,
        }).catch(error => console.warn('[desktop] compatibility notice failed', error));
      }
    }
    // 当前正在调试的应用断开后，旧 Runtime 页面不再具有有效数据源。
    // 立即回到 Welcome，展示最新连接状态并重新生成配对信息。
    if (activeRuntimeId) {
      const activeRuntime = state.runtimes.find(runtime => runtime.runtimeId === activeRuntimeId);
      if (!activeRuntime?.connected) {
        openWelcome().catch(console.error);
        return;
      }
    }
    const firstConnected = state.runtimes.find(runtime => runtime.connected);
    if (!activeRuntimeId && firstConnected) openRuntime(firstConnected.runtimeId).catch(console.error);
  });
  await createWindow();
  updater.start();
  updateMenu(server.getState());
  if (process.env.HTYF_DEVTOOLS_DEMO === '1') startDemo();
}).catch(error => {
  console.error('[desktop] failed to start', error);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { void shutdown(); });
app.on('quit', () => { if (demoSessionDir) fs.rmSync(demoSessionDir, {recursive: true, force: true}); });
process.once('SIGINT', () => { void handleSignal(); });
process.once('SIGTERM', () => { void handleSignal(); });
