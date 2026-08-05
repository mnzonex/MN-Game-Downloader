const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const helper = `
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
      console.log(\`[Scheduler] Triggering scheduled download for: \${task.title}\`);
      scheduledQueue.splice(i, 1);
      processDownloadPayload(task);
    }
  }
}, 5000);

function processDownloadPayload(payload: any) {
  const { id, title, url, cover, repacker, siteBadge, size } = payload;
  let rawUrl = Array.isArray(url) ? url[0] : url;
  const sanitizedUrl = typeof rawUrl === 'string' ? rawUrl.replace(/&#038;/g, '&').replace(/&amp;/g, '&').trim() : '';

  const safeTitle = sanitizeFolderName(title || 'Game Repack');
  const gameDir = path.resolve(GAMES_DIR, safeTitle);

  const totalParsedBytes = parseSizeToBytes(size);
  const taskId = id || \`dl-\${Date.now()}\`;

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
    status: 'queued',
    addedAt: Date.now(),
    installDirectory: gameDir,
    hasSetupExe: false
  };

  activeDownloads.set(downloadTask.id, downloadTask);

  if (cover) {
    downloadGameCover(cover, gameDir).then((savedFilename) => {
      if (savedFilename) {
        const localCoverUrl = \`/api/games/local-cover?folder=\${encodeURIComponent(safeTitle)}&file=\${savedFilename}\`;
        downloadTask.cover = localCoverUrl;
      }
    });
  }

  startAria2Download(downloadTask);
  return downloadTask;
}
// --- ISOLATED SCHEDULER MODULE END ---
`;

let newContent = content.replace(/const activeDownloads = new Map<string, DownloadTask>\(\);/, helper + '\nconst activeDownloads = new Map<string, DownloadTask>();');

const schedulerApis = `
  // --- ISOLATED SCHEDULER API START ---
  app.post('/api/downloads/schedule', (req, res) => {
    console.log('[DEBUG] Scheduled Download Request:', req.body);
    const { id, title, url, cover, repacker, siteBadge, size, scheduledTime } = req.body;
    
    if (!scheduledTime || scheduledTime <= Date.now()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future.' });
    }
    
    const taskId = id || \`dl-sched-\${Date.now()}\`;
    const task: ScheduledTaskPayload = {
      id: taskId, title, url, cover, repacker, siteBadge, size, scheduledTime
    };
    
    scheduledQueue.push(task);
    res.json({ status: 'scheduled', task });
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
`;

const origPostDownloadRegex = /  app\.post\('\/api\/downloads', async \(req, res\) => \{[\s\S]*?res\.json\(\{ status: 'started', task: downloadTask \}\);\n  \}\);/;

const newPostDownload = `  app.post('/api/downloads', async (req, res) => {
    console.log('[DEBUG] Download Request:', req.body);
    const task = processDownloadPayload(req.body);
    res.json({ status: 'started', task });
  });`;

newContent = newContent.replace(origPostDownloadRegex, schedulerApis + '\n' + newPostDownload);

fs.writeFileSync('server.ts', newContent);
console.log('done');
