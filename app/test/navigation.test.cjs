const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMain() {
  const navigations = [];
  class BrowserWindow {
    webContents = {on() {}, isDestroyed: () => false};
    isDestroyed() { return false; }
    once() {}
    setTitle() {}
    async loadFile(file, options) { navigations.push({file, options}); }
  }
  const electron = {
    app: {requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {}},
    BrowserWindow,
    Menu: {buildFromTemplate: value => value, setApplicationMenu() {}},
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === './updater.cjs') return {createAutoUpdateController: () => ({})};
      if (name.startsWith('node:')) return require(name);
      return {};
    },
    process: {env: {}, once() {}},
    __dirname: path.resolve(__dirname, '../src'),
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), context);
  vm.runInContext(`server = {
    advertisedHost: '192.168.3.17',
    port: 17654,
    getState: () => ({runtimes: [{runtimeId: 'runtime/file', appName: '测试应用', connected: true}]})
  }`, context);
  return {context, navigations};
}

test('desktop frontend remains a local file across welcome and runtime navigation', async () => {
  const {context, navigations} = loadMain();
  await vm.runInContext('createWindow()', context);
  await vm.runInContext(`openRuntime('runtime/file')`, context);
  await vm.runInContext('openWelcome()', context);

  assert.equal(navigations.length, 3);
  for (const navigation of navigations) {
    assert.equal(navigation.file, path.resolve(__dirname, '../frontend-dist/rn_fusebox.html'));
    assert.match(navigation.options.query.ws, /^192\.168\.3\.17:17654\/cdp\//);
  }
  assert.equal(navigations[1].options.query.ws, '192.168.3.17:17654/cdp/runtime%2Ffile');
  assert.equal(navigations[1].options.query.panel, 'network');
  assert.equal(navigations[2].options.query.ws, '192.168.3.17:17654/cdp/welcome');
});

test('reloads the active frontend when a restarted server selects a new port', async () => {
  const {context, navigations} = loadMain();
  await vm.runInContext('createWindow()', context);
  await vm.runInContext(`openRuntime('runtime/file')`, context);
  vm.runInContext('server.port = 17655', context);
  await vm.runInContext('syncFrontendEndpoint()', context);

  assert.equal(navigations.length, 3);
  assert.equal(navigations[2].options.query.ws, '192.168.3.17:17655/cdp/runtime%2Ffile');
  assert.equal(navigations[2].options.query.panel, 'network');

  await vm.runInContext('syncFrontendEndpoint()', context);
  assert.equal(navigations.length, 3, 'unchanged endpoints must not reload the frontend');
});
