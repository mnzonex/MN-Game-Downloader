const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

async function updaterTest() {
  const app = new EventEmitter(); app.requestSingleInstanceLock = () => true;
  app.getPath = () => 'C:\\TestData'; app.getVersion = () => '1.2.0';
  app.getAppMetrics = () => [
    { type: 'Browser', memory: { workingSetSize: 204800, privateBytes: 170000 }, cpu: { percentCPUUsage: 0.8 } },
    { type: 'Renderer', memory: { workingSetSize: 153600, privateBytes: 140000 }, cpu: { percentCPUUsage: 0.4 } },
    { type: 'GPU', memory: { workingSetSize: 81920, privateBytes: 60000 }, cpu: { percentCPUUsage: 0.2 } },
    { type: 'Utility', memory: { workingSetSize: 40960, privateBytes: 32000 }, cpu: { percentCPUUsage: 0.1 } },
  ];
  const openedUrls = [];
  const events = [];
  app.exit = () => events.push('exit'); app.quit = () => events.push('quit');
  const updater = new EventEmitter(); updater.quitAndInstall = (...args) => events.push(['install', ...args]);
  const ipcHandlers = new Map();
  const apiToken = 'desktop-test-token';
  const context = { console, Buffer, URL, setTimeout, clearTimeout, global: {},
    process: { env: { MN_API_TOKEN: apiToken }, platform: 'win32' }, __dirname: process.cwd() };
  context.require = name => {
    if (name === 'crypto') return require('crypto');
    if (name === 'electron') return { app, ipcMain: { on() {}, handle(name, callback) { ipcHandlers.set(name, callback); } }, dialog: {}, shell: { openExternal: async url => openedUrls.push(url) }, BrowserWindow: class {}, Notification: {}, Tray: class {}, Menu: {} };
    if (name === 'electron-updater') return { autoUpdater: updater };
    if (name === 'path') return path;
    if (name === 'os') return require('os');
    if (name === 'fs') return { writeFileSync() { events.push('marker'); }, existsSync() { return false; } };
    if (name === './desktop-actions.cjs') return { registerLibraryActions() {} };
    if (name === './system-health-metrics.cjs') return require('../system-health-metrics.cjs');
    if (name === './analytics-core.cjs') return { sanitizeAnalyticsEvent: () => null };
    if (name === './posthog-config.cjs') return { projectToken: 'test-ingestion-token', host: 'https://us.i.posthog.com' };
    if (name === 'http') return { request(_opts, callback) {
      const req = new EventEmitter(); req.setTimeout = () => {}; req.end = () => {
        events.push('save-resume'); const res = new EventEmitter(); res.resume = () => {};
        callback(res); setTimeout(() => { events.push('saved'); res.emit('end'); }, 5);
      }; return req;
    } };
    throw new Error('Unexpected module ' + name);
  };
  vm.runInNewContext(fs.readFileSync('main.cjs', 'utf8'), context);
  const trustedEvent = { senderFrame: { url: 'http://127.0.0.1:3000/' } };
  const getApiToken = ipcHandlers.get('api:get-token');
  assert.equal(getApiToken(trustedEvent), apiToken);
  assert.throws(() => getApiToken({ senderFrame: { url: 'https://untrusted.example/' } }), /API access is only available/);

  const health = ipcHandlers.get('system:get-health')(trustedEvent);
  assert.equal(health.app.mainProcessWorkingSetMB, 200);
  assert.equal(health.app.helperProcessesWorkingSetMB, 270);
  assert.equal(health.app.totalWorkingSetMB, 470);
  assert.equal(health.app.processCount, 4);
  assert.throws(() => ipcHandlers.get('system:get-health')({ senderFrame: { url: 'https://untrusted.example/' } }), /System diagnostics/);
  await ipcHandlers.get('system:open-game-mode-settings')(trustedEvent);
  assert.deepEqual(openedUrls, ['ms-settings:gaming-gamemode']);
  assert.equal(ipcHandlers.has('system:clear-cache'), false, 'the cache-clear IPC is removed');
  updater.emit('update-downloaded', { version: '1.3.0' });
  await context.global.installDownloadedUpdate();
  assert.deepEqual(events, ['marker', 'save-resume', 'saved', ['install', true, false]]);
  await context.global.installDownloadedUpdate();
  assert.equal(events.filter(e => Array.isArray(e)).length, 1);
  assert.equal(updater.autoInstallOnAppQuit, false, 'only controlled shutdown performs installation');
}
async function launcherTest() {
  const handlers = new Map(); let minimized = false; let spawned;
  const folder = path.resolve('.test-data', 'desktop-' + Date.now()); fs.mkdirSync(folder, { recursive: true });
  const exe = path.join(folder, 'game.exe'); fs.writeFileSync(exe, 'test fixture, never executed');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('desktop-actions.cjs', 'utf8'), {
    module, console, Date, global: { libraryActions: { get: () => ({ id: 'test', name: 'Fixture game', executable: exe, installer: exe }) } },
    require: name => name === 'child_process' ? { spawn(file, args, options) {
      assert.equal(file, exe); assert.equal(options.shell, false);
      spawned = new EventEmitter(); spawned.stdout = new EventEmitter(); spawned.stderr = new EventEmitter(); spawned.pid = 123;
      setImmediate(() => spawned.emit('spawn')); return spawned;
    } } : name === './installed-games.cjs' ? require('../installed-games.cjs') : require(name),
  });
  module.exports.registerLibraryActions({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    dialog: {}, getWindow: () => ({ minimize: () => { minimized = true; } }), userData: () => folder });
  const job = await handlers.get('library:launch')(null, { id: 'test', action: 'play' });
  assert(minimized); assert.equal(job.state, 'running');
  spawned.stderr.emit('data', Buffer.from('DirectX DLL error example'));
  spawned.emit('exit', 1);
  assert.equal(job.state, 'failed'); assert(job.messages.some(m => m.includes('DirectX DLL')));
  assert(fs.existsSync(path.join(folder, 'launch-logs', job.id + '.json')));
}
async function manualLibraryActionsTest() {
  const handlers = new Map();
  const folder = path.resolve('.test-data', 'manual-library-' + Date.now());
  fs.mkdirSync(folder, { recursive: true });
  const exe = path.join(folder, 'manual-game.exe'); fs.writeFileSync(exe, 'fixture, never executed');
  const shortcut = path.join(folder, 'desktop-game.lnk'); fs.writeFileSync(shortcut, 'shortcut fixture');
  const iconFile = path.join(folder, 'game-icon.ico'); fs.writeFileSync(iconFile, 'icon fixture');
  const iconRequests = [];
  const cover = path.join(folder, 'cover.png'); fs.writeFileSync(cover, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]));
  const manual = []; const openedPaths = []; let dialogCall = 0; let minimized = false; let savedCoverPath = '';
  const fakeGlobal = { libraryActions: {
    listManual: () => manual,
    addManual(name, launcherPath) { const item = { id: 'manual-' + String(manual.length + 1).padStart(24, '0'), name, launcherPath, addedAt: Date.now() }; manual.push(item); return item; },
    setManualCover(id, coverPath) { const item = manual.find(game => game.id === id); item.coverPath = coverPath; savedCoverPath = coverPath; return item; },
    removeManual(id) { const index = manual.findIndex(game => game.id === id); if (index < 0) return false; manual.splice(index, 1); return true; },
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('desktop-actions.cjs', 'utf8'), {
    module, console, Date, Buffer, process: { platform: 'win32' }, global: fakeGlobal,
    require: name => name === 'child_process' ? { spawn(file, args, options) {
      assert.equal(file, exe); assert.equal(options.shell, false);
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 444;
      setImmediate(() => child.emit('spawn')); return child;
    } } : name === './installed-games.cjs' ? { discoverInstalledGames: async () => [] } : require(name),
  });
  const dialog = { async showOpenDialog() {
    dialogCall += 1;
    return { canceled: false, filePaths: [dialogCall === 1 ? shortcut : cover] };
  } };
  const shell = {
    readShortcutLink: value => ({ target: exe, icon: iconFile, args: '', cwd: folder }),
    async openPath(value) { openedPaths.push(value); return ''; },
  };
  module.exports.registerLibraryActions({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    dialog, getWindow: () => ({ minimize: () => { minimized = true; } }),
    userData: () => folder, isTrustedSender: () => true,
    getIcon: async file => { iconRequests.push(file); return path.extname(file).toLowerCase() === '.ico' ? 'data:image/png;base64,game-icon' : 'data:image/png;base64,windows-icon'; },
    shell,
  });
  const chosen = await handlers.get('library:choose-manual-launcher')({});
  assert.equal(chosen, shortcut, 'Browse supports Windows desktop shortcut paths');
  const added = await handlers.get('library:add-manual-game')({}, { name: 'Shortcut Game', launcherPath: shortcut });
  assert.equal(added.name, 'Shortcut Game');
  const gamesBeforeCover = await handlers.get('library:installed-games')({});
  assert.equal(gamesBeforeCover[0].isManual, true);
  assert.equal(gamesBeforeCover[0].source, 'Manual');
  assert.equal(gamesBeforeCover[0].iconDataUrl, 'data:image/png;base64,game-icon', 'a Windows shortcut uses the game-specific .ico path before its emulator target');
  assert.equal(iconRequests[0], iconFile, 'game shortcut icon is preferred over the emulator executable icon');
  const coverResult = await handlers.get('library:choose-manual-cover')({}, added.id);
  assert.equal(coverResult.ok, true);
  const gamesAfterCover = await handlers.get('library:installed-games')({});
  assert(gamesAfterCover[0].coverDataUrl.startsWith('data:image/png;base64,'), 'uploaded cover is returned as a renderer-safe data URL');
  assert.equal(gamesAfterCover[0].iconDataUrl, 'data:image/png;base64,game-icon', 'the Windows game icon remains available if the uploaded cover fails to load');
  const shortcutJob = await handlers.get('library:play-installed')({}, added.id);
  assert.equal(shortcutJob.state, 'launched');
  assert.deepEqual(openedPaths, [shortcut], 'shortcut launch delegates to Windows shell so shortcut arguments are preserved');
  assert(minimized, 'the app minimizes after launching a manual shortcut');
  const addedExe = await handlers.get('library:add-manual-game')({}, { name: 'Manual EXE Game', launcherPath: exe });
  const gamesWithExeIcon = await handlers.get('library:installed-games')({});
  const exeGame = gamesWithExeIcon.find(game => game.id === addedExe.id);
  assert.equal(exeGame.iconDataUrl, 'data:image/png;base64,windows-icon', 'a manually added .exe uses its native Windows file icon by default');
  assert(iconRequests.includes(exe), 'the .exe itself is passed to the Windows icon extractor');
  const exeJob = await handlers.get('library:play-installed')({}, addedExe.id);
  assert.equal(exeJob.state, 'running', 'manual .exe launch uses the app-owned executable runner');
  await assert.rejects(() => handlers.get('library:add-manual-game')({}, { name: 'Bad', launcherPath: folder }), /existing game/);
  await assert.rejects(() => handlers.get('library:remove-manual-game')({}, 'not-a-manual-game'), /manually added game/);
  const removed = await handlers.get('library:remove-manual-game')({}, added.id);
  assert.deepEqual(removed, { ok: true }, 'remove action reports a successful Library-only removal');
  assert.equal(manual.some(game => game.id === added.id), false, 'the manual Library record is removed');
  assert.equal(manual.some(game => game.id === addedExe.id), true, 'other manual Library entries stay untouched');
  assert.ok(fs.existsSync(shortcut), 'removing a shortcut entry does not delete the .lnk file');
  assert.ok(fs.existsSync(exe), 'removing a shortcut entry does not delete its game executable');
  assert.ok(savedCoverPath && fs.existsSync(savedCoverPath), 'removing a Library entry does not delete uploaded cover files');
  const remainingGames = await handlers.get('library:installed-games')({}, { refresh: true });
  assert.equal(remainingGames.some(game => game.id === added.id), false, 'removed game disappears after Library refresh');
  assert.equal(remainingGames.some(game => game.id === addedExe.id), true, 'other games remain visible');
}
(async () => { await updaterTest(); await launcherTest(); await manualLibraryActionsTest(); console.log('Desktop tests passed: trusted IPC, installed-game detection, manual .exe/.lnk registration, persistent cover upload, shortcut launch and existing launch logging.'); })().catch(error => { console.error(error); process.exitCode = 1; });