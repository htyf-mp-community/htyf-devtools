import * as SDK from '../../core/sdk/sdk.js';
import * as UI from '../../ui/legacy/legacy.js';

const styles = {cssText: `
  .htyf-welcome{--brand:#d9483b;--brand-hover:#bd352c;--amber:#e99317;--green:#18864b;width:100%;height:100%;min-width:0;min-height:0;display:grid!important;place-items:center;padding:48px 36px;background:radial-gradient(circle at 50% 44%,color-mix(in srgb,var(--brand) 5%,transparent),transparent 42%),var(--color-background);overflow:auto}
  .htyf-card{width:min(760px,94vw);border:1px solid color-mix(in srgb,var(--sys-color-divider) 82%,transparent);border-radius:18px;background:var(--sys-color-base);color:var(--color-text-primary);box-shadow:0 24px 64px rgba(25,31,40,.10),0 2px 8px rgba(25,31,40,.04);overflow:hidden}
  .htyf-card *{box-sizing:border-box}.htyf-header{display:flex;gap:16px;align-items:center;padding:24px 26px;border-bottom:1px solid var(--sys-color-divider)}
  .htyf-mark{display:grid;place-items:center;flex:0 0 46px;width:46px;height:46px;border-radius:13px;background:#fff1ed;color:var(--brand)}.htyf-mark svg{width:30px;height:30px}.htyf-heading{min-width:0;flex:1}
  .htyf-status{display:flex;align-items:center;gap:7px;margin-bottom:3px;color:var(--green);font-size:11px;font-weight:600}.htyf-status.waiting{color:var(--amber)}.htyf-status.unavailable{color:var(--brand)}.htyf-status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 14%,transparent)}
  .htyf-title{margin:0;font-size:20px;line-height:1.35;font-weight:650}.htyf-description{margin:5px 0 0;color:var(--color-text-secondary);font-size:12px;line-height:1.55}.htyf-chips{display:flex;flex-wrap:wrap;gap:7px}.htyf-chip{padding:5px 10px;border:1px solid var(--sys-color-divider);border-radius:999px;color:var(--color-text-secondary);background:color-mix(in srgb,var(--sys-color-surface2) 60%,transparent);font-size:10px;font-weight:600}
  .htyf-content{display:grid;grid-template-columns:184px minmax(0,1fr);gap:28px;padding:28px 30px 26px}.htyf-qr-panel{text-align:center}.htyf-qr-frame{display:inline-flex;padding:12px;border:1px solid var(--sys-color-divider);border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(25,31,40,.05)}.htyf-qr{display:block;width:148px;height:148px}.htyf-qr-label{margin:10px 0 0;color:var(--color-text-secondary);font-size:11px}.htyf-config{min-width:0;padding-top:2px}.htyf-field{margin-bottom:12px}.htyf-label{display:block;margin-bottom:6px;color:var(--color-text-secondary);font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}.htyf-code{display:block;width:100%;min-height:40px;padding:11px 12px;border:1px solid transparent;border-radius:8px;background:var(--sys-color-surface2);font:11px/1.45 var(--monospace-font-family);overflow-wrap:anywhere;user-select:all}
  .htyf-input{display:block;width:100%;height:40px;padding:9px 12px;border:1px solid transparent;border-radius:8px;background:var(--sys-color-surface2);color:var(--color-text-primary);font:11px/1.45 var(--monospace-font-family)}.htyf-input:hover{border-color:var(--sys-color-divider)}.htyf-input:focus{border-color:var(--brand);outline:2px solid color-mix(in srgb,var(--brand) 18%,transparent)}.htyf-actions{display:flex;gap:9px}.htyf-copy,.htyf-update{min-height:40px;padding:9px 16px;border-radius:8px;font-weight:600;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease}.htyf-copy{border:1px solid var(--brand-hover);background:var(--brand);color:#fff}.htyf-copy:hover{background:var(--brand-hover)}.htyf-update{border:1px solid var(--sys-color-divider);background:var(--sys-color-base);color:var(--color-text-primary)}.htyf-update:hover{background:var(--sys-color-surface2)}.htyf-copy:focus-visible,.htyf-update:focus-visible{outline:2px solid var(--amber);outline-offset:2px}.htyf-guide{display:flex;align-items:center;gap:7px;margin-top:12px;color:var(--color-text-secondary);font-size:10px}.htyf-step{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;background:#fff3ef;color:var(--brand);font-weight:700}.htyf-arrow{opacity:.45}
  .htyf-footer{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 30px;border-top:1px solid var(--sys-color-divider);background:color-mix(in srgb,var(--sys-color-surface2) 45%,transparent);color:var(--color-text-secondary);font-size:10px}.htyf-footer strong{display:flex;align-items:center;gap:7px;color:var(--color-text-primary);font-weight:600}.htyf-footer strong::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green)}.htyf-footer span{white-space:nowrap}
  @media(max-width:620px){.htyf-welcome{padding:24px}.htyf-chips{display:none}.htyf-content{grid-template-columns:1fr}.htyf-qr-panel{text-align:left}.htyf-guide{flex-wrap:wrap}.htyf-footer{align-items:flex-start;flex-direction:column;gap:5px}.htyf-footer span{white-space:normal}}@media(prefers-color-scheme:dark){.htyf-card{box-shadow:0 20px 56px rgba(0,0,0,.28)}.htyf-mark,.htyf-step{background:rgba(217,72,59,.16)}.htyf-qr-frame{box-shadow:none}}@media(prefers-reduced-motion:reduce){.htyf-copy,.htyf-update{transition:none}}
  /*# sourceURL=${import.meta.resolve('./htyfWelcome.css')} */
`};

