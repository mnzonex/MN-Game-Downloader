const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

async function updaterTest() {
  const app = new EventEmitter(); app.requestSingleInstanceLock = () => true;
  app.getPath = () => 'C:\\TestData'; app.getVersion = () => '1.2.0';
  const events = [];
  app.exit = () => events.push('exit'); app.quit = () => events.push('quit');
  const updater = new EventEmitter(); updater.quitAndInstall = (...args) => events.push(['install', ...args]);
  const context = { console, Buffer, setTimeout, clearTimeout, global: {},
    process: { env: {}, platform: 'win32' }, __dirname: process.cwd() };
  context.require = name => {
    if (name === 'electron') return { app, ipcMain: { on() {}, handle() {} }, dialog: {}, BrowserWindow: class {}, Notification: {}, Tray: class {}, Menu: {} };
    if (name === 'electron-updater') return { autoUpdater: updater };
    if (name === 'path') return path;
    if (name === 'fs') return { writeFileSync() { events.push('marker'); }, existsSync() { return false; } };
    if (name === './desktop-actions.cjs') return { registerLibraryActions() {} };
    if (name === 'http') return { request(_opts, callback) {
      const req = new EventEmitter(); req.setTimeout = () => {}; req.end = () => {
        events.push('save-resume'); const res = new EventEmitter(); res.resume = () => {};
        callback(res); setTimeout(() => { events.push('saved'); res.emit('end'); }, 5);
      }; return req;
    } };
    throw new Error('Unexpected module ' + name);
  };
  vm.runInNewContext(fs.readFileSync('main.cjs', 'utf8'), context);
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
    } } : require(name),
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
(async () => { await updaterTest(); await launcherTest(); console.log('Desktop tests passed: save-before-silent-update, duplicate guard, play/minimize, launch error log persistence.'); })().catch(error => { console.error(error); process.exitCode = 1; });