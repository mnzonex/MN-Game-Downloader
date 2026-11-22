/**
 * DownloadScheduler.ts — Manages scheduled and sequentially queued downloads.
 *
 * Responsibilities:
 *  - Persist "scheduled" downloads to DB without immediately starting them.
 *  - Poll every 5 seconds for overdue scheduled items.
 *  - When an item becomes due:
 *    - If NO active download is running → start it immediately.
 *    - If an active download IS running → mark it 'queued' (pending).
 *  - After any download completes → run checkQueue() to auto-start the next.
 *  - Support startNow(id) to force a scheduled/queued item to start immediately.
 *
 * Queue Priority: scheduled_at ASC, then added_at ASC (oldest first).
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  dbInsertTorrent,
  dbUpdateTorrentStats,
  dbGetTorrent,
  dbDeleteTorrent,
  dbGetOverdueScheduled,
  dbGetPendingQueue,
  dbHasActiveDownload,
  dbGetSetting,
  TorrentRow,
} from './db.js';

// ── Lazy imports to avoid circular deps ──────────────────────────────────────
// We import engine & httpEngine at check time to avoid circular references at
// module load. Both are singletons exported from their respective files.

let _engine: any = null;
let _httpEngine: any = null;

async function getEngine() {
  if (!_engine) {
    const mod = await import('./TorrentEngine.js');
    _engine = mod.engine;
  }
  return _engine;
}

async function getHttpEngine() {
  if (!_httpEngine) {
    const mod = await import('./HttpEngine.js');
    _httpEngine = mod.httpEngine;
  }
  return _httpEngine;
}

// ── Scheduler Class ───────────────────────────────────────────────────────────

class DownloadScheduler {
  private pollInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  /** Start the background polling loop. */
  start() {
    if (this.pollInterval) return;
    // Check every 5 seconds
    this.pollInterval = setInterval(() => this.checkQueue(), 5000);
    console.log('[Scheduler] Download scheduler started. Polling every 5s.');
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Schedule a download to start at a future time.
   * Returns the id and name that will be used in the Downloads tab.
   */
  schedule(
    magnetLink: string,
    gameName: string,
    scheduledAt: number,
    sourceId?: string,
  ): { id: string; name: string; scheduledAt: number } {
    // Generate a deterministic ID (same logic as engines)
    const id = magnetLink.startsWith('magnet:')
      ? this._magnetId(magnetLink)
      : crypto.createHash('md5').update(magnetLink).digest('hex') + '00000000';

    const defaultDest = path.join(
      process.env.USERPROFILE || process.env.HOME || '',
      'Downloads',
    );
    const destPath = dbGetSetting('download_path', defaultDest);
    const tempDir = path.join(destPath, '.mn-temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const cleanName = magnetLink.startsWith('magnet:')
      ? (gameName || 'Scheduled Torrent')
      : this._cleanFileName(gameName || magnetLink.split('/').pop()?.split('?')[0] || 'Download', magnetLink);

    // Remove any stale row first
    dbDeleteTorrent(id);

    dbInsertTorrent({
      id,
      name: cleanName,
      magnet: magnetLink,
      save_path: tempDir,
      dest_path: destPath,
      status: 'scheduled',
      error_msg: null,
      progress: 0,
      size: 0,
      speed_dl: 0,
      speed_ul: 0,
      peers: 0,
      seeds: 0,
      eta_secs: -1,
      scheduled_at: scheduledAt,
      source_id: sourceId || null,
    });

    console.log(`[Scheduler] Scheduled "${cleanName}" for ${new Date(scheduledAt).toISOString()}`);
    return { id, name: cleanName, scheduledAt };
  }

  /**
   * Core queue logic. Called periodically and on any download completion/removal.
   * - Finds overdue scheduled items.
   * - If no active download → start the first due item.
   * - If active download → mark overdue items as 'queued'.
   */
  async checkQueue() {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const now = Date.now();
      const overdueItems = dbGetOverdueScheduled(now);  // status='scheduled', scheduled_at <= now
      const pendingItems = dbGetPendingQueue();           // status='queued', scheduler-managed
      const hasActive = dbHasActiveDownload();

      // Combine: overdue scheduled + already-queued pending
      const toProcess = [...overdueItems, ...pendingItems];
      if (toProcess.length === 0) return;

      if (!hasActive) {
        // No active download — start the first item
        const next = toProcess[0];
        console.log(`[Scheduler] Starting "${next.name}" (was ${next.status})`);
        await this._startDownload(next);

        // If there are more items, mark them all as 'queued'
        for (const item of toProcess.slice(1)) {
          if (item.status !== 'queued') {
            dbUpdateTorrentStats(item.id, { status: 'queued' });
            console.log(`[Scheduler] Queued "${item.name}" (pending - waiting for active to finish)`);
          }
        }
      } else {
        // Active download running — mark all overdue scheduled items as 'queued'
        for (const item of overdueItems) {
          dbUpdateTorrentStats(item.id, { status: 'queued' });
          console.log(`[Scheduler] Queued "${item.name}" (active download running)`);
        }
      }
    } catch (e) {
      console.error('[Scheduler] checkQueue error:', e);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Force-start a scheduled or queued download immediately.
   * If another download is running, pause it first (or just start in parallel
   * for HTTP downloads, which naturally queue). For simplicity: start immediately.
   */
  async startNow(id: string): Promise<{ id: string; name: string }> {
    const row = dbGetTorrent(id);
    if (!row) throw new Error('Download not found');
    if (row.status !== 'scheduled' && row.status !== 'queued') {
      throw new Error(`Cannot force-start: download is in status "${row.status}"`);
    }
    await this._startDownload(row);
    return { id: row.id, name: row.name };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _startDownload(row: TorrentRow) {
    const destPath = row.dest_path || dbGetSetting('download_path');
    const tempDir = row.save_path || path.join(destPath, '.mn-temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    if (row.magnet.startsWith('magnet:')) {
      // Torrent download
      const eng = await getEngine();
      // Update the row's status to downloading before calling engine
      dbUpdateTorrentStats(row.id, { status: 'downloading', error_msg: null, started_at: row.started_at || Date.now() });
      await eng.addFromSchedule(row.magnet, row.id, row.name, tempDir, destPath);
      try {
        const capture = (globalThis as any).mnAnalyticsCapture;
        if (typeof capture === 'function') capture('download_started', { game_name: row.name, source_id: row.source_id || undefined, download_type: 'torrent', scheduled: true });
      } catch { /* Analytics must not affect queue execution. */ }
    } else if (row.magnet.startsWith('http://') || row.magnet.startsWith('https://')) {
      // HTTP direct download
      const httpEng = await getHttpEngine();
      dbUpdateTorrentStats(row.id, { status: 'downloading', error_msg: null, started_at: row.started_at || Date.now() });
      httpEng.resumeById(row.id, row.magnet, row.name, tempDir, destPath);
      try {
        const capture = (globalThis as any).mnAnalyticsCapture;
        if (typeof capture === 'function') capture('download_started', { game_name: row.name, source_id: row.source_id || undefined, download_type: 'http', scheduled: true });
      } catch { /* Analytics must not affect queue execution. */ }
    }
  }

  private _magnetId(magnetLink: string): string {
    try {
      const match = magnetLink.match(/urn:btih:([a-fA-F0-9]{40})/i);
      if (match) return match[1].toLowerCase();
      // Fallback: md5-based
      return crypto.createHash('md5').update(magnetLink).digest('hex') + '00000000';
    } catch {
      return crypto.createHash('md5').update(magnetLink).digest('hex') + '00000000';
    }
  }

  private _cleanFileName(name: string, url: string): string {
    const rawExt = path.extname(url.split('?')[0]) || '.exe';
    let clean = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!clean.toLowerCase().endsWith(rawExt.toLowerCase())) {
      clean += rawExt;
    }
    return clean;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const downloadScheduler = new DownloadScheduler();