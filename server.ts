import { libraryList, libraryGet, scanLibrary, importLibraryCandidates, removeLibraryGame, setExecutable, rememberGame, historyList } from './src/engine/Library';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';
import axios from 'axios';
import { fetchFitGirlPopular, searchFitGirl, fetchFitGirlGameDetails } from './src/scrapers/fitgirl';
import { fetchErolabsPopular, searchErolabs, fetchErolabsGameDetails } from './src/scrapers/erolabs';
import { engine } from './src/engine/TorrentEngine';
import { httpEngine } from './src/engine/HttpEngine';
import { downloadScheduler } from './src/engine/DownloadScheduler';
import { dbGetSettings, dbSetSetting, dbGetSetting, dbGetTorrent } from './src/engine/db';

// Fix CJS path resolution — in Node.js CJS context __filename and __dirname are always defined.
// The import.meta fallback is not needed for CJS bundles and causes esbuild warnings.
const __filename_resolved: string = typeof __filename !== 'undefined'
  ? __filename
  : '';
const __dirname_resolved: string = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof process !== 'undefined' ? process.cwd() : '');

function serveStaticFallback(app: express.Express) {
  const baseDir = __dirname_resolved || process.cwd();
  const distPath = fs.existsSync(path.resolve(baseDir, 'dist', 'index.html'))
    ? path.resolve(baseDir, 'dist')
    : (fs.existsSync(path.resolve(baseDir, 'index.html'))
      ? baseDir
      : path.resolve(process.cwd(), 'dist'));

  console.log(`[Server] Serving static frontend from: ${distPath}`);
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    const indexPath = fs.existsSync(path.resolve(distPath, 'index.html'))
      ? path.resolve(distPath, 'index.html')
      : path.resolve(process.cwd(), 'dist', 'index.html');

    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>MN Game Downloader - Build Required</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
          <h2 style="color: #ef4444;">Frontend Build Missing</h2>
          <p>Please run <code>npm run build</code> to compile the React frontend assets into the <code>dist</code> directory.</p>
        </body>
      </html>
    `);
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({ origin: true, credentials: true }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
  app.use(express.json());

  // Initialize download speed limit on startup
  try {
    const initialSpeedLimit = parseInt(dbGetSetting('speed_limit', '0'), 10) || 0;
    httpEngine.setSpeedLimit(initialSpeedLimit);
  } catch {}

  // API: Version Check & Update Enforcement
  app.get('/api/version', async (req, res) => {
    let currentVersion = '1.1.3';
    try {
      const pathsToCheck = [
        path.join(process.cwd(), 'package.json'),
        path.join(__dirname_resolved, '..', 'package.json'),
        path.join(__dirname_resolved, 'package.json')
      ];
      for (const pkgPath of pathsToCheck) {
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.version) {
            currentVersion = pkg.version;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Failed to read package.json version:', e);
    }
    
    let updateData = {
      currentVersion,
      latestVersion: currentVersion,
      isUpdateAvailable: false,
      updateSize: '0 MB',
      changelog: ['Simplified engine to pure web aggregator.'],
      developer: 'MN ZONEX Dev',
      nickname: 'H M MADHUSHA NIMSARA',
      downloadUrl: ''
    };

    try {
      const githubRepo = process.env.GITHUB_REPO || 'mnzonex/MN-Game-Downloader';
      if (githubRepo) {
        const { data } = await axios.get(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
          headers: { 'User-Agent': 'MN-Game-Downloader' }
        });
        
        const latestVersion = data.tag_name.replace(/^v/, '');
        const isUpdateAvailable = latestVersion !== currentVersion;
        
        const exeAsset = data.assets.find((asset: any) => asset.name.endsWith('.exe'));
        const updateSize = exeAsset ? `${(exeAsset.size / (1024 * 1024)).toFixed(1)} MB` : 'Unknown Size';
        const downloadUrl = exeAsset ? exeAsset.browser_download_url : data.html_url;

        const changelog = data.body
          ? data.body.split('\n').filter((l: string) => l.trim().startsWith('-') || l.trim().startsWith('*')).map((l: string) => l.replace(/^[-*]\s*/, '').trim()).slice(0, 5)
          : updateData.changelog;

        if (changelog.length === 0) {
          changelog.push('Routine update from GitHub release.');
        }

        updateData = {
          currentVersion,
          latestVersion,
          isUpdateAvailable,
          updateSize,
          changelog,
          developer: 'MN ZONEX Dev',
          nickname: 'H M MADHUSHA NIMSARA',
          downloadUrl
        };
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }

    res.json(updateData);
  });

  // API: Background Auto-Update Status
  app.get('/api/update/status', (req, res) => {
    const g = (global as any);
    const status = g.updateStatus || { state: 'idle', progress: 0, transferred: 0, total: 0, versionInfo: null, error: null };
    res.json(status);
  });

  app.post('/api/update/install', async (_req, res) => {
    const install = (global as any).installDownloadedUpdate;
    if (!install) return res.status(409).json({ error: 'Updates install automatically when you close the desktop app.' });
    res.json({ ok: true });
    void install();
  });

  // Scraper routes
  app.get('/api/fitgirl/popular', async (req, res) => {
    try {
      const page = Math.max(1, Math.min(100, parseInt((req.query.page as string) || '1', 10) || 1));
      const games = await fetchFitGirlPopular(page);
      if (!games.length) return res.status(502).json({ error: 'FitGirl returned no game listings. Check access to the official site and retry.' });
      res.json({ games });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch popular feed' });
    }
  });

  app.get('/api/fitgirl/search', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const page = Math.max(1, Math.min(100, parseInt((req.query.page as string) || '1', 10) || 1));
      const games = await searchFitGirl(query, page);
      res.json({ games });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to search FitGirl' });
    }
  });

  app.get('/api/fitgirl/details', async (req, res) => {
    try {
      const siteUrl = (req.query.siteUrl as string) || '';
      if (!siteUrl) return res.status(400).json({ error: 'siteUrl parameter required' });

      const details = await fetchFitGirlGameDetails(siteUrl);
      res.json(details);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch details' });
    }
  });

  // ── EroLabs Scraper Routes ────────────────────────────────────────────────────

  // GET /api/erolabs/popular?page=1
  app.get('/api/erolabs/popular', async (req, res) => {
    try {
      const page = parseInt((req.query.page as string) || '1', 10) || 1;
      const games = await fetchErolabsPopular(page);
      res.json({ games });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch EroLabs games' });
    }
  });

  // GET /api/erolabs/search?q=carnival&page=1
  app.get('/api/erolabs/search', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const page = parseInt((req.query.page as string) || '1', 10) || 1;
      const games = await searchErolabs(query, page);
      res.json({ games });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to search EroLabs' });
    }
  });

  // GET /api/erolabs/details?siteUrl=https://www.ero-labs.com/en/game.html?id=24
  app.get('/api/erolabs/details', async (req, res) => {
    try {
      const siteUrl = (req.query.siteUrl as string) || '';
      if (!siteUrl) return res.status(400).json({ error: 'siteUrl parameter required' });
      const details = await fetchErolabsGameDetails(siteUrl);
      res.json(details);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch EroLabs game details' });
    }
  });


  // ── Torrent Engine Routes ─────────────────────────────────────────────────────

  // Start engine once (idempotent)
  engine.start();
  // Start download scheduler
  downloadScheduler.start();

  // POST /api/torrent/inspect — inspect magnet link to check files & seeders before download
  app.post('/api/torrent/inspect', async (req, res) => {
    try {
      const { magnetLink, timeout } = req.body;
      if (!magnetLink) return res.status(400).json({ error: 'Valid magnet link required' });

      if (magnetLink.startsWith('magnet:')) {
        const timeoutSec = typeof timeout === 'number' ? timeout : 8;
        const result = await engine.inspect(magnetLink, timeoutSec);
        res.json(result);
      } else {
        // Direct HTTP downloads (e.g. EroLabs) don't need torrent inspection
        res.json({
          ok: true,
          has_metadata: true,
          name: 'Direct Download',
          total_size: 0,
          files_count: 1,
          files: [],
          seeds: 1,
          peers: 1
        });
      }
    } catch (e: any) {
      console.error('[API] download/inspect error:', e.message);
      res.status(500).json({ error: e.message || 'Failed to inspect torrent' });
    }
  });

  app.post('/api/torrent/repair/:action', async (req, res) => {
    const action = req.params.action;
    if (!['scan', 'status', 'confirm', 'cancel'].includes(action)) return res.sendStatus(404);
    const { magnetLink, folder, id, gameName } = req.body;
    if (action === 'scan' && (typeof magnetLink !== 'string' || !magnetLink.startsWith('magnet:') || typeof folder !== 'string' || !path.isAbsolute(folder))) {
      return res.status(400).json({ error: 'Select a game and an absolute folder path.' });
    }
    try {
      const result = await engine.repairAction(action, { magnet: magnetLink, folder, id, gameName });
      if (action === 'confirm') await rememberGame(id, req.body.gameName, req.body.coverUrl);
      res.json(result);
    }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  (global as any).libraryActions = { get: libraryGet, list: libraryList, setExecutable };
  app.get('/api/library', (_req, res) => res.json(libraryList()));
  app.get('/api/download-history', (_req, res) => res.json(historyList()));
  app.post('/api/library/scan', async (req, res) => {
    try { res.json(await scanLibrary(req.body.folder)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/library/import', async (req, res) => {
    try { res.json(await importLibraryCandidates(req.body.tokens)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/library/:id', (req, res) => res.json(removeLibraryGame(req.params.id)));
  app.get('/api/library/:id/cover', (req, res) => {
    try {
      const cover = libraryGet(req.params.id).cover;
      if (!cover) return res.sendStatus(404);
      res.type('image/jpeg').sendFile(cover);
    } catch { res.sendStatus(404); }
  });

  // POST /api/torrent/add — add magnet link or direct link, start download immediately
  app.post('/api/torrent/add', async (req, res) => {
    try {
      const { magnetLink, gameName, coverUrl } = req.body;
      if (!magnetLink) return res.status(400).json({ error: 'Valid link required' });

      if (magnetLink.startsWith('http://') || magnetLink.startsWith('https://')) {
        const result = await httpEngine.add(magnetLink, gameName);
        res.json(result);
      } else if (magnetLink.startsWith('magnet:')) {
        const result = await engine.add(magnetLink);
        void rememberGame(result.id, gameName, coverUrl);
        res.json(result);
      } else {
        return res.status(400).json({ error: 'Unsupported download link format' });
      }
    } catch (e: any) {
      console.error('[API] download/add error:', e.message);
      res.status(500).json({ error: e.message || 'Failed to start download' });
    }
  });

  // POST /api/torrent/schedule — schedule download for a specific future date & time
  app.post('/api/torrent/schedule', (req, res) => {
    try {
      const { magnetLink, gameName, scheduledAt, coverUrl } = req.body;
      if (!magnetLink) return res.status(400).json({ error: 'Valid link required' });
      if (!scheduledAt || typeof scheduledAt !== 'number') {
        return res.status(400).json({ error: 'Valid scheduledAt timestamp required' });
      }

      const result = downloadScheduler.schedule(magnetLink, gameName, scheduledAt);
      void rememberGame(result.id, gameName, coverUrl);
      res.json(result);
    } catch (e: any) {
      console.error('[API] download/schedule error:', e.message);
      res.status(500).json({ error: e.message || 'Failed to schedule download' });
    }
  });

  // POST /api/torrent/start-now — force start a scheduled or queued download ahead of time
  app.post('/api/torrent/start-now', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Valid id required' });

      const result = await downloadScheduler.startNow(id);
      res.json(result);
    } catch (e: any) {
      console.error('[API] download/start-now error:', e.message);
      res.status(500).json({ error: e.message || 'Failed to start download' });
    }
  });

  // GET /api/torrent/list — get all torrents (active + hidden)
  app.get('/api/torrent/list', (req, res) => {
    try {
      const all = engine.getAll();
      res.json(all);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/torrent/pause
  app.post('/api/torrent/pause', async (req, res) => {
    try {
      const { id } = req.body;
      const row = dbGetTorrent(id);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        httpEngine.pause(id);
      } else {
        await engine.pause(id);
      }
      res.json({ success: true });
      setTimeout(() => downloadScheduler.checkQueue(), 300);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/torrent/resume
  app.post('/api/torrent/resume', async (req, res) => {
    try {
      const { id } = req.body;
      const row = dbGetTorrent(id);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        httpEngine.resume(id);
      } else {
        await engine.resume(id);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/torrent/delete
  app.post('/api/torrent/delete', async (req, res) => {
    try {
      const { id, deleteFiles } = req.body;
      const row = dbGetTorrent(id);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        httpEngine.remove(id, !!deleteFiles);
      } else {
        await engine.remove(id, !!deleteFiles);
      }
      res.json({ success: true });
      setTimeout(() => downloadScheduler.checkQueue(), 300);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/torrent/retry — retry failed torrent
  app.post('/api/torrent/retry', async (req, res) => {
    try {
      const { id } = req.body;
      const row = dbGetTorrent(id);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        httpEngine.remove(id);
        const result = await httpEngine.add(row.magnet, row.name);
        res.json(result);
      } else {
        await engine.retry(id);
        res.json({ ok: true });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Settings Routes ────────────────────────────────────────────────────────────

  // GET /api/settings
  app.get('/api/settings', (req, res) => {
    try {
      res.json(dbGetSettings());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/settings
  app.post('/api/settings', (req, res) => {
    try {
      const settings = req.body as Record<string, string>;
      for (const [key, value] of Object.entries(settings)) {
        dbSetSetting(key, String(value));
      }

      // If speed_limit was updated, apply immediately to both engines
      if (settings.speed_limit !== undefined) {
        const limit = parseInt(settings.speed_limit, 10) || 0;
        engine.setSpeedLimit(limit);
        httpEngine.setSpeedLimit(limit);
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/settings/add-exclusion — Add Windows Defender exclusions
  app.post('/api/settings/add-exclusion', async (req, res) => {
    if (process.platform !== 'win32') {
      return res.status(400).json({ error: 'Windows Defender exclusions are only supported on Windows.' });
    }
    try {
      const { exec } = await import('child_process');
      const downloadPath = dbGetSetting('download_path', path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'));
      const tempPath = path.join(downloadPath, '.mn-temp');
      const dataDir = process.env.MN_DATA_DIR || path.join(process.cwd(), '.mn-data');
      const appDir = process.cwd();

      const pathsToExclude = Array.from(new Set([downloadPath, tempPath, dataDir, appDir]));
      const pathsArg = pathsToExclude.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
      const scriptContent = `Add-MpPreference -ExclusionPath @(${pathsArg}) -ErrorAction SilentlyContinue`;

      const tmpScript = path.join(os.tmpdir(), `mn-defender-exclude-${Date.now()}.ps1`);
      fs.writeFileSync(tmpScript, scriptContent, 'utf8');

      const psCmd = `Start-Process powershell.exe -Verb RunAs -ArgumentList '-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"'`;

      exec(`powershell -WindowStyle Hidden -NoProfile -Command "${psCmd}"`, { windowsHide: true }, (err) => {
        setTimeout(() => {
          try { if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript); } catch {}
        }, 8000);

        if (err) {
          console.error('[Server] Defender exclusion error:', err);
          return res.status(500).json({ error: err.message });
        }
        console.log('[Server] Requested Windows Defender exclusions for:', pathsToExclude);
        res.json({ ok: true, paths: pathsToExclude });
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Graceful shutdown hook (called by Electron main before quit)
  app.post('/api/engine/shutdown', async (req, res) => {
    downloadScheduler.stop();
    await engine.shutdown();
    res.json({ ok: true });
  });

  // Vite middleware for development, or static serving for production
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("[Server] Vite dev middleware attached successfully.");
    } catch (e) {
      console.error("[Server] Vite middleware initialization failed, falling back to static files:", e);
      serveStaticFallback(app);
    }
  } else {
    serveStaticFallback(app);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MN Game Downloader] Engine running on http://localhost:${PORT}`);
    console.log(`[Publisher] H M MADHUSHA NIMSARA (MN ZONEX Dev)`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[MN Game Downloader] Port ${PORT} is already in use. Reusing existing running server.`);
    } else {
      console.error('[MN Game Downloader] Server error:', err);
    }
  });

  const handleGracefulExit = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Shutting down engine...`);
    try {
      await engine.shutdown();
    } catch { /* ignore */ }
    process.exit(0);
  };

  process.once('SIGINT', () => handleGracefulExit('SIGINT'));
  process.once('SIGTERM', () => handleGracefulExit('SIGTERM'));
}

startServer();