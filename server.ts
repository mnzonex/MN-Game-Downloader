import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';
import axios from 'axios';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchFitGirlPopular, searchFitGirl, fetchFitGirlGameDetails } from './src/scrapers/fitgirl';

// Fix ESM path resolution for Node / Windows
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sanitizeFolderName = (name: string) => name.replace(/[^\w\s-]/g, '').trim() || 'Game';

const parseSizeToBytes = (sizeStr?: string): number => {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([0-9.]+)\s*(GB|MB|TB|KB)/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'KB') return Math.round(num * 1024);
  if (unit === 'MB') return Math.round(num * 1024 * 1024);
  if (unit === 'GB') return Math.round(num * 1024 * 1024 * 1024);
  if (unit === 'TB') return Math.round(num * 1024 * 1024 * 1024 * 1024);
  return 0;
};

// 1. Directory Structure & Windows Paths
const getAppDataPath = (): string => {
  return process.env.APPDATA || path.resolve(os.homedir(), 'AppData', 'Roaming');
};

const GAMES_DIR = path.resolve(getAppDataPath(), 'MN Game Downloader', 'Games');

if (!fs.existsSync(GAMES_DIR)) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
}

interface DownloadTask {
  id: string;
  gameId: string;
  title: string;
  cover: string;
  repacker: string;
  siteBadge: string;
  downloadUrl: string;
  totalSizeBytes: number;
  downloadedBytes: number;
  speedBps: number;
  progressPercent: number;
  status: 'queued' | 'fetching_torrent' | 'downloading' | 'paused' | 'completed' | 'error' | 'waiting_reconnect';
  addedAt: number;
  completedAt?: number;
  errorMsg?: string;
  installDirectory: string;
  setupExePath?: string;
  hasSetupExe: boolean;
}








// --- ISOLATED SCHEDULER MODULE START ---
interface ScheduledTaskPayload {
  id: string;
  title: string;
  url: string | string[];
  cover: string;
  repacker: string;
  siteBadge: string;
  size: string;
  scheduledTime: number;
}
const scheduledQueue: ScheduledTaskPayload[] = [];

setInterval(() => {
  const now = Date.now();
  for (let i = scheduledQueue.length - 1; i >= 0; i--) {
    const task = scheduledQueue[i];
    if (now >= task.scheduledTime) {
      console.log(`[Scheduler] Triggering scheduled download for: ${task.title}`);
      scheduledQueue.splice(i, 1);
      
      const payload = {
        id: task.id,
        title: task.title,
        url: task.url,
        cover: task.cover,
        repacker: task.repacker,
        siteBadge: task.siteBadge,
        size: task.size
      };
      
      processDownloadPayload(payload);
    }
  }
}, 5000);

function processDownloadPayload(body: any) {
    const { id, title, url, cover, repacker, siteBadge, size } = body;
    let rawUrl = Array.isArray(url) ? url[0] : url;
    const sanitizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/&#038;/g, '&').replace(/&amp;/g, '&').trim() : '';

    const safeTitle = sanitizeFolderName(title || 'Game Repack');
    const gameDir = path.resolve(GAMES_DIR, safeTitle);

    const totalParsedBytes = parseSizeToBytes(size);
    const taskId = id || `dl-${Date.now()}`;

    const downloadTask: DownloadTask = {
      id: taskId,
      gameId: taskId,
      title: title || 'Game Repack',
      cover: cover || '',
      repacker: repacker || 'FitGirl Repacks',
      siteBadge: siteBadge || 'FITGIRL',
      downloadUrl: sanitizedUrl,
      totalSizeBytes: totalParsedBytes || 0,
      downloadedBytes: 0,
      speedBps: 0,
      progressPercent: 0,
      status: 'downloading',
      addedAt: Date.now(),
      installDirectory: gameDir,
      hasSetupExe: false
    };

    activeDownloads.set(downloadTask.id, downloadTask);

    if (cover) {
      downloadGameCover(cover, gameDir).then((savedFilename) => {
        if (savedFilename) {
          const localCoverUrl = `/api/games/local-cover?folder=${encodeURIComponent(safeTitle)}&file=${savedFilename}`;
          downloadTask.cover = localCoverUrl;
        }
      });
    }

    startAria2Download(downloadTask);
    return downloadTask;
}
// --- ISOLATED SCHEDULER MODULE END ---

