const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('desktop editing commands survive application menu rebuilds', () => {
  let menu;
  const electron = {
    app: {requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {}},
    Menu: {
      buildFromTemplate: template => template,
      setApplicationMenu: value => { menu = value; },
    },
  };
  const context = vm.createContext({
    require: name => {
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
  for (const runtimes of [[], [{runtimeId: 'test', appName: '测试应用', connected: true}], []]) {
    context.state = {runtimes};
    vm.runInContext('updateMenu(state)', context);
    const editMenu = menu.find(item => item.label === '编辑');
    assert.ok(editMenu, 'application menu must expose native editing shortcuts');
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      const command = editMenu.submenu.find(item => item.role === role);
      assert.ok(command, `missing native ${role} command`);
      assert.notEqual(command.enabled, false);
      assert.equal(command.click, undefined, 'let Electron route commands to the focused window');
    }
  }
});
