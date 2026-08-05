const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const regex1 = /app\.post\('\/api\/downloads\/:id\/install', async \(req, res\) => \{[\s\S]*?\}\);/g;
const replace1 = `app.post('/api/downloads/:id/install', async (req, res) => {
    const task = activeDownloads.get(req.params.id);
    const game = libraryGames.get(req.params.id);
    const gameDir = task?.installDirectory || game?.installPath;

    if (!gameDir || !fs.existsSync(gameDir)) {
      return res.status(404).json({ error: 'Game folder not found on disk' });
    }

    try {
      const detectedSetup = (game && game.setupExePath) || (task && task.setupExePath) || scanForSetupExe(gameDir);
      const setupExePath = detectedSetup || path.resolve(gameDir, 'setup.exe');
      
      let targetFolder = gameDir;
      if (fs.existsSync(setupExePath)) {
        targetFolder = path.dirname(setupExePath);
      }

      console.log(\`[Windows Installer Guide] Opening folder for installation: \${targetFolder}\`);
      if (process.platform === 'win32') {
        spawn('explorer', [targetFolder], { detached: true, stdio: 'ignore' }).unref();
      }
      res.json({ status: 'opened_folder', folder: targetFolder });
    } catch (e: any) {
      console.error('[Windows Installer Guide] Failed to open folder:', e);
      res.status(500).json({ error: 'Failed to open game folder' });
    }
  });`;

content = content.replace(regex1, replace1);

const regex2 = /app\.post\('\/api\/games\/:id\/install', async \(req, res\) => \{[\s\S]*?\}\);/g;
const replace2 = `app.post('/api/games/:id/install', async (req, res) => {
    const game = libraryGames.get(req.params.id) || Array.from(libraryGames.values()).find(g => g.id === req.params.id);
    const task = activeDownloads.get(req.params.id);
    const gameDir = game ? game.installPath : task?.installDirectory;

    if (!gameDir || !fs.existsSync(gameDir)) {
      return res.status(404).json({ error: 'Game folder not found on disk' });
    }

    try {
      const detectedSetup = (game && game.setupExePath) || (task && task.setupExePath) || scanForSetupExe(gameDir);
      const setupExePath = detectedSetup || path.resolve(gameDir, 'setup.exe');
      
      let targetFolder = gameDir;
      if (fs.existsSync(setupExePath)) {
        targetFolder = path.dirname(setupExePath);
      }

      console.log(\`[Windows Installer Guide] Opening folder for installation: \${targetFolder}\`);
      if (process.platform === 'win32') {
        spawn('explorer', [targetFolder], { detached: true, stdio: 'ignore' }).unref();
      }
      res.json({ status: 'opened_folder', folder: targetFolder });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to open game folder' });
    }
  });`;

content = content.replace(regex2, replace2);

fs.writeFileSync('server.ts', content);
console.log('done');
