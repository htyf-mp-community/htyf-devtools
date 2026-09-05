const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('mac release is a single universal package with branded icons', () => {
  const config = require('../electron-builder.config.cjs');
  const buildScript = fs.readFileSync(path.join(root, 'scripts/build.cjs'), 'utf8');
  assert.equal(config.productName, '红糖开发助手');
  assert.equal(config.mac.executableName, 'HongtangDeveloperAssistant');
  assert.equal(config.win.executableName, 'HongtangDeveloperAssistant');
  assert.equal(config.nsis.shortcutName, '红糖开发助手');
  assert.equal(config.nsis.uninstallDisplayName, '红糖开发助手');
  assert.equal(config.artifactName, 'v${version}/${os}/${arch}/latest.${ext}');
  assert.equal(config.mac.icon, 'build/icon.png');
  assert.equal(config.win.icon, 'build/icon.png');
  assert.equal(config.nsis.perMachine, true);
  assert.equal(config.nsis.allowElevation, true);
  assert.deepEqual(config.mac.target.flatMap(target => target.arch), ['universal', 'universal']);
  assert.match(buildScript, /'--universal'/);
  assert.doesNotMatch(buildScript, /'--x64', '--arm64'/);
  assert.ok(fs.existsSync(path.join(root, 'build/icon.png')));
});

test('release config emits generic update metadata when an update URL is provided', () => {
  const configPath = require.resolve('../electron-builder.config.cjs');
  const previous = process.env.HTYF_DEVTOOLS_UPDATE_URL;
  process.env.HTYF_DEVTOOLS_UPDATE_URL = 'https://updates.example/devtools/';
  delete require.cache[configPath];
  const config = require(configPath);
  assert.deepEqual(config.publish, [{provider: 'generic', url: 'https://updates.example/devtools'}]);
  assert.equal(config.generateUpdatesFilesForAllChannels, true);
  if (previous === undefined) delete process.env.HTYF_DEVTOOLS_UPDATE_URL;
  else process.env.HTYF_DEVTOOLS_UPDATE_URL = previous;
  delete require.cache[configPath];
});

test('release config uses the default COS update endpoint', () => {
  const configPath = require.resolve('../electron-builder.config.cjs');
  const previous = process.env.HTYF_DEVTOOLS_UPDATE_URL;
  delete process.env.HTYF_DEVTOOLS_UPDATE_URL;
  delete require.cache[configPath];
  const config = require(configPath);
  assert.deepEqual(config.publish, [{
    provider: 'generic',
    url: 'http://oss.dagouzhi.com/com.dagouzhi.mp.devtools/latest',
  }]);
  if (previous !== undefined) process.env.HTYF_DEVTOOLS_UPDATE_URL = previous;
  delete require.cache[configPath];
});

test('auto updater isolates provider failures from the desktop process', () => {
  const source = fs.readFileSync(path.join(root, 'src/updater.cjs'), 'utf8');
  assert.match(source, /autoUpdater\.on\('error'/);
  assert.match(source, /autoInstallOnAppQuit = true/);
  assert.match(source, /HTYF_DEVTOOLS_AUTO_UPDATE/);
});
