const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {app} = require('electron');
const environmentConfig = require('./environment-variables.json');

const ENVIRONMENT_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
if (!Array.isArray(environmentConfig.variables) || environmentConfig.variables.some(item => !item || !ENVIRONMENT_KEY_PATTERN.test(item.key) || typeof item.description !== 'string')) {
  throw new Error('environment-variables.json 格式无效');
}
const ENVIRONMENT_VARIABLES = Object.freeze(environmentConfig.variables.map(item => Object.freeze({...item})));
const ENVIRONMENT_KEYS = Object.freeze(ENVIRONMENT_VARIABLES.map(item => item.key));
if (new Set(ENVIRONMENT_KEYS).size !== ENVIRONMENT_KEYS.length) throw new Error('environment-variables.json 包含重复变量');

const customConfigPath = () => path.join(app.getPath('userData'), 'environment-variables.user.json');
const historyPath = () => path.join(app.getPath('userData'), 'environment-values.history.json');

function readHistory() {
  try {
    const {history} = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    if (!history || typeof history !== 'object' || Array.isArray(history)) return {};
    return Object.fromEntries(Object.entries(history)
      .filter(([key, values]) => ENVIRONMENT_KEY_PATTERN.test(key) && Array.isArray(values))
      .map(([key, values]) => [key, [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()))]]));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[environment] ignored invalid value history', error.message);
    return {};
  }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(historyPath()), {recursive: true});
  const temporary = `${historyPath()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({version: 1, history}, null, 2)}\n`, {mode: 0o600});
  fs.renameSync(temporary, historyPath());
}

function validateVariable(variable) {
  if (!variable || !ENVIRONMENT_KEY_PATTERN.test(variable.key) || typeof variable.description !== 'string') {
    throw new Error('环境变量名称只能包含大写字母、数字和下划线，且不能以数字开头');
  }
  return {key: variable.key, description: variable.description.trim().slice(0, 100)};
}

function readCustomVariables() {
  try {
    const parsed = JSON.parse(fs.readFileSync(customConfigPath(), 'utf8'));
    if (!Array.isArray(parsed.variables)) return [];
    return parsed.variables.map(validateVariable);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[environment] ignored invalid user variable config', error.message);
    return [];
  }
}

function getVariables() {
  const custom = readCustomVariables().filter(item => !ENVIRONMENT_KEYS.includes(item.key));
  return [...ENVIRONMENT_VARIABLES.map(item => ({...item, custom: false})), ...custom.map(item => ({...item, custom: true}))];
}

function addEnvironmentVariable(variable) {
  const normalized = validateVariable(variable);
  const variables = getVariables();
  if (variables.some(item => item.key === normalized.key)) throw new Error(`${normalized.key} 已存在`);
  const custom = [...readCustomVariables(), normalized];
  saveCustomVariables(custom);
  return getEnvironmentState();
}

function saveCustomVariables(custom) {
  fs.mkdirSync(path.dirname(customConfigPath()), {recursive: true});
  const temporary = `${customConfigPath()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({version: 1, variables: custom}, null, 2)}\n`, {mode: 0o600});
  fs.renameSync(temporary, customConfigPath());
}

function deleteEnvironmentVariable(key) {
  if (typeof key !== 'string' || !ENVIRONMENT_KEY_PATTERN.test(key)) throw new Error('环境变量名称无效');
  if (ENVIRONMENT_KEYS.includes(key)) throw new Error('默认环境变量不能删除');
  const custom = readCustomVariables();
  if (!custom.some(item => item.key === key)) throw new Error(`${key} 不存在`);
  setEnvironmentValues({[key]: null});
  saveCustomVariables(custom.filter(item => item.key !== key));
  return getEnvironmentState();
}

const launchAgentPath = key => path.join(os.homedir(), 'Library', 'LaunchAgents', `com.htyfmp.devtools.env.${key.toLowerCase()}.plist`);
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function run(command, args) {
  try { return execFileSync(command, args, {encoding: 'utf8', windowsHide: true}).trim(); }
  catch { return undefined; }
}

function runRequired(command, args, errorMessage) {
  try { return execFileSync(command, args, {encoding: 'utf8', windowsHide: true}).trim(); }
  catch (error) { throw new Error(errorMessage, {cause: error}); }
}

