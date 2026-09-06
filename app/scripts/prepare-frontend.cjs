const fs = require('node:fs');
const path = require('node:path');
const frontendSource = require('@react-native/debugger-frontend');

const destination = path.resolve(__dirname, '../frontend-dist');
// 复制预编译前端而非修改 node_modules，使依赖重装和打包结果保持可复现。
fs.rmSync(destination, {recursive: true, force: true});
fs.cpSync(frontendSource, destination, {recursive: true});

const htmlPath = path.join(destination, 'rn_fusebox.html');
const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<title>React Native DevTools</title>')) {
  throw new Error('Unsupported debugger frontend: title marker not found');
}
fs.writeFileSync(htmlPath, html.replace('<title>React Native DevTools</title>', '<title>红糖开发助手</title>'));

const upstreamWelcome = path.join(destination, 'panels/rn_welcome/rn_welcome.js');
if (!fs.existsSync(upstreamWelcome)) {
  throw new Error('Unsupported debugger frontend: Welcome component not found');
}
// 直接替换上游 Welcome 模块，避免运行时注入、DOM 隐藏和重绘时序问题。
fs.copyFileSync(path.resolve(__dirname, '../src/htyf-rn-welcome.js'), upstreamWelcome);

const hostPath = path.join(destination, 'core/host/host.js');
let host = fs.readFileSync(hostPath, 'utf8');
const browserCopy = 'copyText(e){null!=e&&navigator.clipboard.writeText(e)}';
if (host.split(browserCopy).length !== 2) {
  throw new Error('Unsupported debugger frontend: clipboard host marker not found or ambiguous');
}
// 局域网 HTTP 页面没有浏览器 Clipboard API，面板复制统一走 Electron 的窄接口。
// 保留浏览器模式的原有行为，不改变 Network 等面板生成的复制内容。
host = host.replace(browserCopy, 'copyText(e){if(null!=e)return window.devtoolsHost?.copy?window.devtoolsHost.copy(e):navigator.clipboard.writeText(e)}');
fs.writeFileSync(hostPath, host);

const entryPath = path.join(destination, 'entrypoints/rn_fusebox/rn_fusebox.js');
let entry = fs.readFileSync(entryPath, 'utf8');
const removeSection = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Unsupported debugger frontend: ${label} registration markers not found`);
  }
  return source.slice(0, start) + source.slice(end);
};
// 当前产品暂不提供 React 组件树和 React Profiler，直接移除面板注册，
// 而不是在渲染完成后隐藏标签，避免创建无效 View 和加载相关模块。
entry = removeSection(entry, 'const J={title:"Components ⚛"', 'const te={title:"Profiler ⚛"', 'Components');
entry = removeSection(entry, 'const te={title:"Profiler ⚛"', 'const ae={rnWelcome:', 'Profiler');
fs.writeFileSync(entryPath, entry);

const networkPath = path.join(destination, 'panels/network/network.js');
let network = fs.readFileSync(networkPath, 'utf8');
const compactCategories = 'this.isReactNative?t.ResourceType.resourceCategoriesReactNative:t.ResourceType.resourceCategories';
if (!network.includes(compactCategories)) {
  throw new Error('Unsupported debugger frontend: compact Network categories marker not found');
}
// 使用 Chrome 完整资源分类，恢复 Socket 筛选，同时保留其余 RN Network 行为。
network = network.replace(compactCategories, 't.ResourceType.resourceCategories');
fs.writeFileSync(networkPath, network);
console.log(`Prepared customized DevTools frontend at ${destination}`);
