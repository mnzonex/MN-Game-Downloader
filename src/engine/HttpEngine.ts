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
} from './db';

interface ActiveDownload {
  abortController: AbortController;
  writer?: fs.WriteStream;
  isPaused?: boolean;
}

class HttpEngine {
  private activeDownloads = new Map<string, ActiveDownload>();
  private speedLimitBytesPerSec = 0;

  setSpeedLimit(bytesPerSec: number) {
    this.speedLimitBytesPerSec = bytesPerSec;
    console.log(`[HttpEngine] Speed limit set to: ${bytesPerSec === 0 ? 'Unlimited' : (bytesPerSec / (1024 * 1024)).toFixed(0) + ' MB/s'}`);
  }

  /**
   * Safely move a file across disks / partitions
   */
  private safeMove(src: string, dest: string) {
    try {
      if (fs.existsSync(dest)) {
        try { fs.unlinkSync(dest); } catch {}
      }
      fs.renameSync(src, dest);
    } catch (err: any) {
      if (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EBUSY') {
        fs.copyFileSync(src, dest);
        try { fs.unlinkSync(src); } catch {}
      } else {
        throw err;
      }
    }
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

  async add(url: string, gameName?: string) {
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
    });

    this.startDownload(id, url, cleanName, tempDir, destPath);
    return { id, name: cleanName };
  }

  private async startDownload(id: string, url: string, name: string, tempDir: string, destDir: string) {
    // If already downloading, don't start duplicate stream
    if (this.activeDownloads.has(id)) {
      return;
    }

    const tempFile = path.join(tempDir, `${id}.part`);
    const finalFile = path.join(destDir, name);

    const abortController = new AbortController();
    const activeItem: ActiveDownload = { abortController, isPaused: false };
    this.activeDownloads.set(id, activeItem);

    dbUpdateTorrentStats(id, { status: 'downloading', error_msg: null });

    // Resilient download loop with automatic retry on network loss
    const downloadLoop = async () => {
      while (!activeItem.isPaused && this.activeDownloads.has(id)) {
        let existingBytes = 0;
        if (fs.existsSync(tempFile)) {
          try {
            existingBytes = fs.statSync(tempFile).size;
          } catch {
            existingBytes = 0;
          }
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
                this.finalizeDownload(id, tempFile, finalFile, destDir);
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

          // Check total size
          let totalLength = 0;
          const isPartial = response.status === 206;
          const contentRange = response.headers['content-range'];
          const contentLength = response.headers['content-length'];

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
          if (totalLength > 0 && finalSizeOnDisk >= totalLength) {
            this.activeDownloads.delete(id);
            this.finalizeDownload(id, tempFile, finalFile, destDir);
            return;
          } else if (totalLength === 0 && finalSizeOnDisk > 0) {
            this.activeDownloads.delete(id);
            this.finalizeDownload(id, tempFile, finalFile, destDir);
            return;
          }

          // If stream ended prematurely without reaching totalLength, retry after short delay
          console.warn(`[HttpEngine] Stream ended prematurely (${finalSizeOnDisk}/${totalLength} bytes). Retrying in 3s...`);
          dbUpdateTorrentStats(id, { speed_dl: 0, eta_secs: -1, status: 'downloading' });
          await new Promise((r) => setTimeout(r, 3000));

        } catch (err: any) {
          if (activeItem.isPaused || axios.isCancel(err) || !this.activeDownloads.has(id)) {
            break;
          }

          // Network or connection error: hold on and auto-retry without marking as error
          console.warn(`[HttpEngine] Connection lost for ${id} (${err.message}). Retrying in 4s...`);
          dbUpdateTorrentStats(id, {
            speed_dl: 0,
            eta_secs: -1,
            status: 'downloading',
          });

          // Wait 4 seconds before reconnecting
          await new Promise((r) => setTimeout(r, 4000));
        }
      }

      // If loop exited because of pause
      if (activeItem.isPaused) {
        this.activeDownloads.delete(id);
        dbUpdateTorrentStats(id, { status: 'paused', speed_dl: 0, eta_secs: -1 });
      }
    };

    downloadLoop();
  }

  private finalizeDownload(id: string, tempFile: string, finalFile: string, destDir: string) {
    try {
      if (!fs.existsSync(tempFile)) {
        throw new Error('Downloaded file not found on disk.');
      }

      dbUpdateTorrentStats(id, { status: 'moving', progress: 1.0, speed_dl: 0, eta_secs: 0 });

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      this.safeMove(tempFile, finalFile);
      dbMarkCompleted(id);
      dbUpdateTorrentStats(id, { status: 'completed', progress: 1.0, speed_dl: 0, eta_secs: 0 });
      console.log(`[HttpEngine] Download complete and moved to: ${finalFile}`);

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
    const row = dbGetTorrent(id);
    if (row && (row.status === 'paused' || row.status === 'error' || row.status === 'queued')) {
      const destPath = row.dest_path || dbGetSetting('download_path');
      const tempDir = row.save_path || path.join(destPath, '.mn-temp');

      this.startDownload(id, row.magnet, row.name, tempDir, destPath);
    }
  }

  remove(id: string, deleteFiles: boolean = false) {
    this.pause(id);
    const row = dbGetTorrent(id);
    if (row) {
      // Remove temp .part file
      const tempDir = row.save_path || path.join(row.dest_path || '', '.mn-temp');
      const tempFile = path.join(tempDir, `${id}.part`);
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }

      // If deleteFiles requested, remove final destination file
      if (deleteFiles && row.dest_path && row.name) {
        const finalFile = path.join(row.dest_path, row.name);
        if (fs.existsSync(finalFile)) {
          try { fs.unlinkSync(finalFile); } catch {}
        }
      }

      dbDeleteTorrent(id);
    }
  }
}

export const httpEngine = new HttpEngine();