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

  // Native directory picker
  showOpenDialog: (title) => ipcRenderer.invoke('dialog:openDirectory', title),
  chooseGameExecutable: (id) => ipcRenderer.invoke('library:choose-executable', id),
  launchGame: (id, action) => ipcRenderer.invoke('library:launch', { id, action }),
  getLaunchJobs: () => ipcRenderer.invoke('library:jobs'),

  // Native Windows notification
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),

  // Add Windows Defender exclusions
  addDefenderExclusion: (paths) => ipcRenderer.invoke('add-defender-exclusion', paths),
});