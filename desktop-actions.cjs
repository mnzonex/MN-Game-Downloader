const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { discoverInstalledGames } = require('./installed-games.cjs');

function registerLibraryActions({ ipcMain, dialog, getWindow, userData, isTrustedSender, getIcon, shell }) {
  const jobs = new Map();
  let lastDetection = 0;
  let detecting = false;
  let installedCache = [];
  let installedCacheAt = 0;
  let installedScan = null;

  const assertTrusted = event => {
    if (typeof isTrustedSender === 'function' && !isTrustedSender(event)) {
      throw new Error('This action is only available to the MN Game Downloader window.');
    }
  };

  const detectInstalled = async () => {
    if (detecting || Date.now() - lastDetection < 15000 || !global.libraryActions?.list) return;
    detecting = true;
    lastDetection = Date.now();
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

  const getInstalledGames = async (force = false) => {
    if (!force && installedCacheAt && Date.now() - installedCacheAt < 45000) return installedCache;
    if (installedScan) return installedScan;
    installedScan = (async () => {
      const detected = await discoverInstalledGames();
      const automatic = await Promise.all(detected.map(async game => {
        let iconDataUrl = '';
        if (game.executable && !game.coverUrl && typeof getIcon === 'function') {
          try { iconDataUrl = await getIcon(game.executable); } catch { /* Cover art and initials remain available. */ }
        }
        return { ...game, iconDataUrl };
      }));
      const manualRecords = typeof global.libraryActions?.listManual === 'function' ? global.libraryActions.listManual() : [];
      const manual = await Promise.all(manualRecords.map(async game => {
        let coverDataUrl = '';
        let iconDataUrl = '';
        if (game.coverPath && fs.existsSync(game.coverPath)) {
          const extension = path.extname(game.coverPath).toLowerCase();
          const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
          try { coverDataUrl = 'data:' + mime + ';base64,' + fs.readFileSync(game.coverPath).toString('base64'); } catch {}
        }
        if (typeof getIcon === 'function') {
          const iconCandidates = [];
          if (path.extname(game.launcherPath).toLowerCase() === '.lnk' && typeof shell?.readShortcutLink === 'function') {
            try {
              const shortcut = shell.readShortcutLink(game.launcherPath);
              if (typeof shortcut?.icon === 'string' && shortcut.icon.trim()) {
                const shortcutIcon = path.isAbsolute(shortcut.icon)
                  ? shortcut.icon
                  : path.resolve(path.dirname(game.launcherPath), shortcut.icon);
                iconCandidates.push(shortcutIcon);
              }
              if (typeof shortcut?.target === 'string' && shortcut.target.trim()) iconCandidates.push(shortcut.target);
            } catch { /* Fall back to the Windows shortcut file icon. */ }
          }
          iconCandidates.push(game.launcherPath);
          for (const candidate of [...new Set(iconCandidates)]) {
            if (!path.isAbsolute(candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
            try {
              iconDataUrl = await getIcon(candidate);
              if (iconDataUrl) break;
            } catch { /* Try the next Windows icon source. */ }
          }
        }
        return {
          id: game.id, name: game.name, source: 'Manual', sourceId: 'manual',
          installLocation: path.dirname(game.launcherPath),
          executable: path.extname(game.launcherPath).toLowerCase() === '.exe' ? game.launcherPath : undefined,
          launcherPath: game.launcherPath, isManual: true, coverDataUrl, iconDataUrl,
        };
      }));
      installedCache = [...manual, ...automatic];
      installedCacheAt = Date.now();
      return installedCache;
    })();
    try { return await installedScan; }
    finally { installedScan = null; }
  };

  const persistJob = job => {
    try {
      const dir = path.join(userData(), 'launch-logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, job.id + '.json'), JSON.stringify(job, null, 2));
    } catch (error) { console.warn('[Library] Could not persist launch record:', error.message); }
  };

  const startExecutable = async (game, executable, action) => {
    if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable)
      || path.extname(executable).toLowerCase() !== '.exe') {
      throw new Error('The installed game executable could not be found.');
    }
    if ([...jobs.values()].some(job => job.gameId === game.id && job.state === 'running')) {
      throw new Error('This game is already running.');
    }
    const job = {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
      gameId: game.id,
      name: game.name,
      action,
      state: 'starting',
      startedAt: Date.now(),
      messages: [],
      exitCode: null,
    };
    jobs.set(job.id, job);
    const append = text => {
      job.messages.push(String(text).slice(0, 4000));
      job.messages = job.messages.slice(-100);
    };
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      shell: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', data => append(data.toString()));
    child.stderr?.on('data', data => append(data.toString()));
    child.on('error', error => {
      job.state = 'failed';
      append(error.message);
      persistJob(job);
    });
    child.on('exit', code => {
      job.state = code === 0 ? 'launcher-exited' : 'failed';
      job.exitCode = code;
      if (action === 'install') {
        lastDetection = 0;
        void detectInstalled();
        append('Installer launcher exited. The installed game list refreshes from Windows installation records.');
      }
      persistJob(job);
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    job.state = 'running';
    job.pid = child.pid;
    if (action === 'play') getWindow()?.minimize();
    persistJob(job);
    return job;
  };

  const safeLauncherUri = value => {
    if (typeof value !== 'string') return '';
    if (/^steam:\/\/rungameid\/\d{1,12}$/i.test(value)) return value;
    if (/^com\.epicgames\.launcher:\/\/apps\/[a-z0-9_%.-]+(?:\?action=launch&silent=true)?$/i.test(value)) return value;
    return '';
  };

  ipcMain.handle('library:installed-games', async (event, options = {}) => {
    assertTrusted(event);
    return getInstalledGames(options?.refresh === true);
  });

  ipcMain.handle('library:choose-manual-launcher', async event => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a game executable or desktop shortcut',
      properties: ['openFile'],
      filters: [{ name: 'Game launcher', extensions: ['exe', 'lnk'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('library:add-manual-game', async (event, payload = {}) => {
    assertTrusted(event);
    if (typeof payload?.name !== 'string' || typeof payload?.launcherPath !== 'string') throw new Error('Enter a game name and choose its launcher path.');
    const launcherPath = path.resolve(payload.launcherPath.trim().replace(/^['\"]|['\"]$/g, ''));
    const extension = path.extname(launcherPath).toLowerCase();
    if (!['.exe', '.lnk'].includes(extension) || !fs.existsSync(launcherPath) || !fs.statSync(launcherPath).isFile()) {
      throw new Error('Choose an existing game .exe or Windows .lnk shortcut.');
    }
    const isInstaller = value => /^(setup|install|unins|uninstall|dxsetup|vcredist|vc_redist|redist)([._ 0-9-]|$)/i.test(path.basename(value, path.extname(value)).toLowerCase());
    if (extension === '.exe' && isInstaller(launcherPath)) throw new Error('That looks like an installer. Select the installed game launcher instead.');
    if (extension === '.lnk') {
      if (process.platform !== 'win32' || typeof shell?.readShortcutLink !== 'function') throw new Error('Windows shortcut files are only supported on Windows.');
      let shortcut;
      try { shortcut = shell.readShortcutLink(launcherPath); } catch { throw new Error('Windows could not read this shortcut. Choose the game shortcut again.'); }
      if (!shortcut?.target) throw new Error('This shortcut does not have a valid target.');
      if (path.extname(shortcut.target).toLowerCase() === '.exe' && isInstaller(shortcut.target)) throw new Error('That shortcut points to an installer, not the installed game.');
    }
    const saved = global.libraryActions?.addManual?.(payload.name, launcherPath);
    if (!saved) throw new Error('The Library service is not ready. Refresh and try again.');
    installedCacheAt = 0;
    return saved;
  });

  ipcMain.handle('library:remove-manual-game', async (event, id) => {
    assertTrusted(event);
    if (typeof id !== 'string' || !/^manual-[a-f0-9]{24}$/i.test(id)) {
      throw new Error('Choose a manually added game first.');
    }
    const removed = global.libraryActions?.removeManual?.(id);
    if (!removed) throw new Error('This game is no longer in your Library. Refresh and try again.');
    installedCache = [];
    installedCacheAt = 0;
    return { ok: true };
  });

  ipcMain.handle('library:choose-manual-cover', async (event, id) => {
    assertTrusted(event);
    if (typeof id !== 'string' || !id.startsWith('manual-')) throw new Error('Choose a manually added game first.');
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose game cover artwork',
      properties: ['openFile'],
      filters: [{ name: 'Image files', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const source = result.filePaths[0];
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size < 16 || stat.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
    const bytes = fs.readFileSync(source);
    const extension = path.extname(source).toLowerCase();
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!((extension === '.png' && isPng) || (['.jpg', '.jpeg'].includes(extension) && isJpeg) || (extension === '.webp' && isWebp))) {
      throw new Error('The selected file is not a valid PNG, JPG or WebP image.');
    }
    const folder = path.join(userData(), 'manual-covers');
    fs.mkdirSync(folder, { recursive: true });
    const extensionForSave = extension === '.jpeg' ? '.jpg' : extension;
    const destination = path.join(folder, crypto.createHash('sha256').update(id).digest('hex') + extensionForSave);
    fs.copyFileSync(source, destination);
    const saved = global.libraryActions?.setManualCover?.(id, destination);
    if (!saved) throw new Error('The Library service is not ready. Try again.');
    installedCacheAt = 0;
    return { ok: true };
  });

  ipcMain.handle('library:play-installed', async (event, id) => {
    assertTrusted(event);
    const games = await getInstalledGames(false);
    const game = games.find(item => item.id === id);
    if (!game) throw new Error('This game is no longer detected. Refresh the Library and try again.');
    if (game.isManual && game.launcherPath) {
      if (path.extname(game.launcherPath).toLowerCase() === '.lnk') {
        const error = await shell.openPath(game.launcherPath);
        if (error) throw new Error('Windows could not open this game shortcut: ' + error);
        const job = { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7), gameId: game.id, name: game.name, action: 'play', state: 'launched', startedAt: Date.now(), messages: ['Opened the selected Windows game shortcut.'], exitCode: null };
        jobs.set(job.id, job);
        persistJob(job);
        getWindow()?.minimize();
        return job;
      }
      return startExecutable(game, game.launcherPath, 'play');
    }
    if (game.launchUri) {
      const uri = safeLauncherUri(game.launchUri);
      if (!uri || !shell?.openExternal) throw new Error('The official game launcher link is invalid.');
      await shell.openExternal(uri);
      const job = {
        id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
        gameId: game.id,
        name: game.name,
        action: 'play',
        state: 'launched',
        startedAt: Date.now(),
        messages: ['Opened the installed game through its official launcher.'],
        exitCode: null,
      };
      jobs.set(job.id, job);
      persistJob(job);
      return job;
    }
    return startExecutable(game, game.executable, 'play');
  });

  ipcMain.handle('library:choose-executable', async (event, id) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Select the installed game executable',
      properties: ['openFile'],
      filters: [{ name: 'Windows executable', extensions: ['exe'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return global.libraryActions.setExecutable(id || undefined, result.filePaths[0]);
  });

  ipcMain.handle('library:jobs', event => {
    assertTrusted(event);
    void detectInstalled();
    return [...jobs.values()];
  });

  ipcMain.handle('library:launch', async (event, { id, action }) => {
    assertTrusted(event);
    if (!['play', 'install'].includes(action)) throw new Error('Unknown action');
    const game = global.libraryActions.get(id);
    const executable = action === 'play' ? game.executable : game.installer;
    return startExecutable(game, executable, action);
  });
}

module.exports = { registerLibraryActions };