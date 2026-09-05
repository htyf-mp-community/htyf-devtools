const { spawnSync } = require('node:child_process');

/**
 * Cross-platform electron-builder launcher.
 *
 * Keeping the platform/architecture policy here avoids POSIX-only environment
 * assignments in package.json and gives local builds deterministic behaviour:
 * macOS builds do not unexpectedly discover and use a developer certificate.
 * Release commands opt back into electron-builder's normal signing discovery.
 */
const target = process.argv[2];
const signed = process.argv.includes('--signed');

const targetArguments = {
  // Directory builds are intentionally limited to the host platform. They are
  // fast smoke-test artifacts, not files intended for distribution.
  dir: ['--dir'],
  // 只发布一个聚合包，同时包含 Intel 与 Apple Silicon 原生可执行切片。
  mac: ['--mac', 'dmg', 'zip', '--universal'],
  // x64 remains the broadly compatible target for the initial Windows release.
  win: ['--win', 'nsis', 'zip', '--x64'],
};

if (!Object.hasOwn(targetArguments, target)) {
  console.error('Usage: node scripts/build.cjs <dir|mac|win> [--signed]');
  process.exit(1);
}

if (signed && target === 'dir') {
  console.error('The --signed option is only valid for mac or win releases.');
  process.exit(1);
}

const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
const environment = { ...process.env };
const configPath = require('node:path').resolve(__dirname, '../electron-builder.config.cjs');

// electron-builder can auto-discover a macOS certificate and start signing even
// for a local test build. Disable that only for unsigned commands. The signed
// release commands inherit CSC_LINK/CSC_KEY_PASSWORD or the macOS keychain.
if (!signed) {
  environment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const result = spawnSync(
  process.execPath,
  [electronBuilderCli, '--config', configPath, ...targetArguments[target]],
  {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: environment,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Unable to start electron-builder: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
