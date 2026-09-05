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
