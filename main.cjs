const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, screen, shell, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { summarizeAppMetrics } = require('./system-health-metrics.cjs');
const { sanitizeAnalyticsEvent } = require('./analytics-core.cjs');
const posthogConfig = require('./posthog-config.cjs');

let posthogClient = null;
let posthogInitPromise = null;
let analyticsEnabled = false;

function captureAnalytics(eventName, properties) {
  if (!analyticsEnabled || !posthogClient) return false;
  const safeEvent = sanitizeAnalyticsEvent(eventName, properties);
  if (!safeEvent) return false;
  try {
    posthogClient.capture(safeEvent.event, {
      ...safeEvent.properties,
      app_version: app.getVersion(),
    });
    return true;
  } catch {
    return false;
  }
}

globalThis.mnAnalyticsCapture = captureAnalytics;

async function ensurePostHogClient() {
  if (posthogClient) return posthogClient;
  if (posthogInitPromise) return posthogInitPromise;
  posthogInitPromise = (async () => {
    if (!posthogConfig.projectToken || !posthogConfig.host) throw new Error('PostHog configuration is missing.');
    const { init } = require('@posthog/electron/main');
    const client = init({
      projectToken: posthogConfig.projectToken,
      host: posthogConfig.host,
      defaultOptIn: true,
      personProfiles: 'never',
      disableGeoip: true,
      disableRemoteFeatureFlags: true,
      disableRemoteConfig: true,
      captureAppLifecycleEvents: false,
      enableExceptionAutocapture: false,
      maxQueueAgeMs: 7 * 24 * 60 * 60 * 1000,
      maxQueueSize: 5000,
      maxStorageBytes: 5 * 1024 * 1024,
      storageDirectory: path.join(app.getPath('userData'), 'posthog'),
      appBuild: app.getVersion(),
      onError: () => console.warn('[Analytics] PostHog storage/transport issue (details hidden).'),
    });
    await client.ready();
    posthogClient = client;
    return client;
  })().catch((error) => {
    posthogInitPromise = null;
    throw error;
  });
  return posthogInitPromise;
}

async function startAnalytics() {
  try {
    const client = await ensurePostHogClient();
    await client.optIn();
    analyticsEnabled = true;
    captureAnalytics('app_launched', {
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron_version: process.versions.electron,
    });
    return { enabled: true };
  } catch (error) {
    analyticsEnabled = false;
    console.warn('[Analytics] Analytics could not start; the app will continue normally.');
    return { enabled: false };
  }
}

async function shutdownAnalytics() {
  analyticsEnabled = false;
  if (posthogClient) {
    try { await posthogClient.shutdown(1200); } catch {}
    posthogClient = null;
    posthogInitPromise = null;
  }
}

let mainWindow;
let installingUpdate = false;
let applyUpdateOnStartup = false;
async function installDownloadedUpdate() {
  if (installingUpdate || global.updateStatus.state !== 'downloaded') return;
  installingUpdate = true;
  try {
    await shutdownEngine();
    try { await shutdownAnalytics(); } catch { /* Keep queued telemetry on disk for the next launch. */ }
    isQuitting = true;
    isShuttingDown = true;
    autoUpdater.quitAndInstall(true, false);
  } catch (error) {
    installingUpdate = false;
    global.updateStatus.error = error.message;
  }
}
global.installDownloadedUpdate = installDownloadedUpdate;
require('./desktop-actions.cjs').registerLibraryActions({
  ipcMain, dialog, shell, isTrustedSender: isTrustedAppSender,
  getWindow: () => mainWindow,
  userData: () => app.getPath('userData'),
  getIcon: async (file) => {
    try {
      if (path.extname(file).toLowerCase() === '.ico') {
        const shortcutIcon = nativeImage.createFromPath(file);
        if (!shortcutIcon.isEmpty()) return shortcutIcon.toDataURL();
      }
      const image = await app.getFileIcon(file, { size: 'large' });
      return image.isEmpty() ? '' : image.toDataURL();
    } catch { return ''; }
  },
});

function isTrustedAppSender(event) {
  const senderUrl = event.senderFrame?.url || '';
  let trusted = app.isPackaged && senderUrl.startsWith('file://') && senderUrl.toLowerCase().includes('/dist/index.html');
  if (!trusted && !app.isPackaged) {
    try {
      const url = new URL(senderUrl);
      trusted = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '3000';
    } catch { trusted = false; }
  }
  return trusted;
}

ipcMain.handle('api:get-token', (event) => {
  if (!isTrustedAppSender(event) || !process.env.MN_API_TOKEN) {
    throw new Error('API access is only available to the MN Game Downloader window.');
  }
  return process.env.MN_API_TOKEN;
});

ipcMain.handle('analytics:capture', (event, eventName, properties) => {
  if (!isTrustedAppSender(event)) throw new Error('Analytics is only available to the MN Game Downloader window.');
  return captureAnalytics(eventName, properties);
});

