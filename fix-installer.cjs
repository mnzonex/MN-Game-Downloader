const fs = require('fs');

const content = fs.readFileSync('server.ts', 'utf8');

const helper = `
const launchInstallerWithAdmin = (setupExePath: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const normalizedPath = path.normalize(setupExePath);

    if (!fs.existsSync(normalizedPath)) {
      console.error(\`[Installer Engine] Setup executable not found at path: \${normalizedPath}\`);
      return resolve(false);
    }

    const escapedPath = normalizedPath.replace(/'/g, "''");
    const psScript = \`Start-Process -FilePath '\${escapedPath}' -Verb RunAs\`;

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      psScript
    ], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    child.on('error', (err) => {
      console.error('[Installer Engine] Failed to spawn PowerShell elevation:', err);
      resolve(false);
    });

    setTimeout(() => {
      resolve(true);
    }, 1000);
  });
};
`;

const newLaunchSetup = `  // Step 4: Launch Setup / Installer Native Windows Execution
  app.post('/api/games/:id/launch-setup', async (req, res) => {
    const game = libraryGames.get(req.params.id) || Array.from(libraryGames.values()).find(g => g.id === req.params.id);
    const task = activeDownloads.get(req.params.id);
    const gameDir = game ? game.installPath : task?.installDirectory;

    if (!gameDir || !fs.existsSync(gameDir)) {
      return res.status(404).json({ error: 'Game folder not found on disk' });
    }

    try {
      const detectedSetup = (game && game.setupExePath) || (task && task.setupExePath) || scanForSetupExe(gameDir);
      const setupExePath = detectedSetup || path.resolve(gameDir, 'setup.exe');

      if (fs.existsSync(setupExePath)) {
        console.log(\`[Windows Installer Engine] Launching setup.exe with UAC natively: \${setupExePath}\`);
        if (process.platform === 'win32') {
          await launchInstallerWithAdmin(setupExePath);
        } else {
          console.log(\`[Dev Preview] Launched setup installer at: \${setupExePath}\`);
        }
        res.json({ status: 'launched', exePath: setupExePath });
      } else {
        if (process.platform === 'win32') {
          spawn('explorer', [gameDir], { detached: true, stdio: 'ignore' }).unref();
        }
        res.json({ status: 'manual_extract', folder: gameDir });
      }
    } catch (e: any) {
      console.error('[Windows Installer Engine] Failed to launch setup:', e);
      res.status(500).json({ error: 'Failed to launch setup installer' });
    }
  });

  // Alias route POST /api/games/:id/install
  app.post('/api/games/:id/install', async (req, res) => {
    const game = libraryGames.get(req.params.id) || Array.from(libraryGames.values()).find(g => g.id === req.params.id);
    const task = activeDownloads.get(req.params.id);
    const gameDir = game ? game.installPath : task?.installDirectory;

    if (!gameDir || !fs.existsSync(gameDir)) {
      return res.status(404).json({ error: 'Game folder not found on disk' });
    }

    try {
      const detectedSetup = (game && game.setupExePath) || (task && task.setupExePath) || scanForSetupExe(gameDir);
      const setupExePath = detectedSetup || path.resolve(gameDir, 'setup.exe');

      if (fs.existsSync(setupExePath)) {
        console.log(\`[Windows Installer Engine] Launching setup.exe with UAC natively via /install: \${setupExePath}\`);
        if (process.platform === 'win32') {
          await launchInstallerWithAdmin(setupExePath);
        }
        res.json({ status: 'launched', exePath: setupExePath });
      } else {
        if (process.platform === 'win32') {
          spawn('explorer', [gameDir], { detached: true, stdio: 'ignore' }).unref();
        }
        res.json({ status: 'manual_extract', folder: gameDir });
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to launch setup installer' });
    }
  });`;

let newContent = content.replace(/  \/\/ Step 4: Launch Setup \/ Installer Native Windows Execution[\s\S]*?  app\.post\('\/api\/games\/:id\/install'[\s\S]*?    \}\n  \}\);\n/, helper + '\n' + newLaunchSetup + '\n');
fs.writeFileSync('server.ts', newContent);
console.log('done');
