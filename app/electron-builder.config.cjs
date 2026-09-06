const {getUpdateUrl} = require('./src/update-config.cjs');
const updateUrl = getUpdateUrl();

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.dagouzhi.mp.devtools',
  productName: '红糖开发助手',
  asar: true,
  // 更新清单写入 output，必须与安装包使用同一个版本/系统目录。
  directories: {output: 'release/v${version}/${os}', buildResources: 'build'},
  files: ['src/**/*', 'frontend-dist/**/*', 'package.json'],
  artifactName: 'latest.${ext}',
  publish: [{provider: 'generic', url: updateUrl}],
  generateUpdatesFilesForAllChannels: true,
  dmg: {title: '红糖开发助手'},
  mac: {
    notarize: true,
    hardenedRuntime: true,
    executableName: '红糖开发助手',
    icon: 'build/icon.png',
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '11.0',
    target: [
      {target: 'dmg', arch: ['universal']},
      {target: 'zip', arch: ['universal']},
    ],
  },
  win: {
    executableName: '红糖开发助手',
    icon: 'build/icon.png',
    requestedExecutionLevel: 'asInvoker',
    target: [{target: 'nsis', arch: ['x64']}, {target: 'zip', arch: ['x64']}],
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '红糖开发助手',
    uninstallDisplayName: '红糖开发助手',
  },
};