const activeDownloads = new Map<string, DownloadTask>();
const activeProcesses = new Map<string, any>();
const libraryGames = new Map<string, any>();

async function downloadGameCover(coverUrl: string, gameDir: string): Promise<string> {
  if (!coverUrl || !coverUrl.startsWith('http')) return '';
  try {
    const extMatch = coverUrl.split('?')[0].match(/\.(jpg|jpeg|png|webp)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const filename = `cover.${ext}`;
    const coverPath = path.resolve(gameDir, filename);

    if (fs.existsSync(coverPath) && fs.statSync(coverPath).size > 0) {
      return filename;
    }

    const response = await axios({
      url: coverUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (response.data && response.data.length > 0) {
      fs.writeFileSync(coverPath, response.data);
      console.log(`[Cover Engine] Saved cover thumbnail to ${coverPath}`);
      return filename;
    }
  } catch (err) {
    console.error('[Cover Engine] Failed to download cover:', err);
  }
  return '';
}

function saveGameMetadata(gameDir: string, data: Record<string, any>) {
  try {
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }
    const metaPath = path.resolve(gameDir, 'metadata.json');
    let existing: Record<string, any> = {};
    if (fs.existsSync(metaPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }
    const updated = { ...existing, ...data };
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save metadata.json:', e);
  }
}

// Scan game folder up to depth 2 for setup.exe or installer.exe
function scanForSetupExe(dir: string, depth = 0): string | null {
  if (depth > 2 || !fs.existsSync(dir)) return null;
  try {
    const files = fs.readdirSync(dir);
    let setupCandidate: string | null = null;

    const ignoreDirs = ['md5', 'directx', 'redist', 'support', 'bonus', 'crack'];
    const ignoreFiles = ['quicksfv.exe', 'dxsetup.exe', 'vc_redist.exe', 'unins000.exe'];

    for (const file of files) {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);
      const lowerFile = file.toLowerCase();

      if (stat.isDirectory()) {
        if (ignoreDirs.includes(lowerFile)) continue;
        const found = scanForSetupExe(fullPath, depth + 1);
        if (found) return found;
      } else if (stat.isFile() && lowerFile.endsWith('.exe')) {
        if (ignoreFiles.some(ignore => lowerFile.includes(ignore))) continue;
        if (lowerFile === 'setup.exe' || lowerFile === 'installer.exe') {
          setupCandidate = fullPath;
          // Prefer exact matches at root
          if (depth === 0) {
            return fullPath;
          }
        }
      }
    }
    return setupCandidate;
  } catch (e) {
    return null;
  }
}

function scanLocalGamesFolder() {
  if (!fs.existsSync(GAMES_DIR)) return;

  try {
    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const gameFolder = entry.name;
        const gameDir = path.resolve(GAMES_DIR, gameFolder);
        const metaPath = path.resolve(gameDir, 'metadata.json');

        let metadata: any = {};
        if (fs.existsSync(metaPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          } catch {}
        } else {
           // Skip if there's an aria2 active download going on in here
           const files = fs.readdirSync(gameDir);
           if (files.some(f => f.endsWith('.aria2'))) {
             continue; // Currently downloading
           }
           const detected = scanForSetupExe(gameDir);
           if (!detected) {
             continue; // Just cover images or empty folder
           }
        }

        const gameId = metadata.id || `game-${gameFolder}`;
        const title = metadata.title || gameFolder;
        const repacker = metadata.repacker || 'FitGirl Repacks';
        const totalSizeBytes = metadata.totalSizeBytes || 0;

        let coverUrl = metadata.cover || '';
        let localCoverFilename = '';
        for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
          if (fs.existsSync(path.resolve(gameDir, `cover.${ext}`))) {
            localCoverFilename = `cover.${ext}`;
            break;
          }
        }

        if (localCoverFilename) {
          coverUrl = `/api/games/local-cover?folder=${encodeURIComponent(gameFolder)}&file=${localCoverFilename}`;
        }

        const setupExePath = metadata.setupExePath || scanForSetupExe(gameDir) || path.resolve(gameDir, 'setup.exe');

        const gameRecord = {
          id: gameId,
          title,
          cover: coverUrl,
          repacker,
          installDate: metadata.installDate || new Date().toISOString(),
          totalSizeBytes,
          installPath: gameDir,
          setupExePath,
          hasSetupExe: fs.existsSync(setupExePath) || true
        };
        libraryGames.set(gameId, gameRecord);

        if (!activeDownloads.has(gameId)) {
          activeDownloads.set(gameId, {
            id: gameId,
            gameId,
            title,
            cover: coverUrl,
            repacker,
            siteBadge: metadata.siteBadge || 'FITGIRL',
            downloadUrl: metadata.downloadUrl || '',
            totalSizeBytes,
            downloadedBytes: totalSizeBytes,
            speedBps: 0,
            progressPercent: 100,
            status: 'completed',
            addedAt: Date.now(),
            installDirectory: gameDir,
            setupExePath,
            hasSetupExe: true
          });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning local games folder:', err);
  }
}

// Initial scan of local games directory on server startup
scanLocalGamesFolder();

// Dynamically resolve aria2c.exe path
function getAria2cPath(): string | null {
  const isPackaged = process.env.NODE_ENV === 'production' && (process as any).resourcesPath;
  
  if (isPackaged) {
    const prodPath = path.join((process as any).resourcesPath, 'bin', 'aria2c.exe');
    if (fs.existsSync(prodPath)) return prodPath;
  }

  const devPath = path.join(process.cwd(), 'bin', 'aria2c.exe');
  if (fs.existsSync(devPath)) return devPath;

  const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share');
  const appDataPath = path.join(appData, 'MN Game Downloader', 'bin', 'aria2c.exe');
  if (fs.existsSync(appDataPath)) return appDataPath;

  try {
    const cmd = process.platform === 'win32' ? 'where aria2c' : 'which aria2c';
    execSync(cmd, { stdio: 'ignore' });
    return 'aria2c';
  } catch {
    return null;
  }
}

// Helper to calculate folder size
function getFolderSize(dirPath: string): number {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.resolve(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        size += getFolderSize(fullPath);
      } else {
        size += stat.size;
      }
    }
  } catch (e) {
    // ignore
  }
  return size;
}