function readWindowsValue(key) {
  const output = run('reg.exe', ['query', 'HKCU\\Environment', '/v', key]);
  const match = output?.match(new RegExp(`^\\s*${key}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.*)$`, 'mi'));
  return match ? {exists: true, value: match[1]} : {exists: false, value: ''};
}

function readMacValue(key) {
  const value = run('/bin/launchctl', ['getenv', key]);
  // launchctl 对“不存在”和“存在但为空”都可能输出空字符串；进程环境或本工具的
  // LaunchAgent 文件可以帮助保留空字符串这一合法配置的存在性。
  const exists = value !== undefined && (value !== '' || Object.hasOwn(process.env, key) || fs.existsSync(launchAgentPath(key)));
  return exists ? {exists: true, value} : {exists: false, value: ''};
}

function readValue(key) {
  if (process.platform === 'win32') return readWindowsValue(key);
  if (process.platform === 'darwin') return readMacValue(key);
  return Object.hasOwn(process.env, key) ? {exists: true, value: process.env[key] || ''} : {exists: false, value: ''};
}

function broadcastWindowsEnvironmentChange() {
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::SetEnvironmentVariable("HTYF_DEVTOOLS_REFRESH",$null,"User"); Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition \'[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);\'; $r=[UIntPtr]::Zero; [Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff,0x001A,[UIntPtr]::Zero,"Environment",2,5000,[ref]$r) | Out-Null']);
}

function writeWindowsValue(key, value) {
  if (value === null) {
    if (readWindowsValue(key).exists) runRequired('reg.exe', ['delete', 'HKCU\\Environment', '/v', key, '/f'], `无法删除 ${key}`);
  }
  else runRequired('reg.exe', ['add', 'HKCU\\Environment', '/v', key, '/t', 'REG_SZ', '/d', value, '/f'], `无法写入 ${key}`);
  if (value === null) delete process.env[key]; else process.env[key] = value;
}

function writeMacValue(key, value) {
  const file = launchAgentPath(key);
  run('/bin/launchctl', ['bootout', `gui/${process.getuid()}`, file]);
  if (value === null) {
    runRequired('/bin/launchctl', ['unsetenv', key], `无法删除 ${key}`);
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    delete process.env[key];
    return;
  }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.htyfmp.devtools.env.${xmlEscape(key.toLowerCase())}</string><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>${xmlEscape(key)}</string><string>${xmlEscape(value)}</string></array><key>RunAtLoad</key><true/></dict></plist>\n`;
  fs.writeFileSync(file, plist, {mode: 0o600});
  runRequired('/bin/launchctl', ['setenv', key, value], `无法写入 ${key}`);
  runRequired('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, file], `无法持久化 ${key}`);
  process.env[key] = value;
}

function writeValue(key, value) {
  if (process.platform === 'win32') return writeWindowsValue(key, value);
  if (process.platform === 'darwin') return writeMacValue(key, value);
  throw new Error(`暂不支持 ${process.platform} 的用户级环境变量写入`);
}

function getEnvironmentState() {
  const variables = getVariables();
  return {
    platform: process.platform,
    supported: process.platform === 'win32' || process.platform === 'darwin',
    restartRequired: true,
    variables,
    history: readHistory(),
    values: Object.fromEntries(variables.map(({key}) => [key, readValue(key)])),
  };
}

function setEnvironmentValues(values) {
  if (!values || typeof values !== 'object') throw new TypeError('环境变量配置必须是对象');
  const allowedKeys = new Set(getVariables().map(item => item.key));
  for (const [key, value] of Object.entries(values)) {
    if (!allowedKeys.has(key)) throw new Error(`不允许修改环境变量 ${key}`);
    if (value !== null && typeof value !== 'string') throw new TypeError(`${key} 必须是字符串或 null`);
  }
  const history = readHistory();
  for (const [key, value] of Object.entries(values)) {
    const normalized = value === null ? null : value.trim();
    const previous = readValue(key);
    writeValue(key, normalized);
    const candidates = [...(previous.exists ? [previous.value.trim()] : []), ...(history[key] || [])];
    if (normalized !== null) candidates.unshift(normalized);
    if (candidates.length) {
      history[key] = [...new Set(candidates)];
      saveHistory(history);
    }
  }
  if (process.platform === 'win32') broadcastWindowsEnvironmentChange();
  return getEnvironmentState();
}

module.exports = {ENVIRONMENT_VARIABLES, ENVIRONMENT_KEYS, getEnvironmentState, setEnvironmentValues, addEnvironmentVariable, deleteEnvironmentVariable};
