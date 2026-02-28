const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klawApp', {
  getGatewayStatus: () => ipcRenderer.invoke('get-gateway-status'),
  restartGateway: () => ipcRenderer.invoke('restart-gateway'),
  openPluginStore: () => ipcRenderer.send('open-plugin-store'),
  platform: process.platform,
  version: require('../package.json').version || '0.1.0',
  
  // Computer Use Agent
  computerUse: {
    start: (task) => ipcRenderer.invoke('computer-use:start', task),
    stop: () => ipcRenderer.invoke('computer-use:stop'),
    status: () => ipcRenderer.invoke('computer-use:status'),
    screenshot: () => ipcRenderer.invoke('computer-use:screenshot'),
    click: (x, y, opts) => ipcRenderer.invoke('computer-use:click', x, y, opts),
    type: (text) => ipcRenderer.invoke('computer-use:type', text),
    key: (combo) => ipcRenderer.invoke('computer-use:key', combo),
    scroll: (dir, amount) => ipcRenderer.invoke('computer-use:scroll', dir, amount),
    openApp: (name) => ipcRenderer.invoke('computer-use:open-app', name),
    openUrl: (url) => ipcRenderer.invoke('computer-use:open-url', url),
    vaultCheck: (url) => ipcRenderer.invoke('computer-use:vault-check', url),
    onStep: (callback) => {
      ipcRenderer.on('computer-use:step', (event, data) => callback(data));
    },
  },

  // Web Agent
  webAgent: {
    navigate: (url, task) => ipcRenderer.invoke('web-agent:navigate', url, task),
    login: (site, creds) => ipcRenderer.invoke('web-agent:login', site, creds),
  },

  // Earn Mode
  earnMode: {
    searchJobs: (opts) => ipcRenderer.invoke('earn-mode:search-jobs', opts),
    writeProposal: (job) => ipcRenderer.invoke('earn-mode:write-proposal', job),
    dashboard: () => ipcRenderer.invoke('earn-mode:dashboard'),
  },

  // Quick Chat
  quickChat: {
    hide: () => ipcRenderer.send('hide-quick-chat'),
  },

  // UI helpers
  flashFrame: () => ipcRenderer.send('flash-frame'),
});

