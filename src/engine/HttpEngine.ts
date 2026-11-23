import fs from 'fs';
import path from 'path';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import {
  dbInsertTorrent,
  dbUpdateTorrentStats,
  dbMarkError,
  dbMarkCompleted,
  dbGetTorrent,
  dbGetSetting,
  dbDeleteTorrent,
  dbGetAllTorrents,
  dbCaptureDownloadEvent,
} from './db';
import { recordCompletion } from './Library';

interface ActiveDownload {
  abortController: AbortController;
  writer?: fs.WriteStream;
  done?: Promise<void>;
  isPaused?: boolean;
  isRestore?: boolean;
  isManualResume?: boolean;
  resumeAttemptedBytes?: number;
  resumeEventSent?: boolean;
  isShuttingDown?: boolean;
  retryTimer?: NodeJS.Timeout;
  retryWaitResolve?: () => void;
}

export class HttpEngine {
  private activeDownloads = new Map<string, ActiveDownload>();
  private speedLimitBytesPerSec = 0;
  private shuttingDown = false;

  setSpeedLimit(bytesPerSec: number) {
    this.speedLimitBytesPerSec = bytesPerSec;
    console.log(`[HttpEngine] Speed limit set to: ${bytesPerSec === 0 ? 'Unlimited' : (bytesPerSec / (1024 * 1024)).toFixed(0) + ' MB/s'}`);
  }

