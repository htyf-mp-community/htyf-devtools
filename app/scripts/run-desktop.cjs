const {spawn} = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const detached = process.argv.includes('--detach');
const valueOf = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = {...process.env};
if (process.argv.includes('--demo')) environment.HTYF_DEVTOOLS_DEMO = '1';
if (valueOf('host')) environment.HTYF_DEVTOOLS_HOST = valueOf('host');
if (valueOf('port')) environment.HTYF_DEVTOOLS_PORT = valueOf('port');
const inspectPort = valueOf('inspect');
const electronArguments = [inspectPort ? `--inspect=${inspectPort}` : undefined, path.resolve(__dirname, '../src/main.cjs')].filter(Boolean);
// 默认前台运行以保留完整日志；只有显式 --detach 才脱离终端。
const child = spawn(electron, electronArguments, {stdio: detached ? 'ignore' : 'inherit', env: environment, detached});

if (detached) {
  child.unref();
  console.log(`红糖开发助手已在后台启动 (PID ${child.pid})`);
  return;
}

let userStopped = false;

function stop(signal) {
  if (userStopped) return;
  userStopped = true;
  if (!child.killed) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', error => {
  console.error('[desktop] failed to launch Electron', error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = userStopped ? 0 : code ?? (signal ? 1 : 0);
});