let instance;

class HTYFWelcome extends UI.Widget.VBox {
  #state;
  #isProfilingBuild = false;
  #removeStateListener;

  static instance() {
    return instance || (instance = new HTYFWelcome());
  }

  constructor() {
    super(true, true);
    this.registerRequiredCSS(styles);
    // 直接使用 DevTools Widget 的内容节点作为布局容器，避免额外包装 DOM。
    this.contentElement.classList.add('htyf-welcome');
    SDK.TargetManager.TargetManager.instance().observeModels(
      SDK.ReactNativeApplicationModel.ReactNativeApplicationModel,
      this,
    );
  }

  wasShown() {
    super.wasShown();
    // Widget 会在 Runtime 页面与 Welcome 之间复用，每次显示先丢弃旧会话状态。
    this.#state = undefined;
    this.#render();
    void this.#loadState();
    this.#removeStateListener?.();
    this.#removeStateListener = window.devtoolsHost?.onState?.(() => void this.#loadState());
    if (!this.#isProfilingBuild) {
      UI.InspectorView.InspectorView.instance().showDrawer({focus: true, hasTargetDrawer: false});
    }
  }

  willHide() {
    this.#removeStateListener?.();
    this.#removeStateListener = undefined;
    super.willHide();
  }

  modelAdded(model) {
    model.ensureEnabled();
    this.#isProfilingBuild = model.metadataCached?.unstable_isProfilingBuild || false;
  }

  modelRemoved() {}

