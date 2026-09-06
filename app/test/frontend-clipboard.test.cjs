const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the prepared host method used by Network's Copy URL/cURL/response actions.
const host = fs.readFileSync(path.resolve(__dirname, '../frontend-dist/core/host/host.js'), 'utf8');
const method = host.match(/copyText\(e\)\{([\s\S]*?)\}openInNewTab\(/);
assert.ok(method, 'frontend copyText method must be present');
const makeCopy = globals => vm.runInNewContext(`(function(e) {${method[1]}})`, globals);

test('Network copy uses the desktop bridge without browser clipboard access', async () => {
  const copied = [];
  const copy = makeCopy({window: {devtoolsHost: {copy: async text => copied.push(text)}}, navigator: {}});
  for (const text of ['https://example.test/api', "curl 'https://example.test/api'", '{"message":"中文响应"}', '']) {
    await copy(text);
    assert.equal(copied.at(-1), text);
  }
  assert.equal(copied.length, 4);
  await copy(null);
  await copy(undefined);
  assert.equal(copied.length, 4);
});

test('browser frontend retains its clipboard fallback', async () => {
  const copied = [];
  const copy = makeCopy({window: {}, navigator: {clipboard: {writeText: async text => copied.push(text)}}});
  await copy('browser copy');
  assert.deepEqual(copied, ['browser copy']);
});
