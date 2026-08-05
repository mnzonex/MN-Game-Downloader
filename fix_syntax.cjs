const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const regex = /\/\/ Alias route POST \/api\/games\/:id\/install[\s\S]*?app\.post\('\/api\/games\/:id\/delete', \(req, res\) => \{/g;

const replacement = `// Alias route POST /api/games/:id/install
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
  });

  app.post('/api/games/:id/delete', (req, res) => {`;

content = content.replace(regex, replacement);
fs.writeFileSync('server.ts', content);
console.log('done');
