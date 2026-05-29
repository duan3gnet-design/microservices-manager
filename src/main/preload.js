const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // OIDC
  openBrowser: (url) => ipcRenderer.invoke('oidc:open-browser', url),
  startCallbackServer: (port) => ipcRenderer.invoke('oidc:start-callback-server', port),
  stopCallbackServer: () => ipcRenderer.invoke('oidc:stop-callback-server'),
  onOidcCallback: (cb) => ipcRenderer.on('oidc:callback', (_, data) => cb(data)),
  removeOidcCallback: () => ipcRenderer.removeAllListeners('oidc:callback'),

  // K8s API proxy
  k8sFetch: (opts) => ipcRenderer.invoke('k8s:fetch', opts),

  // Certificate generation
  generateCert: (opts) => ipcRenderer.invoke('cert:generate', opts),
  saveCertFile: (opts) => ipcRenderer.invoke('cert:save-file', opts),

  // Platform
  platform: process.platform,
})
