const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('environment settings are exposed through a narrow IPC surface', () => {
  const main = read('src/main.cjs');
  const preload = read('src/preload.cjs');
  assert.match(main, /系统环境变量…/);
  assert.match(main, /devtools:environment:get/);
  assert.match(main, /devtools:environment:set/);
  assert.match(main, /devtools:environment:add/);
  assert.match(preload, /getEnvironment/);
  assert.match(preload, /setEnvironment/);
  assert.match(preload, /addEnvironmentVariable/);
  assert.doesNotMatch(main, /devtools:environment:restore/);
  assert.doesNotMatch(preload, /restoreEnvironment/);
});

test('Electron application menus use Chinese labels', () => {
  const main = read('src/main.cjs');
  assert.ok(main.includes("label: '红糖开发助手'"));
  assert.ok(main.includes("label: '退出红糖开发助手'"));
  for (const label of ['运行时', '暂无已连接应用', '演示', '启动演示运行时', '生成示例数据', '停止演示运行时', '视图', '重新加载', '帮助']) assert.ok(main.includes(`'${label}'`));
  for (const label of ["label: 'Runtime'", "label: 'Demo'", "label: 'View'", "label: 'Help'"]) assert.doesNotMatch(main, new RegExp(label));
});

test('environment manager restricts direct OS writes to the JSON whitelist', () => {
  const source = read('src/environment.cjs');
  const config = JSON.parse(read('src/environment-variables.json'));
  assert.match(source, /HKCU\\\\Environment/);
  assert.match(source, /Library', 'LaunchAgents/);
  assert.match(source, /ENVIRONMENT_KEYS\.includes/);
  const configuredKeys = config.variables.map(item => item.key);
  assert.ok(configuredKeys.length > 0);
  assert.equal(new Set(configuredKeys).size, configuredKeys.length);
  assert.ok(configuredKeys.every(key => /^[A-Z_][A-Z0-9_]*$/.test(key)));
  assert.match(source, /environment-variables\.json/);
  assert.doesNotMatch(read('src/environment.js'), /const descriptions/);
  assert.doesNotMatch(source, /environment-backup/);
  assert.doesNotMatch(source, /restoreEnvironmentValues/);
  assert.match(source, /environment-variables\.user\.json/);
  assert.match(source, /function addEnvironmentVariable/);
  assert.ok(read('src/environment.html').includes('＋ 添加环境变量'));
});

function createManager(t, options = {}) {
  const vm = require('node:vm');
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devtools-environment-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const system = new Map();
  const writes = [];
  const context = {
    module: {exports: {}}, console,
    process: {platform: 'win32', env: {}},
    require(id) {
      if (id === 'electron') return {app: {getPath: () => directory}};
      if (id === './environment-variables.json') return {variables: [{key: 'TEST_ENV', description: 'test'}, {key: 'OTHER_ENV', description: 'other'}]};
      if (id === 'node:child_process') return {execFileSync(command, args) {
        if (command !== 'reg.exe') return '';
        const key = args[3];
        if (args[0] === 'query') { if (!system.has(key)) throw new Error('missing'); return `    ${key}    REG_SZ    ${system.get(key)}\n`; }
        if (options.failWrites) throw new Error('write failed');
        if (args[0] === 'delete') system.delete(key);
        else { system.set(key, args[7]); writes.push(args[7]); }
        return '';
      }};
      return require(id);
    },
  };
  const reload = () => { context.module = {exports: {}}; vm.runInNewContext(read('src/environment.cjs'), {...context}); return context.module.exports; };
  return {manager: reload(), reload, system, writes, directory};
}

