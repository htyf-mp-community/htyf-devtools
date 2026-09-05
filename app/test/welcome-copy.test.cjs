const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/htyf-rn-welcome.js'), 'utf8');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main.cjs'), 'utf8');

test('replacement Welcome copies a complete pairing config through the Electron bridge', () => {
  assert.match(source, /type: 'htyf\.devtools\.pairing'/);
  assert.match(source, /version: 1/);
  assert.match(source, /endpoint, token: this\.#state\?\.pairingToken \?\? ''/);
  assert.match(source, /window\.devtoolsHost\?\.copy/);
  assert.match(source, /window\.devtoolsHost\.setPairingToken\(token\)/);
});

test('returns to a reset Welcome page when the active runtime disconnects', () => {
  assert.match(mainSource, /if \(!activeRuntime\?\.connected\)/);
  assert.match(mainSource, /openWelcome\(\)\.catch/);
  assert.match(source, /this\.#state = undefined/);
  assert.match(source, /window\.devtoolsHost\?\.onState/);
  assert.match(source, /'等待应用连接'/);
});

test('replacement Welcome keeps the token field when pairing is disabled', () => {
  assert.match(source, /token: this\.#state\?\.pairingToken \?\? ''/);
  assert.match(source, /'无需 Token'/);
});

test('Windows firewall guidance is copy-only and never runs a permission check', () => {
  assert.match(source, /Windows 防火墙中允许本应用访问专用网络/);
  assert.doesNotMatch(mainSource, /checkWindowsFirewallAccess|scheduleFirewallCheck|windowsdefender/);
});
