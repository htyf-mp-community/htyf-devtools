const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
const configPath = path.resolve(__dirname, '../electron-builder.config.cjs');
const localCredentialsPath = path.resolve(__dirname, '../notarization.local.json');

if (target === 'mac' && signed && fs.existsSync(localCredentialsPath)) {
  const localCredentials = JSON.parse(fs.readFileSync(localCredentialsPath, 'utf8'));
  const supportedKeys = [
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
    'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER',
    'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE',
  ];
  for (const key of supportedKeys) {
    // 显式环境变量优先，便于 CI 覆盖本机配置。
    if (!environment[key] && typeof localCredentials[key] === 'string' && localCredentials[key].trim()) {
      environment[key] = localCredentials[key];
    }
  }
}

// electron-builder can auto-discover a macOS certificate and start signing even
// for a local test build. Disable that only for unsigned commands. The signed
// release commands inherit CSC_LINK/CSC_KEY_PASSWORD or the macOS keychain.
if (!signed) {
  environment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const releaseOptions = [];
if (target === 'mac' && signed) {
  // 与 electron-builder 的凭据选择顺序一致，部分配置不能被另一组凭据掩盖。
  const required = environment.APPLE_ID || environment.APPLE_APP_SPECIFIC_PASSWORD
    ? ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
    : environment.APPLE_API_KEY || environment.APPLE_API_KEY_ID || environment.APPLE_API_ISSUER
      ? ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
      : ['APPLE_KEYCHAIN_PROFILE'];
  const missing = required.filter(key => !environment[key]?.trim());
  if (missing.length) {
    console.error(`macOS release requires notarization credentials. Missing: ${missing.join(', ')}. See app/README.md.`);
    process.exit(1);
  }
  releaseOptions.push('-c.forceCodeSigning=true', '-c.mac.notarize=true');
} else if (target === 'mac' || target === 'dir') {
  releaseOptions.push('-c.mac.notarize=false');
}

const result = spawnSync(
  process.execPath,
  [electronBuilderCli, '--config', configPath, ...targetArguments[target], ...releaseOptions],
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
