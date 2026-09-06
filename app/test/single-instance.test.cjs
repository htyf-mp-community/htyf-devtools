const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch(hasLock) {
  const events = new Map();
  const calls = [];
  let ready;
  const app = {
    requestSingleInstanceLock() { calls.push('lock'); return hasLock; },
    quit() { calls.push('quit'); },
    on(name, handler) { events.set(name, handler); },
    whenReady() { calls.push('ready'); return {then(fn) { ready = fn; return {catch() {}}; }}; },
  };
  class BrowserWindow {
    webContents = {on() {}, isDestroyed: () => false};
    constructor() { calls.push('window'); }
    isDestroyed() { return false; }
    isMinimized() { return true; }
    restore() { calls.push('restore'); }
    show() { calls.push('show'); }
    focus() { calls.push('focus'); }
    once() {}
    async loadURL() {}
  }
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return {app, BrowserWindow, ipcMain: {handle() {}}, Menu: {buildFromTemplate: x => x, setApplicationMenu() {}}};
      if (name === './updater.cjs') return {createAutoUpdateController: () => ({start() { calls.push('updater'); }})};
      if (name === './server.cjs') return {DevToolsServer: class {
        async start() { calls.push('server'); }
        on() {}
        getState() { return {runtimes: []}; }
      }};
      if (name.startsWith('node:')) return require(name);
      return {};
    },
    process: {env: {}, once() {}},
    __dirname: path.resolve(__dirname, '../src'),
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), context);
  return {events, calls, context, ready};
}

test('duplicate launch exits without scheduling startup or starting services', () => {
  const {calls, events, ready} = launch(false);
  assert.deepEqual(calls, ['lock', 'quit']);
  assert.equal(ready, undefined);
  assert.equal(events.size, 0);
});

test('second launch while starting focuses the original window once ready', async () => {
  const {calls, events, ready} = launch(true);
  events.get('second-instance')();
  assert.deepEqual(calls, ['lock', 'ready']);
  await ready();
  assert.deepEqual(calls, ['lock', 'ready', 'server', 'window', 'restore', 'show', 'focus', 'updater']);
  events.get('second-instance')();
  assert.deepEqual(calls.slice(-3), ['restore', 'show', 'focus']);
  assert.equal(calls.filter(call => call === 'window').length, 1);
  events.get('activate')();
  assert.deepEqual(calls.slice(-3), ['restore', 'show', 'focus']);
});

test('visible windows are focused without restore and destroyed windows are ignored', async () => {
  const {calls, events, ready, context} = launch(true);
  await ready();
  vm.runInContext('window.isMinimized = () => false', context);
  events.get('second-instance')();
  assert.deepEqual(calls.slice(-2), ['show', 'focus']);
  assert.ok(!calls.includes('restore'));
  vm.runInContext('window.webContents.isDestroyed = () => true', context);
  const count = calls.length;
  events.get('second-instance')();
  assert.equal(calls.length, count);
});
