import { libraryList, libraryGet, scanLibrary, importLibraryCandidates, removeLibraryGame, setExecutable, rememberGame, historyList, addManualLibraryGame, manualLibraryList, setManualGameCover, removeManualLibraryGame } from './src/engine/Library';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';
import axios from 'axios';
import { fetchFitGirlPopular, searchFitGirl, fetchFitGirlGameDetails } from './src/scrapers/fitgirl';
import { fetchErolabsPopular, searchErolabs, fetchErolabsGameDetails } from './src/scrapers/erolabs';
import { fetchGogFreeGames, searchGogFreeGames, fetchGogGameDetails } from './src/scrapers/gog';
import { fetchSteamFreeGames, searchSteamFreeGames, fetchSteamGameDetails } from './src/scrapers/steam';
import { fetchEpicFreeGames, searchEpicFreeGames, fetchEpicGameDetails } from './src/scrapers/epic';
import { GAME_SOURCES } from './src/sources/registry';
import { engine } from './src/engine/TorrentEngine';
import { httpEngine } from './src/engine/HttpEngine';
import { downloadScheduler } from './src/engine/DownloadScheduler';
import { dbGetSettings, dbSetSetting, dbGetSetting, dbGetTorrent } from './src/engine/db';
import { isNewerVersion } from './version-utils';

function captureTrackedEvent(eventName: string, row: any, extra: Record<string, unknown> = {}) {
  try {
    const capture = (globalThis as any).mnAnalyticsCapture;
    if (typeof capture !== 'function' || !row || row.task_kind === 'repair') return;
    capture(eventName, {
      game_name: row.name,
      source_id: row.source_id || undefined,
      download_type: typeof row.magnet === 'string' && row.magnet.startsWith('magnet:') ? 'torrent' : 'http',
      bytes: Math.max(0, Math.floor((Number(row.size) || 0) * Math.max(0, Math.min(1, Number(row.progress) || 0)))),
      duration_ms: Math.max(0, Date.now() - (Number(row.started_at) || Number(row.added_at) || Date.now())),
      ...extra,
    });
  } catch { /* Tracking cannot change a download action's outcome. */ }
}

