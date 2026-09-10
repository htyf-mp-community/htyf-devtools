let current;
function render(state) {
  current = state;
  document.querySelector('#status').textContent = state.status === 'listening' ? '调试服务已启动' : '调试服务暂不可用';
  document.querySelector('#url').textContent = state.lanReporterUrl || state.reporterUrl || '—';
  const targets = document.querySelector('#targets');
  targets.innerHTML = '';
  if (!state.runtimes.length) { targets.className = 'empty'; targets.textContent = '等待应用连接…'; return; }
  targets.className = '';
  for (const runtime of state.runtimes) {
    const row = document.createElement('div'); row.className = 'target';
    const label = document.createElement('span'); label.textContent = `${runtime.connected ? '●' : '○'} ${runtime.appName} · ${runtime.deviceName || runtime.platform}`;
    const button = document.createElement('button'); button.textContent = '打开调试器'; button.onclick = () => window.devtoolsHost.openRuntime(runtime.runtimeId);
    row.append(label, button); targets.append(row);
  }
}
window.devtoolsHost.getState().then(state => { document.querySelector('#qr').src = state.qr; render(state); });
window.devtoolsHost.onState(render);
document.querySelector('#copy').onclick = async event => {
  const url = current?.lanReporterUrl || current?.reporterUrl;
  if (!url) return;
  const button = event.currentTarget;
  const pairingConfig = JSON.stringify({
    type: 'htyf.devtools.pairing',
    version: 1,
    endpoint: url,
    token: current.requirePairing ? (current.pairingToken ?? '') : '',
  }, null, 2);
  try {
    await window.devtoolsHost.copy(pairingConfig);
    button.textContent = '已复制连接配置';
  } catch {
    button.textContent = '复制失败，请重试';
  }
  setTimeout(() => { button.textContent = '复制连接配置'; }, 1600);
};

document.querySelector('#environment').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await window.devtoolsHost.openEnvironment();
  } catch {
    button.textContent = '打开失败，请重试';
  } finally {
    button.disabled = false;
  }
};
