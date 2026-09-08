const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('website bridge opens only the official URL and propagates browser failures', async () => {
  const handlers = new Map();
  const opened = [];
  let bridge;
  let ready;
  let fail = false;
  const electron = {
    app: {requestSingleInstanceLock: () => true, whenReady: () => ({then: callback => { ready = callback; return {catch() {}}; }}), on() {}},
    ipcMain: {handle: (name, handler) => handlers.set(name, handler)},
    ipcRenderer: {invoke: (name, ...args) => handlers.get(name)({}, ...args)},
    contextBridge: {exposeInMainWorld: (_name, value) => { bridge = value; }},
    shell: {openExternal: async url => { if (fail) throw new Error('Browser unavailable'); opened.push(url); }},
    BrowserWindow: class {
      webContents = {on() {}};
      once() {}
      async loadFile() {}
    },
    Menu: {buildFromTemplate: value => value, setApplicationMenu() {}},
  };
  const context = vm.createContext({
    require: name => {
      if (name === 'electron') return electron;
      if (name === './updater.cjs') return {createAutoUpdateController: () => ({start() {}})};
      if (name === './server.cjs') return {DevToolsServer: class {
        async start() {}
        on() {}
        getState() { return {runtimes: []}; }
      }};
      if (name.startsWith('node:')) return require(name);
      return {};
    },
    __dirname: path.resolve(__dirname, '../src'),
    process: {env: {}, once() {}},
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), context);
  await ready();
  // A separate context matches Electron's isolated preload environment.
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8'), {
    require: () => electron,
  });
  await bridge.openWebsite('file:///ignored');
  assert.deepEqual(opened, ['https://mp.dagouzhi.com/']);
  fail = true;
  await assert.rejects(bridge.openWebsite(), /Browser unavailable/);
});