function captureTrackedFailure(gameName: unknown, sourceId: unknown, magnetLink: unknown, error: unknown) {
  try {
    const capture = (globalThis as any).mnAnalyticsCapture;
    if (typeof capture !== 'function') return;
    const message = String(error instanceof Error ? error.message : error || '').toLowerCase();
    const errorCategory =
      /enospc|disk full|not enough space|no space left/.test(message) ? 'disk_space' :
      /eacces|eperm|permission|access is denied/.test(message) ? 'permission' :
      /timeout|timed out|timedout|econn|network|socket|dns|offline/.test(message) ? 'network' :
      /403|404|410|source unavailable|not found/.test(message) ? 'source_unavailable' :
      /hash|checksum|verify|corrupt/.test(message) ? 'verification' : 'engine';
    const validSource = GAME_SOURCES.some(source => source.id === sourceId) ? sourceId : undefined;
    capture('download_failed', {
      game_name: gameName,
      source_id: validSource,
      download_type: typeof magnetLink === 'string' && magnetLink.startsWith('magnet:') ? 'torrent' : 'http',
      bytes: 0,
      duration_ms: 0,
      error_category: errorCategory,
    });
  } catch { /* Tracking cannot change a failed request's outcome. */ }
}

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
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid local API port');

  const trustedRendererOrigins = new Set(['http://127.0.0.1:3000', 'http://localhost:3000']);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      if (origin === 'null' || trustedRendererOrigins.has(origin)) return callback(null, origin);
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-MN-API-Token'],
  }));
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !trustedRendererOrigins.has(origin)) {
      return res.status(403).json({ error: 'Untrusted request origin.' });
    }
    const expectedToken = process.env.MN_API_TOKEN;
    if (expectedToken && req.get('X-MN-API-Token') !== expectedToken) {
      return res.status(401).json({ error: 'Local app authentication required.' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  // Initialize download speed limit on startup
  try {
    const initialSpeedLimit = parseInt(dbGetSetting('speed_limit', '0'), 10) || 0;
    httpEngine.setSpeedLimit(initialSpeedLimit);
  } catch {}

  // Authenticated readiness endpoint used by Electron to verify it reached its own API instance.
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // API: Version Check & Update Enforcement
  app.get('/api/version', async (req, res) => {
    let currentVersion = process.env.MN_APP_VERSION || '1.2.32';
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
      changelog: ['Performance and reliability improvements.'],
      downloadUrl: ''
    };

    try {
      const githubRepo = process.env.GITHUB_REPO || 'mnzonex/MN-Game-Downloader';
      if (githubRepo) {
        const { data } = await axios.get(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
          headers: { 'User-Agent': 'MN-Game-Downloader' }
        });
        
        const latestVersion = data.tag_name.replace(/^v/, '');
        // Older releases must never be offered as an update.
        const isUpdateAvailable = isNewerVersion(latestVersion, currentVersion);
        
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

  // Local-only system diagnostics. The renderer has already authenticated with the per-launch API token.
  app.get('/api/system/health', async (_req, res) => {
    const downloadPath = dbGetSetting('download_path', path.join(os.homedir(), 'Downloads'));
    let disk = null;
    try {
      const stats = await fs.promises.statfs(downloadPath);
      const blockSize = Number(stats.bsize || 0);
      const totalBytes = blockSize * Number(stats.blocks || 0);
      // bavail is the space available to this user, matching Windows' drive-free-space view.
      const freeBytes = blockSize * Number(stats.bavail || 0);
      const volume = path.parse(downloadPath).root.replace(/[\\/]+$/, '') || 'Download drive';
      disk = { volume, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
    } catch {
      disk = null;
    }

    let torrentEngine = { status: 'unavailable' as 'online' | 'unavailable', responseMs: null as number | null };
    const engineStarted = Date.now();
    try {
      const engineResponse = await axios.get('http://127.0.0.1:3001/list', { timeout: 1400, maxRedirects: 0 });
      torrentEngine = { status: engineResponse.status === 200 ? 'online' : 'unavailable', responseMs: Date.now() - engineStarted };
    } catch {
      torrentEngine = { status: 'unavailable', responseMs: null };
    }

    res.json({
      sampledAt: new Date().toISOString(),
      downloadDisk: disk,
      downloadPathAvailable: !!disk,
      api: { status: 'online', bindAddress: '127.0.0.1', authenticationRequired: !!process.env.MN_API_TOKEN },
      torrentEngine,
      security: {
        loopbackOnly: true,
        apiAuthentication: !!process.env.MN_API_TOKEN,
        analyticsEnabled: false,
      },
    });
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


  // ── Source registry + Official store catalog APIs ────────────────────────────
  app.get('/api/sources', (_req, res) => res.json({ sources: GAME_SOURCES }));

  app.get('/api/gog/free', async (req, res) => {
    try {
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await fetchGogFreeGames(page));
    } catch (error: any) {
      console.error('[GOG] Free catalog error:', error.message);
      res.status(502).json({ error: 'GOG free games catalog is temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/gog/search', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim().slice(0, 100);
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await searchGogFreeGames(query, page));
    } catch (error: any) {
      console.error('[GOG] Search error:', error.message);
      res.status(502).json({ error: 'GOG search is temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/gog/details', async (req, res) => {
    try {
      const id = String(req.query.id || '').replace(/^gog-/, '');
      if (!/^[0-9]{5,15}$/.test(id)) return res.status(400).json({ error: 'A valid GOG product ID is required.' });
      res.json(await fetchGogGameDetails(id));
    } catch (error: any) {
      console.error('[GOG] Details error:', error.message);
      res.status(502).json({ error: 'Could not load this GOG game details. Please try again.' });
    }
  });

  // Steam candidates are verified against Steam App Details before being displayed.
  app.get('/api/steam/free', async (req, res) => {
    try {
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await fetchSteamFreeGames(page));
    } catch (error: any) {
      console.error('[Steam] Free catalog error:', error.message);
      res.status(502).json({ error: 'Steam free-to-play catalog is temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/steam/search', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim().slice(0, 100);
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await searchSteamFreeGames(query, page));
    } catch (error: any) {
      console.error('[Steam] Search error:', error.message);
      res.status(502).json({ error: 'Steam search is temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/steam/details', async (req, res) => {
    try {
      const id = String(req.query.id || '').replace(/^steam-/, '');
      if (!/^[0-9]{1,12}$/.test(id)) return res.status(400).json({ error: 'A valid Steam app ID is required.' });
      res.json(await fetchSteamGameDetails(id));
    } catch (error: any) {
      console.error('[Steam] Details error:', error.message);
      res.status(502).json({ error: 'This Steam game is no longer verified as a free Windows game.' });
    }
  });

  // Epic promotions have two distinct states: claimable now and upcoming.
  app.get('/api/epic/free', async (req, res) => {
    try {
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await fetchEpicFreeGames(page));
    } catch (error: any) {
      console.error('[Epic] Promotions error:', error.message);
      res.status(502).json({ error: 'Epic Games Store promotions are temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/epic/search', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim().slice(0, 100);
      const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page || '1'), 10) || 1));
      res.json(await searchEpicFreeGames(query, page));
    } catch (error: any) {
      console.error('[Epic] Search error:', error.message);
      res.status(502).json({ error: 'Epic Games Store search is temporarily unavailable. Please retry.' });
    }
  });

  app.get('/api/epic/details', async (req, res) => {
    try {
      const id = String(req.query.id || '');
      if (!/^epic-[a-z0-9-]+$/i.test(id)) return res.status(400).json({ error: 'A valid Epic offer ID is required.' });
      res.json(await fetchEpicGameDetails(id));
    } catch (error: any) {
      console.error('[Epic] Details error:', error.message);
      res.status(404).json({ error: error.message || 'This Epic offer is no longer available.' });
    }
  });

  // ── Torrent Engine Routes ─────────────────────────────────────────────────────

  // Start engine once (idempotent). The isolated security test starts the API only.
  if (process.env.MN_TEST_SKIP_ENGINE !== '1') {
    void engine.start();
    // Restore HTTP downloads left in downloading/moving state by the last app session.
    const restoredHttp = httpEngine.restoreInterruptedDownloads();
    if (restoredHttp > 0) console.log(`[API] Restored ${restoredHttp} interrupted HTTP download(s).`);
    downloadScheduler.start();
  }

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
  (global as any).libraryActions = {
    get: libraryGet,
    list: libraryList,
    setExecutable,
    addManual: addManualLibraryGame,
    listManual: manualLibraryList,
    setManualCover: setManualGameCover,
    removeManual: removeManualLibraryGame,
  };
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
      const { magnetLink, gameName, coverUrl, sourceId } = req.body;
      if (!magnetLink) return res.status(400).json({ error: 'Valid link required' });
      const validSourceId = GAME_SOURCES.some(source => source.id === sourceId) ? sourceId : undefined;

      if (magnetLink.startsWith('http://') || magnetLink.startsWith('https://')) {
        const result = await httpEngine.add(magnetLink, gameName, validSourceId);
        res.json(result);
      } else if (magnetLink.startsWith('magnet:')) {
        const result = await engine.add(magnetLink, validSourceId);
        void rememberGame(result.id, gameName, coverUrl);
        res.json(result);
      } else {
        return res.status(400).json({ error: 'Unsupported download link format' });
      }
    } catch (e: any) {
      captureTrackedFailure(req.body?.gameName, req.body?.sourceId, req.body?.magnetLink, e);
      console.error('[API] download/add error:', e.message);
      res.status(500).json({ error: e.message || 'Failed to start download' });
    }
  });

  // POST /api/torrent/schedule — schedule download for a specific future date & time
  app.post('/api/torrent/schedule', (req, res) => {
    try {
      const { magnetLink, gameName, scheduledAt, coverUrl, sourceId } = req.body;
      if (!magnetLink) return res.status(400).json({ error: 'Valid link required' });
      if (!scheduledAt || typeof scheduledAt !== 'number') {
        return res.status(400).json({ error: 'Valid scheduledAt timestamp required' });
      }

      const validSourceId = GAME_SOURCES.some(source => source.id === sourceId) ? sourceId : undefined;
      const result = downloadScheduler.schedule(magnetLink, gameName, scheduledAt, validSourceId);
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
      if (row) captureTrackedEvent('download_paused', row);
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
      if (row) captureTrackedEvent('download_resumed', row);
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
      const cancellableStatuses = new Set(['scheduled', 'queued', 'downloading', 'paused']);
      if (row && cancellableStatuses.has(row.status)) captureTrackedEvent('download_cancelled', row);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        await httpEngine.remove(id, !!deleteFiles);
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
      if (row) captureTrackedEvent('download_retry', row);
      if (row && (row.magnet.startsWith('http') || row.id.length > 40)) {
        await httpEngine.remove(id, false);
        const result = await httpEngine.add(row.magnet, row.name, row.source_id || undefined);
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
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Settings payload must be an object.' });
      }
      const settings = req.body as Record<string, unknown>;
      const allowedKeys = new Set([
        'download_path', 'speed_limit', 'max_download_speed', 'max_upload_speed',
        'port_range', 'seed_after_done', 'appearance',
      ]);
      const entries = Object.entries(settings);
      if (entries.length === 0 || entries.length > allowedKeys.size) {
        return res.status(400).json({ error: 'Invalid number of settings.' });
      }

      for (const [key, value] of entries) {
        if (!allowedKeys.has(key) || typeof value !== 'string' || value.length > 1024) {
          return res.status(400).json({ error: `Invalid setting: ${key}` });
        }
        if (key === 'download_path' && (!value.trim() || !path.isAbsolute(value))) {
          return res.status(400).json({ error: 'Download location must be an absolute folder path.' });
        }
        if (['speed_limit', 'max_download_speed', 'max_upload_speed'].includes(key)) {
          if (!/^[0-9]{1,9}$/.test(value) || Number(value) > 104857600) {
            return res.status(400).json({ error: 'Speed limits must be between 0 and 100 MB/s.' });
          }
        }
        if (key === 'port_range') {
          const match = value.match(/^([1-9][0-9]{3,4})-([1-9][0-9]{3,4})$/);
          if (!match || Number(match[1]) > 65535 || Number(match[2]) > 65535 || Number(match[1]) > Number(match[2])) {
            return res.status(400).json({ error: 'Port range must be valid, for example 6881-6891.' });
          }
        }
        if (key === 'seed_after_done' && !['0', '1'].includes(value)) {
          return res.status(400).json({ error: `${key} must be 0 or 1.` });
        }
        if (key === 'appearance' && !['light', 'dark'].includes(value)) {
          return res.status(400).json({ error: 'Appearance must be light or dark.' });
        }
      }

      for (const [key, value] of entries) dbSetSetting(key, value as string);

      // Apply a changed speed limit to the active download engines immediately.
      if (settings.speed_limit !== undefined) {
        const limit = Number(settings.speed_limit);
        engine.setSpeedLimit(limit);
        httpEngine.setSpeedLimit(limit);
      }

      res.json({ ok: true });
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

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[MN Game Downloader] Engine running on http://localhost:${PORT}`);
    console.log(`[Publisher] H M MADHUSHA NIMSARA (MN ZONEX Dev)`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[MN Game Downloader] Port ${PORT} is already in use. Refusing to attach to an unverified server.`);
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