// Step 1 & Step 2: Torrent / Download Engine Runner
async function startAria2Download(task: DownloadTask) {
  const gameDir = task.installDirectory;
  if (!fs.existsSync(gameDir)) {
    fs.mkdirSync(gameDir, { recursive: true });
  }

  // Save metadata
  saveGameMetadata(gameDir, {
    id: task.id,
    title: task.title,
    repacker: task.repacker,
    siteBadge: task.siteBadge,
    downloadUrl: task.downloadUrl,
    totalSizeBytes: task.totalSizeBytes
  });

  task.status = 'fetching_torrent';

  // Step 1: Save game.torrent file or magnet link
  const torrentFilePath = path.resolve(gameDir, `${sanitizeFolderName(task.title)} [FitGirl Repack].torrent`);
  if (task.downloadUrl.startsWith('http') && task.downloadUrl.includes('.torrent')) {
    try {
      const resp = await axios.get(task.downloadUrl, { responseType: 'arraybuffer', timeout: 10000 });
      fs.writeFileSync(torrentFilePath, resp.data);
      task.torrentFileSize = resp.data.length;
      console.log(`[Torrent Engine] ${path.basename(torrentFilePath)} saved successfully at: ${torrentFilePath} (${task.torrentFileSize} bytes)`);
      // Wait slightly so UI can reflect Step 1 completion
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (e) {
      console.error('[Torrent Engine] Could not fetch .torrent file directly:', e);
      task.errorMsg = 'Failed to fetch .torrent file';
      task.status = 'error';
      return;
    }
  } else if (task.downloadUrl.startsWith('magnet:')) {
    task.torrentFileSize = task.downloadUrl.length;
    console.log(`[Torrent Engine] magnet link processed successfully`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  } else {
    task.errorMsg = 'Unsupported download URL type';
    task.status = 'error';
    return;
  }

  task.status = 'downloading';

  const aria2Path = getAria2cPath();
  if (aria2Path) {
    console.log(`[Aria2 Engine] Starting aria2c process for ${task.title} from ${aria2Path}`);
    let inputArg = task.downloadUrl.startsWith('magnet:') ? task.downloadUrl : (fs.existsSync(torrentFilePath) ? torrentFilePath : task.downloadUrl);
    
    // On Windows with shell: false, no quotes needed, just pass the exact string
    const args = [
      `--dir=${gameDir}`,
      '--seed-time=0',
      '--enable-dht=true',
      '--bt-enable-lpd=true',
      '--follow-torrent=mem',
      '--max-connection-per-server=16',
      '--summary-interval=1',
      inputArg
    ];
    
    let aria2Proc;
    try {
      aria2Proc = spawn(aria2Path, args, { shell: false });
    } catch (err: any) {
      console.error('[Aria2 Engine] Process spawn error:', err);
      task.status = 'error';
      task.errorMsg = 'Failed to spawn aria2c engine: ' + err.message;
      return;
    }

    activeProcesses.set(task.id, aria2Proc);

    aria2Proc.on('error', (err: any) => {
      console.error('[Aria2 Engine] Process async error:', err);
      task.status = 'error';
      task.errorMsg = 'Aria2 Engine Error: ' + err.message;
    });

    aria2Proc.stdout.on('data', (data: Buffer) => {
      const str = data.toString();
      // Regex to strictly parse the percentage, exact downloaded sizes, speed, etc.
      // Example match: [#200000 12MiB/500MiB(2%) CN:1 SD:0 DL:5.2MiB ETA:1m30s]
      const match = str.match(/\(([\d\.]+)%\).*DL:([\d\.]+)(KiB|MiB|GiB)/i);
      
      if (match) {
        const percent = parseFloat(match[1]);
        const speedVal = parseFloat(match[2]);
        const unit = match[3].toUpperCase();
        let speedBps = speedVal * 1024;
        if (unit === 'MIB') speedBps *= 1024;
        if (unit === 'GIB') speedBps *= 1024 * 1024;

        task.progressPercent = percent;
        task.speedBps = speedBps;
        
        // Match the transferred bytes explicitly if present like "12MiB/500MiB"
        const transferMatch = str.match(/([0-9.]+)(KiB|MiB|GiB)\/([0-9.]+)(KiB|MiB|GiB)/i);
        if (transferMatch) {
          const dlVal = parseFloat(transferMatch[1]);
          const dlUnit = transferMatch[2].toUpperCase();
          let dlBytes = dlVal * 1024;
          if (dlUnit === 'MIB') dlBytes *= 1024;
          if (dlUnit === 'GIB') dlBytes *= 1024 * 1024;
          
          const totVal = parseFloat(transferMatch[3]);
          const totUnit = transferMatch[4].toUpperCase();
          let totBytes = totVal * 1024;
          if (totUnit === 'MIB') totBytes *= 1024;
          if (totUnit === 'GIB') totBytes *= 1024 * 1024;

          task.downloadedBytes = Math.round(dlBytes);
          if (totBytes > task.totalSizeBytes) {
            task.totalSizeBytes = Math.round(totBytes);
          }
        } else if (task.totalSizeBytes > 0) {
          task.downloadedBytes = Math.round((task.totalSizeBytes * percent) / 100);
        }
      }
    });

    aria2Proc.on('close', (code: number) => {
      activeProcesses.delete(task.id);
      
      if (task.status === 'paused' || !activeDownloads.has(task.id)) {
        return;
      }

      if (code === 0) {
        const folderSize = getFolderSize(gameDir);
        const detectedSetup = scanForSetupExe(gameDir);
        
        // Ensure files exist and we found a setup.exe
        if (folderSize > 10 * 1024 * 1024 && detectedSetup) {
          finishDownloadTask(task, detectedSetup);
        } else {
          console.error(`[Aria2 Engine] Process exited but validation failed. Size: ${folderSize}, Setup: ${detectedSetup}`);
          task.status = 'error';
          task.errorMsg = 'Download finished but files are missing or invalid.';
        }
      } else {
        task.status = 'error';
        task.errorMsg = `Aria2 exited with code ${code}`;
      }
    });
  } else {
    console.error('[Aria2 Engine] aria2c not found on system.');
    task.status = 'error';
    task.errorMsg = 'aria2c is not installed or available in PATH.';
  }
}

// Step 3: Auto-Scan Setup & Auto-Completion
function finishDownloadTask(task: DownloadTask, setupExePath: string) {
  const gameDir = task.installDirectory;
  
  task.setupExePath = setupExePath;
  task.hasSetupExe = true;
  task.status = 'completed';
  task.progressPercent = 100;
  task.downloadedBytes = task.totalSizeBytes;
  task.speedBps = 0;
  task.completedAt = Date.now();

  // Save metadata.json
  saveGameMetadata(gameDir, {
    id: task.id,
    title: task.title,
    repacker: task.repacker,
    siteBadge: task.siteBadge,
    totalSizeBytes: task.totalSizeBytes,
    installDate: new Date().toISOString(),
    setupExePath,
    hasSetupExe: task.hasSetupExe,
    downloadUrl: task.downloadUrl
  });

  // Update library games map
  libraryGames.set(task.id, {
    id: task.id,
    title: task.title,
    cover: task.cover,
    repacker: task.repacker,
    installDate: new Date().toISOString(),
    totalSizeBytes: task.totalSizeBytes,
    installPath: gameDir,
    setupExePath,
    hasSetupExe: true
  });

  console.log(`[Download Engine] Game ${task.title} download complete! Saved setup at: ${setupExePath}`);
}

function serveStaticFallback(app: express.Express) {
  const distPath = fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'))
    ? path.resolve(__dirname, 'dist')
    : (fs.existsSync(path.resolve(__dirname, 'index.html'))
      ? __dirname
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

  // API: Version Check & Update Enforcement
  app.get('/api/version', async (req, res) => {
    const currentVersion = '1.0.0';
    
    let updateData = {
      latestVersion: currentVersion,
      isUpdateAvailable: false,
      updateSize: '0 MB',
      changelog: ['Minor bug fixes and performance improvements.', 'Updated game scrapers.'],
      developer: 'MN ZONEX Dev',
      nickname: 'H M MADHUSHA NIMSARA',
      downloadUrl: ''
    };

    try {
      const githubRepo = process.env.GITHUB_REPO;
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

  // Scraper routes
  app.get('/api/fitgirl/popular', async (req, res) => {
    try {
      const games = await fetchFitGirlPopular();
      res.json({ games });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch popular feed' });
    }
  });

  app.get('/api/fitgirl/search', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const games = await searchFitGirl(query);
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

  // Downloads API
  app.get('/api/downloads', (req, res) => {
    const downloads = Array.from(activeDownloads.values());
    res.json({ downloads });
  });


  // --- ISOLATED SCHEDULER API START ---
  app.post('/api/downloads/schedule', (req, res) => {
    console.log('[DEBUG] Scheduled Download Request:', req.body);
    const { id, title, url, cover, repacker, siteBadge, size, scheduledTime } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({ error: 'Scheduled time is required.' });
    }
    
    const targetEpoch = new Date(scheduledTime).getTime();
    if (isNaN(targetEpoch) || targetEpoch <= Date.now()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future!' });
    }
    
    const taskId = id || `dl-sched-${Date.now()}`;
    const task: ScheduledTaskPayload = {
      id: taskId, title, url, cover, repacker, siteBadge, size, scheduledTime: targetEpoch
    };
    
    scheduledQueue.push(task);
    res.json({ success: true, message: "Task scheduled successfully", task });
  });

  app.get('/api/downloads/scheduled', (req, res) => {
    res.json({ scheduledTasks: scheduledQueue });
  });

  app.delete('/api/downloads/scheduled/:id', (req, res) => {
    const idx = scheduledQueue.findIndex(t => t.id === req.params.id);
    if (idx !== -1) {
      scheduledQueue.splice(idx, 1);
      res.json({ status: 'removed' });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
  // --- ISOLATED SCHEDULER API END ---

  app.post('/api/downloads', async (req, res) => {
    console.log('[DEBUG] Download Request:', req.body);
    const task = processDownloadPayload(req.body);
    res.json({ status: 'started', task });
  });

  app.post('/api/downloads/:id/action', (req, res) => {
    const task = activeDownloads.get(req.params.id);
    if (task) {
      const action = req.body.action;
      if (action === 'cancel') {
        task.status = 'paused';
        const proc = activeProcesses.get(task.id);
        if (proc) {
          try { proc.kill(); } catch {}
          activeProcesses.delete(task.id);
        }
        activeDownloads.delete(task.id);
      } else if (action === 'pause') {
        task.status = 'paused';
        const proc = activeProcesses.get(task.id);
        if (proc) {
          try { proc.kill(); } catch {}
          activeProcesses.delete(task.id);
        }
      } else if (action === 'resume') {
        task.status = 'downloading';
        startAria2Download(task);
      }
      res.json({ status: 'ok' });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  app.get('/api/games/local-cover', (req, res) => {
    const folder = req.query.folder as string;
    const file = (req.query.file as string) || 'cover.jpg';
    if (!folder) return res.status(400).send('Folder parameter required');

    const safeFolder = sanitizeFolderName(folder);
    const coverPath = path.resolve(GAMES_DIR, safeFolder, file);

    if (fs.existsSync(coverPath)) {
      return res.sendFile(coverPath);
    }

    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const altPath = path.resolve(GAMES_DIR, safeFolder, `cover.${ext}`);
      if (fs.existsSync(altPath)) {
        return res.sendFile(altPath);
      }
    }

    res.status(404).send('Cover image not found');
  });

  app.get('/api/library', (req, res) => {
    scanLocalGamesFolder();
    res.json({ games: Array.from(libraryGames.values()) });
  });

  // Open game folder in Explorer
  app.post('/api/games/:id/open-folder', (req, res) => {
    const game = libraryGames.get(req.params.id) || Array.from(libraryGames.values()).find(g => g.id === req.params.id);
    const folderPath = game ? game.installPath : (activeDownloads.get(req.params.id)?.installDirectory);

    if (folderPath && fs.existsSync(folderPath)) {
      if (process.platform === 'win32') {
        spawn('explorer', [folderPath], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
      }
      return res.json({ status: 'opened', folder: folderPath });
    }
    res.status(404).json({ error: 'Game folder not found on disk' });
  });


const launchInstallerWithAdmin = (setupPath: string) => {
  return new Promise((resolve) => {
    const command = `powershell -Command "Start-Process -FilePath '${setupPath.replace(/'/g, "''")}' -Verb RunAs"`;
    
    exec(command, (error) => {
      if (error) {
        console.error('[Windows Installer Engine] UAC Launch Error:', error);
        resolve(false);
      } else {
        console.log('[Windows Installer Engine] UAC Prompt triggered successfully.');
        resolve(true);
      }
    });
  });
};

  // Step 4: Launch Setup / Installer Native Windows Execution
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
        console.log(`[Windows Installer Engine] Launching setup.exe with UAC natively: ${setupExePath}`);
        if (process.platform === 'win32') {
          await launchInstallerWithAdmin(setupExePath);
        } else {
          console.log(`[Dev Preview] Launched setup installer at: ${setupExePath}`);
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
      
      let targetFolder = gameDir;
      if (fs.existsSync(setupExePath)) {
        targetFolder = path.dirname(setupExePath);
      }

      console.log(`[Windows Installer Guide] Opening folder for installation: ${targetFolder}`);
      if (process.platform === 'win32') {
        spawn('explorer', [targetFolder], { detached: true, stdio: 'ignore' }).unref();
      }
      res.json({ status: 'opened_folder', folder: targetFolder });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to open game folder' });
    }
  });

  app.post('/api/games/:id/delete', (req, res) => {
    const id = req.params.id;
    const game = libraryGames.get(id);
    const task = activeDownloads.get(id);

    const folderPath = (game && game.installPath) || (task && task.installDirectory);
    if (folderPath && fs.existsSync(folderPath)) {
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`[File System] Successfully deleted game folder: ${folderPath}`);
      } catch (e) {
        console.error('[File System] Failed to remove game folder:', e);
      }
    }

    libraryGames.delete(id);
    activeDownloads.delete(id);
    
    scanLocalGamesFolder();
    res.json({ status: 'deleted', librarySize: libraryGames.size });
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
}

startServer();
