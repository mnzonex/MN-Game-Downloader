const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function registerLibraryActions({ ipcMain, dialog, getWindow, userData }) {
  const jobs = new Map();
  let lastDetection = 0;
  let detecting = false;
  const detectInstalled = async () => {
    if (detecting || Date.now() - lastDetection < 15000 || !global.libraryActions?.list) return;
    detecting = true; lastDetection = Date.now();
    try {
      const { readInstalledGames, resolveInstalledGame } = require('./installed-games.cjs');
      const games = global.libraryActions.list().filter(game => !game.executable);
      if (!games.length) return;
      const records = await readInstalledGames();
      for (const game of games) {
        const exe = resolveInstalledGame(game, records);
        if (exe) global.libraryActions.setExecutable(game.id, exe);
      }
    } catch (error) { console.warn('Installed-game detection:', error.message); }
    finally { detecting = false; }
  };
  ipcMain.handle('library:choose-executable', async (_event, id) => {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Select the installed game executable',
      properties: ['openFile'], filters: [{ name: 'Windows executable', extensions: ['exe'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    return global.libraryActions.setExecutable(id || undefined, result.filePaths[0]);
  });
  ipcMain.handle('library:jobs', () => { void detectInstalled(); return [...jobs.values()]; });
  ipcMain.handle('library:launch', async (_event, { id, action }) => {
    if (!['play', 'install'].includes(action)) throw new Error('Unknown action');
    const game = global.libraryActions.get(id);
    const executable = action === 'play' ? game.executable : game.installer;
    if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable) || path.extname(executable).toLowerCase() !== '.exe') {
      throw new Error('Executable not found. Locate the installed game or rescan its folder.');
    }
    if ([...jobs.values()].some(job => job.gameId === id && job.state === 'running')) throw new Error('This game already has a running process');
    const job = { id: String(Date.now()), gameId: id, name: game.name, action,
      state: 'starting', startedAt: Date.now(), messages: [], exitCode: null };
    jobs.set(job.id, job);
    const append = text => {
      job.messages.push(String(text).slice(0, 4000));
      job.messages = job.messages.slice(-100);
    };
    const child = spawn(executable, [], { cwd: path.dirname(executable), shell: false, windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', data => append(data.toString()));
    child.stderr?.on('data', data => append(data.toString()));
    const persist = () => {
      const dir = path.join(userData(), 'launch-logs'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, job.id + '.json'), JSON.stringify(job, null, 2));
    };
    child.on('error', error => { job.state = 'failed'; append(error.message); persist(); });
    child.on('exit', async code => {
      job.state = code === 0 ? 'launcher-exited' : 'failed'; job.exitCode = code;
      if (action === 'install') {
        lastDetection = 0;
        void detectInstalled();
        // Only logs actually written since launch are evidence. GUI errors may not produce logs.
        try {
          for (const name of fs.readdirSync(path.dirname(executable)).filter(n => /\.log$/i.test(n)).slice(0, 20)) {
            const file = path.join(path.dirname(executable), name); const stat = fs.statSync(file);
            if (stat.mtimeMs >= job.startedAt && stat.size < 4 * 1024 * 1024) {
              const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /error|failed|directx|\.dll|driver/i.test(line));
              lines.slice(-30).forEach(line => append(name + ': ' + line));
            }
          }
        } catch (error) { append('Could not read installer logs: ' + error.message); }
        append('Installer launcher exited; child installers may still be running. The library checks Windows installation records for the game executable. If no unique game is found, use Link installed game.');
      }
      persist();
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    job.state = 'running'; job.pid = child.pid;
    if (action === 'play') getWindow()?.minimize();
    persist(); return job;
  });
}
module.exports = { registerLibraryActions };