  private waitForRetry(activeItem: ActiveDownload, delayMs: number): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        if (activeItem.retryTimer) clearTimeout(activeItem.retryTimer);
        activeItem.retryTimer = undefined;
        activeItem.retryWaitResolve = undefined;
        resolve();
      };
      activeItem.retryWaitResolve = finish;
      activeItem.retryTimer = setTimeout(finish, delayMs);
    });
  }

  /** Resume interrupted HTTP downloads after the local API is restarted. */
  restoreInterruptedDownloads(): number {
    const interrupted = dbGetAllTorrents().filter((row) =>
      (row.status === 'downloading' || row.status === 'moving') &&
      (row.magnet.startsWith('https://') || row.magnet.startsWith('http://'))
    );
    let restored = 0;
    for (const row of interrupted) {
      if (this.activeDownloads.has(row.id)) continue;
      const destDir = row.dest_path || dbGetSetting('download_path', path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'));
      const tempDir = row.save_path || path.join(destDir, '.mn-temp');
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        const partFile = path.join(tempDir, `${row.id}.part`);
        let partialBytes = 0;
        try { if (fs.existsSync(partFile)) partialBytes = fs.statSync(partFile).size; } catch {}
        dbCaptureDownloadEvent('download_interrupted', row, { resume_stage: 'startup_http', partial_bytes: partialBytes });
        console.log(`[HttpEngine] Restoring interrupted HTTP download: ${row.name}`);
        this.startDownload(row.id, row.magnet, row.name, tempDir, destDir, true);
        restored++;
      } catch (error: any) {
        dbCaptureDownloadEvent('download_resume_failed', row, { resume_stage: 'startup_http', error_stage: 'filesystem', error_category: 'permission' });
        dbMarkError(row.id, `Could not restore download: ${error.message}`);
      }
    }
    return restored;
  }

  /**
   * Move without ever deleting an existing destination.
   * Same-volume renames remain atomic; cross-volume fallback copies exclusively.
   */
  private safeMove(src: string, dest: string): string {
    const chooseFreePath = (requested: string) => {
      if (!fs.existsSync(requested)) return requested;
      const dir = path.dirname(requested);
      const ext = path.extname(requested);
      const base = path.basename(requested, ext);
      for (let suffix = 1; suffix < 10000; suffix++) {
        const candidate = path.join(dir, `${base} (${suffix})${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
      }
      throw new Error('Could not allocate a unique destination filename.');
    };

    let destination = chooseFreePath(dest);
    try {
      fs.renameSync(src, destination);
      return destination;
    } catch (err: any) {
      if (!['EXDEV', 'EPERM', 'EBUSY'].includes(err.code)) {
        if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') {
          destination = chooseFreePath(dest);
          fs.renameSync(src, destination);
          return destination;
        }
        throw err;
      }
    }

    // On cross-volume/locked-file fallback, COPYFILE_EXCL prevents overwrite.
    for (let attempt = 0; attempt < 100; attempt++) {
      destination = chooseFreePath(dest);
      try {
        fs.copyFileSync(src, destination, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(src);
        return destination;
      } catch (err: any) {
        if (err.code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error('Could not safely move the completed download.');
  }

  /**
   * Clean and sanitize file name with proper extension
   */
  private getCleanFileName(name: string, url: string): string {
    const rawExt = path.extname(url.split('?')[0]) || '.exe';
    let clean = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!clean.toLowerCase().endsWith(rawExt.toLowerCase())) {
      clean += rawExt;
    }
    return clean;
  }

  async add(url: string, gameName?: string, sourceId?: string) {
    if (this.shuttingDown) throw new Error('HTTP download engine is shutting down.');
    // Generate a pseudo-infohash (40 hex chars) using md5 + padding
    const id = crypto.createHash('md5').update(url).digest('hex') + '00000000';
    const cleanName = this.getCleanFileName(gameName || url.split('/').pop()?.split('?')[0] || 'Direct Download', url);

    const defaultDest = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
    const destPath = dbGetSetting('download_path', defaultDest);

    // Temp folder on the same drive under .mn-temp for instant move
    const tempDir = path.join(destPath, '.mn-temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }

    // Insert or update DB
    dbInsertTorrent({
      id,
      name: cleanName,
      magnet: url,
      save_path: tempDir,
      dest_path: destPath,
      status: 'downloading',
      error_msg: null,
      progress: 0,
      size: 0,
      speed_dl: 0,
      speed_ul: 0,
      peers: 1,
      seeds: 1,
      eta_secs: -1,
      source_id: sourceId || null,
    });

    this.startDownload(id, url, cleanName, tempDir, destPath);
    return { id, name: cleanName };
  }

  private async startDownload(id: string, url: string, name: string, tempDir: string, destDir: string, isRestore = false, isManualResume = false) {
    if (this.shuttingDown) return;
    // If already downloading, don't start duplicate stream
    if (this.activeDownloads.has(id)) {
      return;
    }

    const tempFile = path.join(tempDir, `${id}.part`);
    const finalFile = path.join(destDir, name);

    const abortController = new AbortController();
    const activeItem: ActiveDownload = { abortController, isPaused: false, isRestore, isManualResume };
    this.activeDownloads.set(id, activeItem);

    dbUpdateTorrentStats(id, { status: 'downloading', error_msg: null });

    // Resilient download loop with capped exponential retry for temporary failures.
    const downloadLoop = async () => {
      let retryCount = 0;
      while (!activeItem.isPaused && this.activeDownloads.has(id)) {
        let existingBytes = 0;
        if (fs.existsSync(tempFile)) {
          try {
            existingBytes = fs.statSync(tempFile).size;
          } catch {
            existingBytes = 0;
          }
        }
        const requestedResumeBytes = existingBytes;
        if ((activeItem.isRestore || activeItem.isManualResume) && requestedResumeBytes > 0) {
          activeItem.resumeAttemptedBytes = Math.max(activeItem.resumeAttemptedBytes || 0, requestedResumeBytes);
        }

        try {
          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/124.0.0.0',
            'Referer': 'https://www.ero-labs.com/',
            'Accept-Encoding': 'identity',
          };

          if (existingBytes > 0) {
            headers['Range'] = `bytes=${existingBytes}-`;
          }

          let response: AxiosResponse;
          try {
            response = await axios({
              url,
              method: 'GET',
              responseType: 'stream',
              headers,
              signal: abortController.signal,
              timeout: 30000,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            });
          } catch (reqErr: any) {
            if (activeItem.isPaused || axios.isCancel(reqErr)) {
              break;
            }

            // If range 416 (Range Not Satisfiable), check if already complete or restart
            if (reqErr.response && reqErr.response.status === 416) {
              const row = dbGetTorrent(id);
              if (row && row.size > 0 && existingBytes >= row.size) {
                // Already complete!
                await this.finalizeDownload(id, tempFile, finalFile, destDir);
                return;
              }
              // Reset part file and retry from start
              try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
              existingBytes = 0;
              delete headers['Range'];
              response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers,
                signal: abortController.signal,
                timeout: 30000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
              });
            } else {
              throw reqErr;
            }
          }

          if (activeItem.isPaused) break;

          // Validate resumable responses before appending bytes to an existing .part file.
          let totalLength = 0;
          const isPartial = response.status === 206;
          const contentRange = response.headers['content-range'];
          const contentLength = response.headers['content-length'];
          if (isPartial) {
            const rangeText = typeof contentRange === 'string' && contentRange.startsWith('bytes ')
              ? contentRange.slice(6) : '';
            const [rangeStartText, rangeEndAndTotal] = rangeText.split('-', 2);
            const [rangeEndText, rangeTotalText] = (rangeEndAndTotal || '').split('/', 2);
            const validRange = /^[0-9]+$/.test(rangeStartText || '')
              && /^[0-9]+$/.test(rangeEndText || '')
              && (rangeTotalText === '*' || /^[0-9]+$/.test(rangeTotalText || ''));
            if (!validRange || Number(rangeStartText) !== existingBytes) {
              try { response.data.destroy(); } catch {}
              try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
              throw new Error('Server returned an invalid resume range; restarting the partial download.');
            }
          }

          if (isPartial && contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match) {
              totalLength = parseInt(match[1], 10);
            } else {
              totalLength = existingBytes + parseInt((Array.isArray(contentLength) ? contentLength[0] : contentLength as string) || '0', 10);
            }
          } else {
            totalLength = parseInt((Array.isArray(contentLength) ? contentLength[0] : contentLength as string) || '0', 10);
            if (!isPartial) {
              existingBytes = 0;
            }
          }

          if ((activeItem.isRestore || activeItem.isManualResume) && !activeItem.resumeEventSent) {
            const restoredRow = dbGetTorrent(id);
            const resumeStage = activeItem.isRestore ? 'http_response' : 'manual_http';
            const resumeBytesObserved = Math.max(requestedResumeBytes, activeItem.resumeAttemptedBytes || 0);
            const restartedFromZero = resumeBytesObserved > 0 && response.status !== 206;
            const resumeEvent = restartedFromZero ? 'download_resume_restarted' : 'download_resumed';
            if (restoredRow) dbCaptureDownloadEvent(resumeEvent, restoredRow, { resume_stage: resumeStage, partial_bytes: resumeBytesObserved });
            activeItem.resumeEventSent = true;
          }

          if (totalLength > 0) {
            dbUpdateTorrentStats(id, { size: totalLength });

            // Check available disk space on the target drive
            try {
              const driveRoot = path.parse(destDir).root || destDir;
              const stat = fs.statfsSync(driveRoot);
              const freeBytes = stat.bavail * stat.bsize;
              const neededBytes = totalLength - existingBytes;
              if (neededBytes > 0 && freeBytes < (neededBytes + 512 * 1024 * 1024)) {
                const needGB = (neededBytes / (1024 * 1024 * 1024)).toFixed(1);
                const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
                const errMsg = `Not enough disk space! Need ${needGB}GB, only ${freeGB}GB free.`;
                console.warn(`[HttpEngine] ${errMsg} for ${id}`);
                activeItem.isPaused = true;
                activeItem.abortController.abort();
                this.activeDownloads.delete(id);
                dbMarkError(id, errMsg);
                return;
              }
            } catch (fsErr) {
              // Ignore if statfsSync is not supported on this platform/drive
            }
          }

          let downloadedLength = existingBytes;
          let lastTime = Date.now();
          let lastBytes = existingBytes;

          const writer = fs.createWriteStream(tempFile, { flags: isPartial && existingBytes > 0 ? 'a' : 'w' });
          activeItem.writer = writer;

          // Wrap stream writing in a Promise that resolves when finished or rejects on network error
          await new Promise<void>((resolve, reject) => {
            let resolved = false;

            let windowBytes = 0;
            let windowStart = Date.now();

            const onData = (chunk: Buffer) => {
              downloadedLength += chunk.length;
              windowBytes += chunk.length;
              const now = Date.now();
              const diffTime = now - lastTime;

              if (diffTime >= 1000) {
                const speedDl = Math.max(0, Math.round(((downloadedLength - lastBytes) / diffTime) * 1000));
                const progress = totalLength > 0 ? Math.min(1.0, downloadedLength / totalLength) : 0;
                const etaSecs = speedDl > 0 && totalLength > 0 ? Math.max(0, Math.round((totalLength - downloadedLength) / speedDl)) : -1;

                dbUpdateTorrentStats(id, {
                  progress,
                  speed_dl: speedDl,
                  eta_secs: etaSecs,
                  status: 'downloading',
                });

                lastTime = now;
                lastBytes = downloadedLength;
              }

              // Speed limiter pacing
              if (this.speedLimitBytesPerSec > 0 && windowBytes >= this.speedLimitBytesPerSec) {
                const elapsed = Date.now() - windowStart;
                if (elapsed < 1000) {
                  try { response.data.pause(); } catch {}
                  const sleepTime = 1000 - elapsed;
                  setTimeout(() => {
                    windowStart = Date.now();
                    windowBytes = 0;
                    try { response.data.resume(); } catch {}
                  }, sleepTime);
                } else {
                  windowStart = Date.now();
                  windowBytes = 0;
                }
              } else if (Date.now() - windowStart >= 1000) {
                windowStart = Date.now();
                windowBytes = 0;
              }
            };

            const cleanup = () => {
              response.data.removeListener('data', onData);
              response.data.removeListener('error', onError);
              writer.removeListener('error', onWriterError);
              writer.removeListener('finish', onFinish);
            };

            const onError = (err: any) => {
              if (!resolved) {
                resolved = true;
                cleanup();
                try { writer.end(); } catch {}
                reject(err);
              }
            };

            const onWriterError = (err: any) => {
              if (!resolved) {
                resolved = true;
                cleanup();
                reject(err);
              }
            };

            const onFinish = () => {
              if (!resolved) {
                resolved = true;
                cleanup();
                resolve();
              }
            };

            response.data.on('data', onData);
            response.data.on('error', onError);
            writer.on('error', onWriterError);
            writer.on('finish', onFinish);

            // Pipe incoming network stream into disk writer
            response.data.pipe(writer);
          });

          // Check if download completed
          const finalSizeOnDisk = fs.existsSync(tempFile) ? fs.statSync(tempFile).size : 0;
          if (finalSizeOnDisk > existingBytes) retryCount = 0;
          if (totalLength > 0 && finalSizeOnDisk >= totalLength) {
            await this.finalizeDownload(id, tempFile, finalFile, destDir);
            this.activeDownloads.delete(id);
            return;
          } else if (totalLength === 0 && finalSizeOnDisk > 0) {
            await this.finalizeDownload(id, tempFile, finalFile, destDir);
            this.activeDownloads.delete(id);
            return;
          }

          // If stream ended prematurely without reaching totalLength, retry after short delay
          retryCount++;
          const retryDelay = Math.min(30000, 2000 * (2 ** Math.min(retryCount - 1, 4)));
          console.warn(`[HttpEngine] Stream ended prematurely (${finalSizeOnDisk}/${totalLength} bytes). Retrying in ${Math.ceil(retryDelay / 1000)}s.`);
          dbUpdateTorrentStats(id, { speed_dl: 0, eta_secs: -1, status: 'downloading' });
          await this.waitForRetry(activeItem, retryDelay);

        } catch (err: any) {
          if (activeItem.isPaused || axios.isCancel(err) || !this.activeDownloads.has(id)) {
            break;
          }

          // Network or connection error: retry temporary failures with capped backoff.
          dbUpdateTorrentStats(id, {
            speed_dl: 0,
            eta_secs: -1,
            status: 'downloading',
          });

          const status = Number(err.response?.status || 0);
          if ([400, 401, 403, 404, 410, 451].includes(status)) {
            const message = `Download source rejected this request (HTTP ${status}). Open the official source page and check access or availability.`;
            console.warn(`[HttpEngine] Permanent source error for ${id}: ${message}`);
            if (activeItem.isRestore || activeItem.isManualResume) {
              const failedRow = dbGetTorrent(id);
              const resumeStage = activeItem.isRestore ? 'startup_http' : 'manual_http';
              if (failedRow) dbCaptureDownloadEvent('download_resume_failed', failedRow, { resume_stage: resumeStage, error_category: 'source_unavailable', error_stage: 'source_response' });
            }
            this.activeDownloads.delete(id);
            dbMarkError(id, message);
            return;
          }

          retryCount++;
          const retryAfter = Number(err.response?.headers?.['retry-after'] || 0);
          const retryDelay = retryAfter > 0
            ? Math.min(60000, retryAfter * 1000)
            : Math.min(30000, 2000 * (2 ** Math.min(retryCount - 1, 4)));
          console.warn(`[HttpEngine] Retrying ${id} in ${Math.ceil(retryDelay / 1000)}s (attempt ${retryCount}).`);
          await this.waitForRetry(activeItem, retryDelay);
        }
      }

      // If loop exited because of pause
      if (activeItem.isPaused && !activeItem.isShuttingDown) {
        this.activeDownloads.delete(id);
        dbUpdateTorrentStats(id, { status: 'paused', speed_dl: 0, eta_secs: -1 });
      }
    };

    // Keep a completion promise so delete can wait for the response stream and
    // file writer to close before removing the temporary .part file on Windows.
    activeItem.done = downloadLoop();
  }

  /**
   * Abort active streams safely but retain their database state and .part files.
   * The next app launch can resume them with the HTTP Range request path.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const active = [...this.activeDownloads.entries()];
    for (const [, item] of active) {
      item.isShuttingDown = true;
      item.isPaused = true;
      if (item.retryTimer) clearTimeout(item.retryTimer);
      item.retryWaitResolve?.();
      try { item.abortController.abort(); } catch {}
    }

    await Promise.all(active.map(async ([id, item]) => {
      try { await item.done; } catch { /* Aborted streams are expected during shutdown. */ }
      const writer = item.writer;
      if (writer && !writer.closed) {
        await new Promise<void>(resolve => {
          if (writer.closed) return resolve();
          writer.once('close', () => resolve());
        });
      }
      const row = dbGetTorrent(id);
      if (row && row.status !== 'completed' && row.status !== 'error') {
        const tempFile = path.join(row.save_path || path.join(row.dest_path || '', '.mn-temp'), `${id}.part`);
        let partialBytes = 0;
        try { if (fs.existsSync(tempFile)) partialBytes = fs.statSync(tempFile).size; } catch {}
        const progress = row.size > 0 ? Math.max(0, Math.min(1, partialBytes / row.size)) : row.progress;
        dbUpdateTorrentStats(id, { progress, speed_dl: 0, eta_secs: -1 });
      }
      this.activeDownloads.delete(id);
    }));
    console.log(`[HttpEngine] Graceful shutdown complete; preserved ${active.length} active download(s) for resume.`);
  }

  private async finalizeDownload(id: string, tempFile: string, finalFile: string, destDir: string) {
    try {
      if (!fs.existsSync(tempFile)) {
        throw new Error('Downloaded file not found on disk.');
      }

      dbUpdateTorrentStats(id, { status: 'moving', progress: 1.0, speed_dl: 0, eta_secs: 0 });

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const actualPath = this.safeMove(tempFile, finalFile);
      const actualName = path.basename(actualPath);
      if (actualName !== path.basename(finalFile)) dbUpdateTorrentStats(id, { name: actualName });
      dbMarkCompleted(id);
      dbUpdateTorrentStats(id, { status: 'completed', progress: 1.0, speed_dl: 0, eta_secs: 0 });
      console.log(`[HttpEngine] Download complete and moved to: ${actualPath}`);

      // Record HTTP completions in the same local history used by torrent downloads.
      try {
        const completedRow = dbGetTorrent(id);
        if (completedRow) await recordCompletion(completedRow);
      } catch (historyErr: any) {
        console.warn(`[HttpEngine] Could not record download history for ${id}: ${historyErr.message}`);
      }

      // Notify scheduler so the next queued/scheduled download can auto-start
      import('./DownloadScheduler.js').then(({ downloadScheduler }) => {
        downloadScheduler.checkQueue();
      }).catch(() => {});
    } catch (moveErr: any) {
      console.error(`[HttpEngine] Error finalizing download: ${moveErr.message}`);
      dbMarkError(id, `Failed to move file: ${moveErr.message}`);
    }
  }

  /**
   * resumeById — called by DownloadScheduler to start a scheduled HTTP download
   * that already has a DB row (avoids creating a new one).
   */
  resumeById(id: string, url: string, name: string, tempDir: string, destDir: string) {
    this.startDownload(id, url, name, tempDir, destDir);
  }

  pause(id: string) {
    const dl = this.activeDownloads.get(id);
    if (dl) {
      dl.isPaused = true;
      dl.abortController.abort();
      if (dl.writer) {
        try { dl.writer.end(); } catch {}
      }
      this.activeDownloads.delete(id);
    }
    dbUpdateTorrentStats(id, { status: 'paused', speed_dl: 0, eta_secs: -1 });
  }

  cancel(id: string) {
    this.pause(id);
  }

  resume(id: string) {
    if (this.shuttingDown) return;
    const row = dbGetTorrent(id);
    if (row && (row.status === 'paused' || row.status === 'error' || row.status === 'queued')) {
      const destPath = row.dest_path || dbGetSetting('download_path');
      const tempDir = row.save_path || path.join(destPath, '.mn-temp');

      this.startDownload(id, row.magnet, row.name, tempDir, destPath, false, true);
    }
  }

  async remove(id: string, deleteFiles: boolean = false): Promise<void> {
    // Capture state before pausing: pause updates the database status to "paused".
    const row = dbGetTorrent(id);
    const active = this.activeDownloads.get(id);
    if (active) {
      this.pause(id);
      try { await active.done; } catch { /* the aborted stream is expected to reject in some cases */ }
      const writer = active.writer;
      if (writer && !writer.closed) {
        await new Promise<void>(resolve => {
          if (writer.closed) return resolve();
          writer.once('close', () => resolve());
        });
      }
    }

    if (!row) return;

    // Delete the HTTP partial payload only. An older completed file with the
    // same destination name must survive deletion of this new in-progress task.
    const tempDir = row.save_path || path.join(row.dest_path || '', '.mn-temp');
    const tempFile = path.join(tempDir, id + '.part');
    if (deleteFiles && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { /* keep the DB operation safe if Windows still locks it */ }
    }

    // A completed record can only be removed explicitly; active downloads never
    // own dest_path/name until finalization has succeeded. When "Remove only" is
    // chosen, keep the .part file so adding the same URL can resume it.
    if (deleteFiles && row.status === 'completed' && row.dest_path && row.name) {
      const finalFile = path.join(row.dest_path, row.name);
      if (fs.existsSync(finalFile)) {
        try { fs.unlinkSync(finalFile); } catch { /* ignore locked files */ }
      }
    }

    dbDeleteTorrent(id);
  }
}

export const httpEngine = new HttpEngine();