let previousCpuSample = null;
ipcMain.handle('system:get-health', (event) => {
  if (!isTrustedAppSender(event)) throw new Error('System diagnostics are only available to the MN Game Downloader window.');
  const cpuTimes = os.cpus().map((cpu) => cpu.times);
  const total = cpuTimes.reduce((sum, item) => sum + item.user + item.nice + item.sys + item.idle + item.irq, 0);
  const idle = cpuTimes.reduce((sum, item) => sum + item.idle, 0);
  let cpuPercent = null;
  if (previousCpuSample) {
    const totalDelta = total - previousCpuSample.total;
    const idleDelta = idle - previousCpuSample.idle;
    if (totalDelta > 0) cpuPercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  }
  previousCpuSample = { total, idle };

  const appMetrics = app.getAppMetrics().map((item) => ({
    type: item.type,
    workingSetKB: Number(item.memory?.workingSetSize || 0),
    privateKB: Number(item.memory?.privateBytes || 0),
    cpuPercent: Number(item.cpu?.percentCPUUsage || 0),
  }));
  const appSummary = summarizeAppMetrics(appMetrics);

  return {
    sampledAt: new Date().toISOString(),
    cpu: { percent: cpuPercent, logicalCores: cpuTimes.length, model: os.cpus()[0]?.model || 'Unknown CPU' },
    memory: {
      totalBytes: os.totalmem(),
      availableBytes: os.freemem(),
      usedBytes: Math.max(0, os.totalmem() - os.freemem()),
    },
    app: appSummary,
  };
});

ipcMain.handle('system:open-game-mode-settings', async (event) => {
  if (!isTrustedAppSender(event)) throw new Error('Windows Game Mode settings are only available to the MN Game Downloader window.');
  if (process.platform !== 'win32') throw new Error('Windows Game Mode is only available on Windows.');
  await shell.openExternal('ms-settings:gaming-gamemode');
  return { ok: true };
});

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
      { host: '127.0.0.1', port: 3000, path: '/api/engine/shutdown', method: 'POST', headers: { 'X-MN-API-Token': process.env.MN_API_TOKEN || '' } },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', resolve);
    req.setTimeout(30000, () => { req.destroy(); resolve(); });
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

function waitForApiHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({
        host: '127.0.0.1',
        port: 3000,
        path: '/api/health',
        headers: { 'X-MN-API-Token': process.env.MN_API_TOKEN || '' },
      }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry(new Error(`Local API health check returned HTTP ${res.statusCode}.`));
      });
      req.setTimeout(1800, () => req.destroy(new Error('Local API health check timed out.')));
      req.on('error', retry);
    };
    const retry = (error) => {
      if (Date.now() >= deadline) return reject(error);
      setTimeout(attempt, 250);
    };
    attempt();
  });
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
  // Windows can report work-area coordinates in monitor pixels while BrowserWindow
  // expects device-independent pixels. Convert using the display scale factor so
  // 125%/150% scaling never creates an off-screen window.
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const rawWorkArea = display.workArea;
  const workArea = {
    x: Math.floor(rawWorkArea.x / scaleFactor),
    y: Math.floor(rawWorkArea.y / scaleFactor),
    width: Math.floor(rawWorkArea.width / scaleFactor),
    height: Math.floor(rawWorkArea.height / scaleFactor),
  };
  console.log('[Main] Display work area:', JSON.stringify({ raw: rawWorkArea, scaleFactor, dip: workArea }));
  const windowWidth = Math.min(1280, workArea.width);
  const windowHeight = Math.min(800, workArea.height);
  const windowX = workArea.x + Math.floor((workArea.width - windowWidth) / 2);
  const windowY = workArea.y + Math.floor((workArea.height - windowHeight) / 2);

  mainWindow = new BrowserWindow({
    x: windowX,
    y: windowY,
    width: windowWidth,
    height: windowHeight,
    minWidth: Math.min(760, windowWidth),
    minHeight: Math.min(600, windowHeight),
    title: 'MN Game Downloader',
    icon: getAppIconPath(),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') void require('electron').shell.openExternal(target.toString());
      else console.warn('[Main] Blocked external URL with unsupported protocol:', target.protocol);
    } catch { console.warn('[Main] Blocked malformed external URL.'); }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;
    if (app.isPackaged) allowed = targetUrl.startsWith('file://') && targetUrl.toLowerCase().includes('/dist/index.html');
    else {
      try {
        const target = new URL(targetUrl);
        allowed = target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port === '3000';
      } catch { allowed = false; }
    }
    if (!allowed) event.preventDefault();
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

app.on('ready', async () => {
  if (!gotTheLock) return;
  const marker = path.join(app.getPath('userData'), 'pending-update.json');
  try {
    const pending = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (pending.version === app.getVersion()) fs.unlinkSync(marker);
    else applyUpdateOnStartup = true;
  } catch {}
  createTray();

  // Keep all app data local. Development launcher shares a per-run token with
  // the API process; packaged mode generates a fresh secret in this process.
  process.env.MN_DATA_DIR = app.getPath('userData');
  process.env.MN_APP_VERSION = app.getVersion();
  if (app.isPackaged) {
    process.env.MN_API_TOKEN = crypto.randomBytes(32).toString('hex');
  } else if (!process.env.MN_API_TOKEN) {
    process.env.MN_API_TOKEN = crypto.randomBytes(32).toString('hex');
  }

  try {
    // Initialize durable analytics before packaged engines restore interrupted downloads.
    // In development the concurrently-started server already owns this port.
    await startAnalytics();
    if (app.isPackaged) startServer();
    await waitForApiHealth();
    createWindow();
  } catch (error) {
    console.error('[Main] Local API did not become ready:', error);
    dialog.showErrorBox('MN Game Downloader could not start', 'The local app service could not be verified. Close other software using port 3000 and try again. No external server was used.');
    app.quit();
    return;
  }

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
  try {
    await shutdownAnalytics();
  } catch { /* offline analytics queue remains on disk */ }
  app.exit(0);
});

app.on('window-all-closed', () => {
  // Let the app run in the background via Tray icon
});