const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runBuild(args, env = {}, localCredentials) {
  const result = {errors: []};
  const exit = {};
  const mockedRequire = name => {
    if (name === 'node:child_process') {
      return {spawnSync: (_command, argv, options) => { result.argv = argv; result.env = options.env; return {status: 0}; }};
    }
    if (name === 'node:fs') {
      return {
        existsSync: file => Boolean(localCredentials) && file.endsWith('notarization.local.json'),
        readFileSync: () => JSON.stringify(localCredentials),
      };
    }
    return require(name);
  };
  mockedRequire.resolve = require.resolve;
  try {
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../scripts/build.cjs'), 'utf8'), {
      require: mockedRequire,
      __dirname: path.resolve(__dirname, '../scripts'),
      process: {argv: ['node', 'build.cjs', ...args], env, execPath: process.execPath, exit: code => { result.code = code; throw exit; }},
      console: {error: message => result.errors.push(message)},
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  return result;
}

test('mac release rejects missing and partial notarization credentials before invoking builder', () => {
  for (const env of [{}, {APPLE_ID: 'example'}, {APPLE_API_KEY: '/tmp/key.p8'}, {APPLE_KEYCHAIN: '/tmp/keychain'}, {APPLE_KEYCHAIN_PROFILE: 'profile', APPLE_ID: 'example'}]) {
    const result = runBuild(['mac', '--signed'], env);
    assert.equal(result.code, 1);
    assert.equal(result.argv, undefined);
    assert.match(result.errors[0], /Missing: APPLE_/);
  }
});

test('mac release enables signing and notarization for each supported credential type', () => {
  for (const env of [
    {APPLE_ID: 'example', APPLE_APP_SPECIFIC_PASSWORD: 'test-secret', APPLE_TEAM_ID: 'team'},
    {APPLE_API_KEY: '/tmp/key.p8', APPLE_API_KEY_ID: 'key', APPLE_API_ISSUER: 'issuer'},
    {APPLE_KEYCHAIN_PROFILE: 'profile'},
  ]) {
    const result = runBuild(['mac', '--signed'], env);
    assert.equal(result.code, 0);
    assert.ok(result.argv.includes('-c.forceCodeSigning=true'));
    assert.ok(result.argv.includes('-c.mac.notarize=true'));
    assert.equal(result.errors.length, 0);
    assert.ok(!result.argv.some(value => value.includes('test-secret')));
  }
});

test('mac release loads notarization credentials from the ignored local file', () => {
  const result = runBuild(['mac', '--signed'], {}, {
    APPLE_ID: 'local@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'local-secret',
    APPLE_TEAM_ID: 'local-team',
  });
  assert.equal(result.code, 0);
  assert.equal(result.env.APPLE_ID, 'local@example.com');
  assert.equal(result.env.APPLE_APP_SPECIFIC_PASSWORD, 'local-secret');
  assert.equal(result.env.APPLE_TEAM_ID, 'local-team');
  assert.ok(result.argv.includes('-c.mac.notarize=true'));
  assert.ok(!result.argv.some(value => value.includes('local-secret')));
});

test('local builds skip notarization even with credentials and Windows release needs no Apple credentials', () => {
  for (const target of ['mac', 'dir']) {
    const result = runBuild([target], {APPLE_KEYCHAIN_PROFILE: 'profile'});
    assert.equal(result.code, 0);
    assert.ok(result.argv.includes('-c.mac.notarize=false'));
    assert.equal(result.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  }
  const windows = runBuild(['win', '--signed']);
  assert.equal(windows.code, 0);
  assert.ok(!windows.argv.some(value => value.includes('notarize')));
});
