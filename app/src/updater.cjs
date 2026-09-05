const {app, dialog} = require('electron');
const {autoUpdater} = require('electron-updater');
const {getUpdateUrl} = require('./update-config.cjs');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 自动更新是旁路能力：任何配置或网络错误都不能影响调试服务。 */
function createAutoUpdateController(getWindow) {
  let timer;
  let started = false;
  const showMessage = options => {
    const owner = getWindow();
    return owner && !owner.isDestroyed() ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
  };

  const check = async ({interactive = false} = {}) => {
    if (!started) {
      if (interactive) await showMessage({type: 'info', title: '检查更新', message: '当前版本未配置自动更新地址。'});
      return undefined;
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (interactive && !result?.updateInfo) {
        await showMessage({type: 'info', title: '检查更新', message: '当前已是最新版本。'});
      }
      return result;
    } catch (error) {
      console.warn('[updater] check failed', error);
      if (interactive) await showMessage({type: 'warning', title: '检查更新失败', message: error?.message || String(error)});
      return undefined;
    }
  };

  const start = () => {
    if (started) return;
    const configuredUrl = getUpdateUrl();
    const developmentEnabled = process.env.HTYF_DEVTOOLS_AUTO_UPDATE === '1';
    if (!app.isPackaged && !developmentEnabled) return;
    started = true;
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // 环境变量可覆盖默认 COS 地址；显式设置 feed 也让开发模式与安装包行为一致。
    autoUpdater.setFeedURL({provider: 'generic', url: configuredUrl});
    // electron-updater 的 error 是 EventEmitter 特殊事件；必须注册监听，避免
    // 更新服务器故障演变为桌面主进程未捕获异常。
    autoUpdater.on('error', error => console.warn('[updater] error', error));
    autoUpdater.on('update-downloaded', async info => {
      const result = await showMessage({
        type: 'info',
        title: '更新已下载',
        message: `红糖开发助手 ${info.version} 已准备完成。`,
        detail: '是否立即重启并安装？',
        buttons: ['立即重启', '退出时安装'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    });
    setTimeout(() => void check(), 3000).unref();
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    timer.unref();
  };

  return {
    start,
    check: () => check({interactive: true}),
    stop() { if (timer) clearInterval(timer); timer = undefined; },
  };
}

module.exports = {createAutoUpdateController};
