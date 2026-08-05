const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;

// Configure autoUpdater for private GitHub repository updates
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for updates on GitHub (mnzonex/MN-Game-Downloader)...');
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] Application is up to date.');
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`[AutoUpdater] Download speed: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded successfully; ready to install.');
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Update error:', err);
});

ipcMain.on('restart-and-install', () => {
  autoUpdater.quitAndInstall();
});

// Force production environment flags
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

// Start Express API server if not already running
function startServer() {
  const candidatePaths = [
    path.join(__dirname, 'dist', 'server.cjs'),
    path.join(app.getAppPath(), 'dist', 'server.cjs'),
    path.join(process.resourcesPath, 'dist', 'server.cjs'),
    path.join(process.resourcesPath, 'server.cjs'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'server.cjs'),
    path.join(__dirname, 'server.ts')
  ];

  for (const sPath of candidatePaths) {
    if (fs.existsSync(sPath)) {
      try {
        console.log('[Main Process] Initializing Express server bundle from:', sPath);
        require(sPath);
        console.log('[Main Process] Express server initialized successfully.');
        return;
      } catch (err) {
        console.error('[Main Process] Error initializing server at:', sPath, err);
      }
    }
  }

  console.error('[Main Process] Warning: Could not locate server bundle on disk.');
}

function getAppIconPath() {
  const iconPaths = [
    path.join(__dirname, 'icon.ico'),
    path.join(app.getAppPath(), 'icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(app.getAppPath(), 'icon.png')
  ];
  for (const p of iconPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "MN Game Downloader",
    icon: iconPath,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // --- Loading Logic ---
  if (app.isPackaged) {
    // PRODUCTION (Build EXE): Load index.html directly from dist
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html')).catch(err => {
      console.error('[Main Process] Failed to load HTML:', err);
    });
  } else {
    // DEV MODE: Load from local dev server
    let retryTimer = null;
    const loadApp = () => {
      mainWindow.loadURL('http://127.0.0.1:3000').catch((err) => { 
        console.log('[Main Process] Waiting for dev server...', err?.message || err);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(loadApp, 500);
      });
    };

    // Retry if load fails
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.log(`[Main Process] Page load deferred (${errorCode}: ${errorDescription}), retrying...`);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(loadApp, 500);
    });

    loadApp();
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // First check if server is already running on port 3000
  http.get('http://127.0.0.1:3000/api/version', (res) => {
    if (res.statusCode === 200) {
      console.log('[Main Process] Express backend is already online.');
    } else {
      startServer();
    }
    createWindow();
  }).on('error', () => {
    startServer();
    createWindow();
  });

  // Check for updates if packaged app
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('Failed to check for updates:', err);
      });
    }, 4000);
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