  async #loadState() {
    try {
      this.#state = window.devtoolsHost?.getState
        ? await window.devtoolsHost.getState()
        : await fetch('/state').then(response => response.json());
    } catch {
      this.#state = {status: 'unavailable'};
    }
    this.#render();
  }

  #render() {
    const reporterUrl = this.#state?.lanReporterUrl || this.#state?.reporterUrl || '正在获取服务地址…';
    const token = this.#state?.requirePairing ? (this.#state?.pairingToken ?? '') : '无需 Token';
    const available = this.#state?.status !== 'unavailable';
    const connectedCount = this.#state?.runtimes?.filter(runtime => runtime.connected).length || 0;
    const statusText = !available
      ? '调试服务暂不可用'
      : connectedCount > 0
        ? `已连接 ${connectedCount} 个应用`
        : '等待应用连接';
    const statusClass = !available ? 'unavailable' : connectedCount > 0 ? 'connected' : 'waiting';
    // 仅显示帮助文案，不执行 PowerShell/netsh 检测，避免系统权限检查影响程序启动。
    const connectionHint = navigator.userAgent.includes('Windows')
      ? '如手机无法连接，请在 Windows 防火墙中允许本应用访问专用网络'
      : '连接信息仅在当前局域网内传输';
    this.contentElement.innerHTML = `
        <section class="htyf-card" aria-labelledby="htyf-title">
          <header class="htyf-header">
            <span class="htyf-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M7 10.5A9 9 0 0 1 22.2 7L25 4.5v8.2A9 9 0 0 1 10.4 22l-3.9 2.7 1.3-5.1A9 9 0 0 1 7 10.5Z" fill="currentColor"/><path d="M12 12.5h8M12 16h5" stroke="white" stroke-width="2" stroke-linecap="round"/></svg></span>
            <div class="htyf-heading"><div class="htyf-status ${statusClass}">${statusText}</div><h1 class="htyf-title" id="htyf-title">红糖开发助手</h1><p class="htyf-description">连接应用，统一查看日志、网络请求与实时通信数据。</p></div>
            <div class="htyf-chips" aria-label="支持的调试能力"><span class="htyf-chip">Console</span><span class="htyf-chip">Network</span><span class="htyf-chip">WebSocket</span></div>
          </header>
          <div class="htyf-content"><div class="htyf-qr-panel"><span class="htyf-qr-frame"><img class="htyf-qr" src="${this.#state?.qr || '/pairing.svg'}" alt="红糖云服调试服务连接二维码"></span><p class="htyf-qr-label">使用 App 扫码快速连接</p></div><div class="htyf-config"><div class="htyf-field"><span class="htyf-label">服务地址</span><code class="htyf-code endpoint"></code></div><div class="htyf-field"><label class="htyf-label" for="htyf-token">连接凭证</label><input class="htyf-input token" id="htyf-token" type="text" autocomplete="off" spellcheck="false"></div><div class="htyf-actions"><button class="htyf-copy" type="button">复制连接配置</button><button class="htyf-update" type="button">更新凭证</button></div><div class="htyf-guide"><span class="htyf-step">1</span>打开设置<span class="htyf-arrow">→</span><span class="htyf-step">2</span>进入 DevTools<span class="htyf-arrow">→</span><span class="htyf-step">3</span>扫码并开启</div></div></div>
          <footer class="htyf-footer"><strong>${available ? '局域网调试服务运行中' : '调试服务不可用'}</strong><span>${connectedCount > 0 ? `${connectedCount} 个应用已连接，可从“运行时”菜单切换` : connectionHint}</span></footer>
        </section>`;
    this.contentElement.querySelector('.endpoint').textContent = reporterUrl;
    this.contentElement.querySelector('.token').value = token;
    this.contentElement.querySelector('.htyf-copy').addEventListener('click', event => void this.#copy(event.currentTarget));
    this.contentElement.querySelector('.htyf-update').addEventListener('click', event => void this.#updateToken(event.currentTarget));
  }

  async #copy(button) {
    const endpoint = this.#state?.lanReporterUrl || this.#state?.reporterUrl;
    if (!endpoint) return;
    const config = JSON.stringify({type: 'htyf.devtools.pairing', version: 1, endpoint, token: this.#state?.pairingToken ?? ''}, null, 2);
    try {
      if (window.devtoolsHost?.copy) await window.devtoolsHost.copy(config);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(config);
      else throw new Error('Clipboard API is unavailable');
      button.textContent = '已复制连接配置';
    } catch {
      button.textContent = '复制失败，请重试';
    }
    setTimeout(() => { button.textContent = '复制连接配置'; }, 1600);
  }

  async #updateToken(button) {
    const token = this.contentElement.querySelector('.token').value;
    try {
      this.#state = await window.devtoolsHost.setPairingToken(token);
      this.#render();
      const nextButton = this.contentElement.querySelector('.htyf-update');
      nextButton.textContent = '凭证已更新';
      setTimeout(() => { nextButton.textContent = '更新凭证'; }, 1600);
    } catch {
      button.textContent = '更新失败，请重试';
      setTimeout(() => { button.textContent = '更新凭证'; }, 1600);
    }
  }
}

const RNWelcome = Object.freeze({RNWelcomeImpl: HTYFWelcome});
export {RNWelcome};