test('saved history trims, deduplicates, orders recent values and survives reload and deletion', t => {
  const {manager, reload, system, writes} = createManager(t);
  system.set('TEST_ENV', ' original ');
  manager.setEnvironmentValues({TEST_ENV: ' first '});
  manager.setEnvironmentValues({TEST_ENV: 'second'});
  manager.setEnvironmentValues({TEST_ENV: ' first\n', OTHER_ENV: 'first'});
  assert.deepEqual(writes, ['first', 'second', 'first', 'first']);
  const history = JSON.parse(JSON.stringify(reload().getEnvironmentState().history));
  assert.deepEqual(history, {TEST_ENV: ['first', 'second', 'original'], OTHER_ENV: ['first']});
  manager.setEnvironmentValues({TEST_ENV: null});
  assert.equal(system.has('TEST_ENV'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(reload().getEnvironmentState().history)), history);
  manager.setEnvironmentValues({TEST_ENV: '   '});
  assert.equal(system.get('TEST_ENV'), '');
  assert.equal(reload().getEnvironmentState().history.TEST_ENV[0], '');
});

test('invalid requests and failed writes do not record unsaved values', t => {
  const {manager, directory} = createManager(t, {failWrites: true});
  assert.throws(() => manager.setEnvironmentValues({TEST_ENV: 'x', UNKNOWN: 'y'}), /不允许修改/);
  assert.throws(() => manager.setEnvironmentValues({TEST_ENV: 12}), /字符串/);
  assert.throws(() => manager.setEnvironmentValues({TEST_ENV: 'x'}), /无法写入/);
  assert.equal(fs.existsSync(path.join(directory, 'environment-values.history.json')), false);
});

test('history loading normalizes legacy values and tolerates invalid files', t => {
  const {manager, directory} = createManager(t);
  const file = path.join(directory, 'environment-values.history.json');
  fs.writeFileSync(file, JSON.stringify({history: {TEST_ENV: [' a ', 'a', 42, ' b ', ''], OTHER_ENV: null}}));
  assert.deepEqual(JSON.parse(JSON.stringify(manager.getEnvironmentState().history)), {TEST_ENV: ['a', 'b', '']});
  fs.writeFileSync(file, '{');
  assert.deepEqual(JSON.parse(JSON.stringify(manager.getEnvironmentState().history)), {});
});

test('custom variables can be deleted persistently while defaults are protected and history retained', t => {
  const {manager, reload, system} = createManager(t);
  manager.addEnvironmentVariable({key: 'CUSTOM_ENV', description: 'custom'});
  manager.setEnvironmentValues({CUSTOM_ENV: ' saved '});
  assert.throws(() => manager.deleteEnvironmentVariable('TEST_ENV'), /默认环境变量不能删除/);
  assert.throws(() => manager.deleteEnvironmentVariable('UNKNOWN'), /不存在/);
  assert.throws(() => manager.deleteEnvironmentVariable('../bad'), /名称无效/);
  manager.deleteEnvironmentVariable('CUSTOM_ENV');
  assert.equal(system.has('CUSTOM_ENV'), false);
  const state = reload().getEnvironmentState();
  assert.equal(state.variables.some(item => item.key === 'CUSTOM_ENV'), false);
  assert.equal(state.history.CUSTOM_ENV[0], 'saved');
  assert.equal(state.variables.some(item => item.key === 'TEST_ENV'), true);
  manager.addEnvironmentVariable({key: 'CUSTOM_ENV', description: ''});
  assert.equal(manager.getEnvironmentState().history.CUSTOM_ENV[0], 'saved');
  manager.deleteEnvironmentVariable('CUSTOM_ENV');
});

test('failed system deletion retains the custom variable configuration', t => {
  const {manager, system, reload} = createManager(t, {failWrites: true});
  manager.addEnvironmentVariable({key: 'CUSTOM_ENV', description: ''});
  system.set('CUSTOM_ENV', 'existing');
  assert.throws(() => manager.deleteEnvironmentVariable('CUSTOM_ENV'), /无法删除/);
  assert.equal(system.get('CUSTOM_ENV'), 'existing');
  assert.equal(reload().getEnvironmentState().variables.some(item => item.key === 'CUSTOM_ENV'), true);
});
