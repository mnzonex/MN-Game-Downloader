import { recordCompletion } from './Library';
import { removeTorrentTempPayload } from './downloadCleanup';
/**
 * TorrentEngine.ts — Core BitTorrent download engine for MN Game Downloader.
 *
 * Uses Python libtorrent sidecar (engine.py) — full libtorrent-rasterbar C++ core.
 * Features: DHT, PEX, uTP, magnet, max download speed, zero C++ compilation errors.
 */

import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { spawn, execSync, ChildProcess } from 'child_process';
import {
  dbInsertTorrent,
  dbUpdateTorrentStats,
  dbMarkCompleted,
  dbMarkError,
  dbGetAllTorrents,
  dbGetTorrent,
  dbDeleteTorrent,
  dbGetSetting,
} from './db.js';

const PORT = 3001;
const API_URL = `http://127.0.0.1:${PORT}`;

// ── Path helpers ───────────────────────────────────────────────────────────────

function getUserDataPath(): string {
  if (process.env.MN_DATA_DIR) return process.env.MN_DATA_DIR;
  return path.join(process.cwd(), '.mn-data');
}

export function getHiddenDownloadDir(): string {
  const dir = path.join(getUserDataPath(), '.mndownloads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveEngineExe(): string {
  // 1. Packaged Electron app: extraResources are in process.resourcesPath
  if (process.resourcesPath) {
    const resPath = path.join(process.resourcesPath, 'engine.exe');
    if (fs.existsSync(resPath)) return resPath;
    const resBinPath = path.join(process.resourcesPath, 'bin', 'engine.exe');
    if (fs.existsSync(resBinPath)) return resBinPath;
  }

  // 2. Dev mode: check bin/engine.exe in current working directory
  const cwdBinPath = path.join(process.cwd(), 'bin', 'engine.exe');
  if (fs.existsSync(cwdBinPath)) return cwdBinPath;

  // 3. Fallback: check engine.exe directly in cwd
  const cwdPath = path.join(process.cwd(), 'engine.exe');
  if (fs.existsSync(cwdPath)) return cwdPath;

  return cwdBinPath;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class TorrentEngine extends EventEmitter {
  private engineProcess: ChildProcess | null = null;
  private started = false;
  private mutations = 0;
  private polling = false;
  private pollInterval: NodeJS.Timeout | null = null;
  
  // Cache from python to serve getAll() synchronously
  private lastListCache: any[] = [];

  // Track when each torrent first reached 100%/finished state for fallback watchdog
  private finishedSinceTime: Map<string, number> = new Map();

  // ── Start ────────────────────────────────────────────────────────────────────

  async start() {
    if (this.started) return;
    this.started = true;

    const hiddenDir = getHiddenDownloadDir();
    const engineExe = resolveEngineExe();

    if (!fs.existsSync(engineExe)) {
      console.error(`[TorrentEngine] FATAL: engine.exe not found at: ${engineExe}`);
      console.error(`[TorrentEngine] Run installer.bat or PyInstaller to compile engine.exe first.`);
      this.started = false;
      return;
    }

    // Never kill processes by image name: another application may legitimately use
    // an executable named engine.exe. Only this instance's tracked child is managed.

    console.log(`[TorrentEngine] Starting native sidecar on port ${PORT}...`);
    console.log(`[TorrentEngine] Executable: ${engineExe}`);

    // Spawn precompiled Python sidecar with parent PID argument and env
    this.engineProcess = spawn(
      engineExe,
      [PORT.toString(), hiddenDir, process.pid.toString()],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PARENT_PID: process.pid.toString() }
      }
    );

    // Auto-kill engine child process if Node.js exits or receives signals
    const killOnExit = () => {
      if (this.engineProcess && this.engineProcess.pid) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${this.engineProcess.pid}`, { stdio: 'ignore' });
          } else {
            this.engineProcess.kill('SIGKILL');
          }
        } catch { /* already gone */ }
        this.engineProcess = null;
      }
    };

    process.once('exit', killOnExit);
    process.once('SIGINT', () => { killOnExit(); process.exit(0); });
    process.once('SIGTERM', () => { killOnExit(); process.exit(0); });

    this.engineProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) console.log(`[PyEngine] ${output}`);
    });

    this.engineProcess.stderr?.on('data', (data) => {
      const err = data.toString().trim();
      if (err) console.error(`[PyEngine ERROR] ${err}`);
    });

    this.engineProcess.on('exit', (code) => {
      console.log(`[PyEngine] Process exited with code ${code}`);
      this.started = false;
      this.engineProcess = null;
    });

    // Wait for ENGINE_READY signal — use a Promise that listens on stdout
    // and falls back to 8s timeout. The listener is attached BEFORE spawn output
    // could arrive, so we never miss the signal.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[TorrentEngine] ENGINE_READY timeout — assuming engine started anyway.');
          resolve();
        }
      }, 8000);

      const onData = (data: Buffer) => {
        if (!resolved && data.toString().includes('ENGINE_READY')) {
          resolved = true;
          clearTimeout(timeout);
          this.engineProcess?.stdout?.off('data', onData);
          resolve();
        }
      };
      this.engineProcess?.stdout?.on('data', onData);
    });

    console.log('[TorrentEngine] Sidecar API ready. Restoring missing torrents...');

    // Polling loop
    this.pollInterval = setInterval(() => this.pollStats(), 1000);

    // Sync DB with Engine
    await this.restoreFromDb();

    // Clean up stale resume files safely
    this.cleanStaleResumeFiles();

    // Apply saved download speed limit
    const savedSpeedLimit = parseInt(dbGetSetting('speed_limit', '0'), 10) || 0;
    if (savedSpeedLimit > 0) {
      await this.setSpeedLimit(savedSpeedLimit);
    }
  }

  // ── Restore on startup ───────────────────────────────────────────────────────

  private async restoreFromDb() {
    const rows = dbGetAllTorrents().filter(r =>
      !r.hidden &&
      r.status !== 'completed' &&
      r.status !== 'scheduled' && // Do NOT restore scheduled items — scheduler handles them
      !r.magnet.startsWith('http') &&
      r.id.length <= 40
    );
    
    // Get currently active in engine (loaded from fastresume)
    let engineTorrents = [];
    try {
      const res = await fetch(`${API_URL}/list`);
      engineTorrents = await res.json();
    } catch (e) {
      console.error('[TorrentEngine] Failed to get list on restore');
    }

    const activeIds = engineTorrents.map((t: any) => t.id);

    for (const row of rows) {
      if (!activeIds.includes(row.id)) {
        if (row.task_kind === 'repair') {
          dbUpdateTorrentStats(row.id, { status: 'error', error_msg: 'Repair state was not saved. Remove this task without deleting files, then select Repair files and scan again.' });
          continue;
        }
        console.log(`[TorrentEngine] Re-adding missing torrent: ${row.id}`);
        try {
          await fetch(`${API_URL}/add`, {
            method: 'POST',
            body: JSON.stringify({ magnet: row.magnet, save_path: row.save_path })
          });
        } catch { /* ignore */ }
      }

      if (row.status !== 'paused') {
        await fetch(API_URL + '/resume', { method: 'POST', body: JSON.stringify({ id: row.id }) }).catch(() => {});
      }
      if (row.status === 'paused') {
        try {
          await fetch(`${API_URL}/pause`, {
            method: 'POST',
            body: JSON.stringify({ id: row.id })
          });
        } catch { /* ignore */ }
      }
      
      // Ensure target path is set for auto-move
      try {
        await fetch(`${API_URL}/move`, {
          method: 'POST',
          body: JSON.stringify({ id: row.id, target_path: row.dest_path })
        });
      } catch { /* ignore */ }
    }
  }

  // ── Inspect torrent metadata & seeds ─────────────────────────────────────────

  async inspect(magnetLink: string, timeoutSec: number = 8): Promise<any> {
    if (!this.started) throw new Error('Torrent engine not started.');

    try {
      const res = await fetch(`${API_URL}/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: magnetLink, timeout: timeoutSec }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect magnet link');
      return data;
    } catch (e: any) {
      throw new Error(`Engine inspect error: ${e.message}`);
    }
  }

  async repairAction(action: string, body: any) {
    if (!this.started) throw new Error('Torrent engine not started.');
    this.mutations++;
    try {
      let response = await fetch(API_URL + '/repair/' + action, {
        method: 'POST', body: JSON.stringify(body),
      });
      let result = await response.json();
      if (action === 'scan' && response.status === 409 && result.error?.includes('Resolve')) {
        const inspected = await this.inspect(body.magnet, 25);
        if (!inspected.has_metadata) throw new Error('Metadata unavailable. Retry when peers are reachable, or use a folder with its saved .mn-package.torrent.');
        response = await fetch(API_URL + '/repair/scan', { method: 'POST', body: JSON.stringify(body) });
        result = await response.json();
      }
      if (!response.ok) throw new Error(result.error || 'Repair request failed');
      if (action === 'confirm') {
        dbDeleteTorrent(result.id);
        dbInsertTorrent({ id: result.id, name: result.name, magnet: result.magnet,
          save_path: result.save_path, dest_path: result.save_path, status: 'verifying', task_kind: 'repair',
          size: result.size, progress: 0, speed_dl: 0, speed_ul: 0,
          peers: 0, seeds: 0, eta_secs: -1, error_msg: null });
      }
      return result;
    } finally { this.mutations--; }
  }

  // ── Add torrent ──────────────────────────────────────────────────────────────

  async add(magnetLink: string, sourceId?: string): Promise<{ id: string; name: string }> {
    if (!this.started) throw new Error('Torrent engine not started.');

    const destPath = dbGetSetting('download_path',
      path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads'));
      
    // Create a hidden temp directory ON THE SAME DRIVE as the destination
    // This allows instant moves instead of copying across drives!
    const localHiddenDir = path.join(destPath, '.mn-temp');
    if (!fs.existsSync(localHiddenDir)) fs.mkdirSync(localHiddenDir, { recursive: true });

    this.mutations++;
    try {
      // Pass target_path directly in /add to eliminate the race condition
      // where /move arrives after the torrent finishes metadata download
      const addRes = await fetch(`${API_URL}/add`, {
        method: 'POST',
        body: JSON.stringify({ magnet: magnetLink, save_path: localHiddenDir, target_path: destPath })
      });
      
      const addData = await addRes.json();
      if (!addRes.ok) throw new Error(addData.error || 'Failed to add');
      
      const id = addData.id;
      const name = addData.name;

      // Always reset DB record so it starts completely fresh
      dbDeleteTorrent(id);
      dbInsertTorrent({
        id,
        name,
        magnet: magnetLink,
        save_path: localHiddenDir,
        dest_path: destPath,
        status: 'downloading',
        error_msg: null,
        progress: 0,
        size: 0,
        speed_dl: 0,
        speed_ul: 0,
        peers: 0,
        seeds: 0,
        eta_secs: -1,
        source_id: sourceId || null,
      });

      return { id, name };
    } catch (e) {
      throw new Error(`Engine API error: ${(e as Error).message}`);
    } finally {
      this.mutations--;
    }
  }

  /**
   * addFromSchedule — used by DownloadScheduler to start a torrent that was
   * already inserted into the DB in 'scheduled' status. Instead of re-inserting
   * a fresh record, it reuses the existing row (preserving the original added_at
   * and scheduled_at timestamps) and sets status to 'downloading'.
   */
  async addFromSchedule(
    magnetLink: string,
    id: string,
    name: string,
    tempDir: string,
    destPath: string,
  ): Promise<void> {
    if (!this.started) throw new Error('Torrent engine not started.');

    // Clean up stale resume files so it starts fresh
    const resumeDir = path.join(getHiddenDownloadDir(), '.resume');
    try {
      const fr = path.join(resumeDir, `${id}.fastresume`);
      if (fs.existsSync(fr)) fs.unlinkSync(fr);
      const mt = path.join(resumeDir, `${id}.meta`);
      if (fs.existsSync(mt)) fs.unlinkSync(mt);
    } catch { /* ignore */ }

    try {
      // Pass target_path directly in /add to avoid race with /move
      const addRes = await fetch(`${API_URL}/add`, {
        method: 'POST',
        body: JSON.stringify({ magnet: magnetLink, save_path: tempDir, target_path: destPath }),
      });
      const addData = await addRes.json();
      if (!addRes.ok) throw new Error(addData.error || 'Failed to add');

      // Update the existing DB row (don't re-insert, preserves scheduled_at)
      const { dbUpdateTorrentStats: update } = await import('./db.js');
      update(id, {
        status: 'downloading',
        error_msg: null,
        progress: 0,
        speed_dl: 0,
        speed_ul: 0,
        peers: 0,
        seeds: 0,
        eta_secs: -1,
      });
    } catch (e) {
      throw new Error(`addFromSchedule error: ${(e as Error).message}`);
    }
  }

  // ── Stats poll ───────────────────────────────────────────────────────────────

  private async pollStats() {
    if (this.mutations || this.polling) return;
    this.polling = true;
    try {
      const res = await fetch(`${API_URL}/list`);
      if (!res.ok) return;
      
      const data = await res.json();
      if (this.mutations) return;
      this.lastListCache = data;

      for (const torrent of data) {
        if (torrent.scan_only) continue;
        const id = torrent.id;
        const row = dbGetTorrent(id);
        if (!row || row.hidden) {
          // It's hidden (completed) or deleted from DB, but still in the Python sidecar! 
          // This happens if the sidecar loads a stale fastresume file. We must kill it to stop it from running silently.
          console.log(`[TorrentEngine] Removing zombie torrent ${id} (hidden=${row?.hidden})`);
          fetch(`${API_URL}/remove`, {
            method: 'POST',
            body: JSON.stringify({ id, delete_files: false })
          }).catch(e => console.error(`[TorrentEngine] Zombie remove failed:`, e));
          continue;
        }
        const isFinished = torrent.is_finished || torrent.state === 'finished' || torrent.state === 'seeding';
        const isEnginePaused = torrent.is_paused === true || torrent.state === 'paused';
        const isVerifying = torrent.state === 'verifying' || torrent.is_verifying === true;
        const isRepairing = torrent.state === 'repairing' || torrent.is_repairing === true;
        const isVerified = torrent.is_verified === true;

        let status: import('./db.js').TorrentStatus = 'downloading';
        if (isVerifying) status = 'verifying';
        else if (isRepairing) status = 'repairing';
        else if (isFinished) status = isVerified ? 'moving' : 'verifying';
        else status = 'downloading';

        if (torrent.error) status = 'error';
        
        // If the engine reports paused OR the DB already has it paused, keep it paused.
        // This prevents the polling loop from overwriting 'paused' with 'downloading'
        // in the first few polls after user hits Pause.
        const finalStatus = !torrent.error && !isVerifying && isEnginePaused
          ? 'paused'
          : status;
        
        dbUpdateTorrentStats(id, {
          progress: torrent.progress,
          speed_dl: isEnginePaused ? 0 : torrent.speed_dl,
          speed_ul: torrent.speed_ul,
          peers: torrent.peers,
          seeds: torrent.seeds,
          size: torrent.total_size,
          eta_secs: torrent.eta_secs,
          name: torrent.name !== 'Downloading metadata...' ? torrent.name : row.name,
          error_msg: torrent.error,
          status: finalStatus as import('./db.js').TorrentStatus
        });

        if (torrent.is_moved && isVerified && !torrent.error) {
          // Python engine confirmed the move succeeded — finalize on Node side
          this.finishedSinceTime.delete(id);
          console.log(`[TorrentEngine] Torrent ${id} fully completed, verified, and moved. Cleaning up.`);
          await recordCompletion({ ...row, name: torrent.name || row.name, size: torrent.total_size }, torrent.manifest_path);
          this.emit('torrentCompleted', id);
          
          // Remove from engine now that it's fully moved and done
          await fetch(`${API_URL}/remove`, {
            method: 'POST',
            body: JSON.stringify({ id, delete_files: false })
          }).catch(() => {});

          // Clean up resume files
          const rDir = path.join(getHiddenDownloadDir(), '.resume');
          try {
            const fr = path.join(rDir, `${id}.fastresume`);
            if (fs.existsSync(fr)) fs.unlinkSync(fr);
            const mt = path.join(rDir, `${id}.meta`);
            if (fs.existsSync(mt)) fs.unlinkSync(mt);
            const mf = path.join(rDir, `${id}.manifest.json`);
            if (fs.existsSync(mf)) fs.unlinkSync(mf);
          } catch { /* ignore */ }

          // Remove from active database so same game can be downloaded fresh anytime
          dbDeleteTorrent(id);

          // Notify scheduler to start next queued/scheduled download
          try {
            const { downloadScheduler } = await import('./DownloadScheduler.js');
            downloadScheduler.checkQueue();
          } catch { /* ignore */ }

          continue;
        }

      }
    } catch (e) {
      // API might be down or shutting down
    } finally {
      this.polling = false;
    }
  }

  // ── Speed Limit ─────────────────────────────────────────────────────────────

  async setSpeedLimit(bytesPerSec: number) {
    try {
      await fetch(`${API_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ download_rate_limit: bytesPerSec })
      });
      console.log(`[TorrentEngine] Speed limit applied: ${bytesPerSec === 0 ? 'Unlimited' : (bytesPerSec / (1024 * 1024)).toFixed(0) + ' MB/s'}`);
    } catch { /* engine may be starting */ }
  }

  // ── Stale Resume Cleanup ────────────────────────────────────────────────────

  private cleanStaleResumeFiles() {
    try {
      const resumeDir = path.join(getHiddenDownloadDir(), '.resume');
      if (!fs.existsSync(resumeDir)) return;
      const rows = dbGetAllTorrents();
      const activeIds = new Set(rows.filter(r => !r.hidden && r.status !== 'completed').map(r => r.id));

      const files = fs.readdirSync(resumeDir);
      for (const file of files) {
        const id = file.replace(/\.(fastresume|meta|manifest\.json)$/, '');
        if (!activeIds.has(id)) {
          try {
            fs.unlinkSync(path.join(resumeDir, file));
            console.log(`[TorrentEngine] Cleaned stale resume file: ${file}`);
          } catch {}
        }
      }
    } catch { /* ignore */ }
  }

  // ── Pause / Resume ───────────────────────────────────────────────────────────

  async pause(id: string) {
    this.mutations++;
    try {
      const response = await fetch(`${API_URL}/pause`, { method: 'POST', body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not pause download');
      dbUpdateTorrentStats(id, { status: 'paused', speed_dl: 0 });
    } finally { this.mutations--; }
  }

  async resume(id: string) {
    this.mutations++;
    try {
      const response = await fetch(`${API_URL}/resume`, { method: 'POST', body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not resume download');
      dbUpdateTorrentStats(id, { status: 'downloading', error_msg: null });
    } finally { this.mutations--; }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async remove(id: string, deleteFiles: boolean) {
    const existing = dbGetTorrent(id);
    if (existing && (path.resolve(existing.save_path) === path.resolve(existing.dest_path) || existing.task_kind === 'repair')) {
      deleteFiles = false;
    }

    // The sidecar removes only the payload currently attached to the torrent
    // handle. For active downloads that is .mn-temp, never the final download folder.
    try {
      const response = await fetch(API_URL + '/remove', {
        method: 'POST',
        body: JSON.stringify({ id, delete_files: deleteFiles }),
      });
      if (!response.ok) console.warn('[TorrentEngine] Sidecar remove returned HTTP ' + response.status + ' for ' + id + '.');
    } catch { /* the sidecar may already be shutting down */ }

    // Always clean up resume files from Node.js too, even if the sidecar call failed.
    const resumeDir = path.join(getHiddenDownloadDir(), '.resume');
    const fastresumePath = path.join(resumeDir, id + '.fastresume');
    const metaPath = path.join(resumeDir, id + '.meta');
    try { if (fs.existsSync(fastresumePath)) fs.unlinkSync(fastresumePath); } catch { /* ignore */ }
    try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch { /* ignore */ }

    // Fallback cleanup is deliberately restricted to this task's .mn-temp payload.
    // Never remove dest_path/name here: it may be a previously completed copy
    // of the same game while this new download is still in progress.
    if (deleteFiles && existing) removeTorrentTempPayload(existing);

    dbDeleteTorrent(id);
  }

  // ── Retry failed torrent ─────────────────────────────────────────────────────

  async retry(id: string): Promise<void> {
    const row = dbGetTorrent(id);
    if (!row) throw new Error('Torrent not found');
    if (row.task_kind === 'repair') throw new Error('Remove this task without deleting files, then use Repair files to scan the folder again.');

    await fetch(API_URL + '/remove', { method: 'POST', body: JSON.stringify({ id, delete_files: false }) });
    
    dbUpdateTorrentStats(id, { status: 'downloading', error_msg: null, progress: 0 });
    await fetch(`${API_URL}/add`, {
      method: 'POST',
      body: JSON.stringify({ magnet: row.magnet, save_path: row.save_path })
    });
    await fetch(`${API_URL}/move`, {
      method: 'POST',
      body: JSON.stringify({ id, target_path: row.dest_path })
    });
  }

  // ── Get all info for API ─────────────────────────────────────────────────────

  getAll() {
    return dbGetAllTorrents().map(row => ({
      id: row.id,
      name: row.name,
      progress: row.progress,
      downloadSpeed: row.speed_dl,
      uploadSpeed: row.speed_ul,
      peers: row.peers,
      seeds: row.seeds,
      size: row.size,
      etaSecs: row.eta_secs,
      status: row.status,
      errorMsg: row.error_msg ?? undefined,
      addedAt: row.added_at,
      completedAt: row.completed_at ?? undefined,
      scheduledAt: row.scheduled_at ?? undefined,
      hidden: row.hidden === 1,
      taskKind: row.task_kind || 'download',
      files: row.task_kind === 'repair' ? this.lastListCache.find(t => t.id === row.id)?.files || [] : [],
    }));
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    console.log('[TorrentEngine] Shutting down Python sidecar...');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Step 1: Ask engine to save resume data and exit gracefully
    try {
      await fetch(`${API_URL}/shutdown`, { method: 'POST' });
    } catch { /* engine may already be down */ }

    // Step 2: Give it 3 seconds to exit cleanly, then force-kill
    if (this.engineProcess && this.engineProcess.exitCode === null) {
      await new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          if (this.engineProcess && this.engineProcess.exitCode === null) {
            console.warn('[TorrentEngine] Graceful shutdown timed out — force killing engine.exe');
            try {
              // On Windows, SIGTERM is not always handled; use taskkill for guaranteed kill
              if (process.platform === 'win32' && this.engineProcess.pid) {
                execSync(
                  `taskkill /F /T /PID ${this.engineProcess.pid}`,
                  { stdio: 'ignore' }
                );
              } else {
                this.engineProcess.kill('SIGKILL');
              }
            } catch { /* already gone */ }
          }
          resolve();
        }, 15000);

        this.engineProcess?.once('exit', () => {
          clearTimeout(killTimeout);
          resolve();
        });

        // The HTTP shutdown is already saving resume data. SIGTERM on Windows
        // terminates the process immediately and must not interrupt that save.
      });
    }

    console.log('[TorrentEngine] Engine shutdown complete.');
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const engine = new TorrentEngine();