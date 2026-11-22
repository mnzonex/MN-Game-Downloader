const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Engine status events from main process
  ipcRenderer: {
    on: (channel, listener) => {
      const validChannels = ['engine-status', 'update-available', 'update-progress', 'update-downloaded'];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, listener);
      }
    },
    removeListener: (channel, listener) => {
      ipcRenderer.removeListener(channel, listener);
    },
  },

  // Per-launch API credential; only the trusted app window can request it.
  getApiToken: () => ipcRenderer.invoke('api:get-token'),
  analytics: {
    capture: (eventName, properties) => ipcRenderer.invoke('analytics:capture', eventName, properties),
  },
  getSystemHealth: () => ipcRenderer.invoke('system:get-health'),
  openGameModeSettings: () => ipcRenderer.invoke('system:open-game-mode-settings'),

  // Native directory picker
  showOpenDialog: (title) => ipcRenderer.invoke('dialog:openDirectory', title),
  chooseGameExecutable: (id) => ipcRenderer.invoke('library:choose-executable', id),
  getInstalledGames: (refresh = false) => ipcRenderer.invoke('library:installed-games', { refresh }),
  launchInstalledGame: (id) => ipcRenderer.invoke('library:play-installed', id),
  chooseManualGameLauncher: () => ipcRenderer.invoke('library:choose-manual-launcher'),
  addManualGame: (name, launcherPath) => ipcRenderer.invoke('library:add-manual-game', { name, launcherPath }),
  removeManualGame: (id) => ipcRenderer.invoke('library:remove-manual-game', id),
  chooseManualGameCover: (id) => ipcRenderer.invoke('library:choose-manual-cover', id),
  launchGame: (id, action) => ipcRenderer.invoke('library:launch', { id, action }),
  getLaunchJobs: () => ipcRenderer.invoke('library:jobs'),

  // Native Windows notification
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),

});