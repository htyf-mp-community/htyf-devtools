const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

// 固定发布白名单和顺序，禁止通过命令行传入其他 workspace 包。
const packages = [
  '@htyf-mp/devtools-protocol',
  '@htyf-mp/devtools-react-native',
  '@htyf-mp/devtools-web',
  '@htyf-mp/devtools-electron',
];

const packageDirectories = new Map(packages.map(name => [name, path.join(__dirname, '..', 'packages', name.replace('@htyf-mp/', ''))]));
const packageManifests = new Map();
const args = process.argv.slice(2);
const options = {dryRun: false, skipChecks: false, tag: undefined};

function printUsage() {
  console.log(`Usage: pnpm devtools:publish [options]

Options:
  --dry-run          Build and preview every package without publishing
  --tag=<tag>        Publish with an npm dist-tag, for example --tag=next
  --skip-checks      Skip type checks and package tests
  --help             Show this help message`);
}

for (const arg of args) {
  if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--skip-checks') options.skipChecks = true;
  else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
  else if (arg === '--help') {
    printUsage();
    process.exit(0);
  } else {
    console.error(`Unknown option: ${arg}`);
    printUsage();
    process.exit(1);
  }
}

if (options.tag && !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(options.tag)) {
  console.error(`Invalid npm dist-tag: ${options.tag}`);
  process.exit(1);
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, commandArgs, label) {
  console.log(`\n[publish] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[publish] Unable to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const packageName of packages) {
  const directory = packageDirectories.get(packageName);
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[publish] Missing package manifest: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== packageName || manifest.private === true) {
    console.error(`[publish] Refusing to publish invalid package: ${manifestPath}`);
    process.exit(1);
  }
  packageManifests.set(packageName, manifest);
}

function assertVersionsAreNotPublished() {
  const conflicts = [];
  for (const packageName of packages) {
    const version = packageManifests.get(packageName).version;
    const result = spawnSync(npm, ['view', `${packageName}@${version}`, 'version', '--registry=https://registry.npmjs.org/'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: process.env,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.status === 0) conflicts.push(`${packageName}@${version}`);
    else if (!output.includes('E404')) {
      process.stderr.write(output);
      console.error(`[publish] Unable to verify ${packageName}@${version} on npm.`);
      process.exit(result.status ?? 1);
    }
  }
  if (conflicts.length) {
    console.error(`\n[publish] These versions already exist and cannot be overwritten:\n${conflicts.map(value => `  - ${value}`).join('\n')}\nBump the package versions before publishing.`);
    process.exit(1);
  }
}

if (!options.skipChecks) {
  for (const packageName of packages) {
    run(pnpm, ['--filter', packageName, 'run', 'type-check'], `${packageName}: type-check`);
  }
  for (const packageName of packages.filter(name => name !== '@htyf-mp/devtools-protocol')) {
    run(pnpm, ['--filter', packageName, 'test'], `${packageName}: test`);
  }
}

if (!options.dryRun) {
  run(npm, ['whoami', '--registry=https://registry.npmjs.org/'], 'verify npm login');
  assertVersionsAreNotPublished();
}

for (const packageName of packages) {
  const publishArgs = ['--filter', packageName, 'publish', '--access', 'public', '--registry', 'https://registry.npmjs.org/'];
  if (options.dryRun) publishArgs.push('--dry-run');
  publishArgs.push('--no-git-checks');
  if (options.tag) publishArgs.push('--tag', options.tag);
  run(pnpm, publishArgs, `${options.dryRun ? 'preview' : 'publish'} ${packageName}`);
}

console.log(`\n[publish] ${options.dryRun ? 'Dry run completed' : 'All four DevTools packages published successfully'}.`);
