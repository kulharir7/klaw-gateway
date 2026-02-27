const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klawApp', {
  getGatewayStatus: () => ipcRenderer.invoke('get-gateway-status'),
  restartGateway: () => ipcRenderer.invoke('restart-gateway'),
  openPluginStore: () => ipcRenderer.send('open-plugin-store'),
  platform: process.platform,
  version: require('../package.json').version || '0.1.0',
  
  // Computer Use Agent
  computerUse: {
    start: (goal) => ipcRenderer.invoke('computer-use-start', goal),
    stop: () => ipcRenderer.invoke('computer-use-stop'),
    pause: () => ipcRenderer.invoke('computer-use-pause'),
    resume: () => ipcRenderer.invoke('computer-use-resume'),
    status: () => ipcRenderer.invoke('computer-use-status'),
    onEvent: (callback) => {
      ipcRenderer.on('computer-use-event', (event, data) => callback(data));
    },
    vault: {
      get: () => ipcRenderer.invoke('computer-use-vault-get'),
      save: (config) => ipcRenderer.invoke('computer-use-vault-save', config),
    },
  },

  // UI helpers
  flashFrame: () => ipcRenderer.send('flash-frame'),
});

