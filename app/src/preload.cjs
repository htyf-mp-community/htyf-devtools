const {contextBridge, ipcRenderer} = require('electron');

// 仅暴露桌面前端所需的窄接口；renderer 无法直接访问 Node 或 Electron。
contextBridge.exposeInMainWorld('devtoolsHost', {
  getState: () => ipcRenderer.invoke('devtools:get-state'),
  setPairingToken: token => ipcRenderer.invoke('devtools:set-pairing-token', token),
  openRuntime: runtimeId => ipcRenderer.invoke('devtools:open-runtime', runtimeId),
  copy: text => ipcRenderer.invoke('devtools:copy', text),
  openWebsite: () => ipcRenderer.invoke('devtools:open-website'),
  getEnvironment: () => ipcRenderer.invoke('devtools:environment:get'),
  setEnvironment: values => ipcRenderer.invoke('devtools:environment:set', values),
  addEnvironmentVariable: variable => ipcRenderer.invoke('devtools:environment:add', variable),
  onState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('devtools:state', handler);
    return () => ipcRenderer.removeListener('devtools:state', handler);
  },
});
