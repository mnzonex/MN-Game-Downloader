/**
 * db.ts — SQLite persistence layer for the MN torrent engine.
 * Uses better-sqlite3 (synchronous API — perfect for Express route handlers).
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// ── Path resolution ────────────────────────────────────────────────────────────
function getDataDir(): string {
  if (process.env.MN_DATA_DIR) return process.env.MN_DATA_DIR;
  return path.join(process.cwd(), '.mn-data');
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'mn-engine.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS torrents (
      id           TEXT PRIMARY KEY,       -- infohash (40 hex chars)
      name         TEXT NOT NULL,
      magnet       TEXT NOT NULL,
      save_path    TEXT NOT NULL,          -- hidden internal temp dir
      dest_path    TEXT NOT NULL,          -- user's destination folder
      status       TEXT NOT NULL DEFAULT 'queued',
                                          -- scheduled|queued|downloading|paused|moving|completed|error
      error_msg    TEXT,
      progress     REAL NOT NULL DEFAULT 0.0,
      size         INTEGER NOT NULL DEFAULT 0,
      speed_dl     INTEGER NOT NULL DEFAULT 0,
      speed_ul     INTEGER NOT NULL DEFAULT 0,
      peers        INTEGER NOT NULL DEFAULT 0,
      seeds        INTEGER NOT NULL DEFAULT 0,
      eta_secs     INTEGER NOT NULL DEFAULT -1,
      added_at     INTEGER NOT NULL,
      completed_at INTEGER,
      scheduled_at INTEGER,               -- unix ms — when to auto-start (null = not scheduled)
      hidden       INTEGER NOT NULL DEFAULT 0  -- 1 = completed+moved, hide from active list
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate existing databases: add scheduled_at column if missing
  try {
    const cols = db.prepare(`PRAGMA table_info(torrents)`).all() as { name: string }[];
    if (!cols.some(c => c.name === 'task_kind')) db.exec("ALTER TABLE torrents ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'download'");
    const hasScheduledAt = cols.some(c => c.name === 'scheduled_at');
    if (!hasScheduledAt) {
      db.exec(`ALTER TABLE torrents ADD COLUMN scheduled_at INTEGER`);
      console.log('[DB] Migrated: added scheduled_at column to torrents table.');
    }
  } catch (e) {
    console.error('[DB] Migration check failed:', e);
  }

  // Default settings
  const defaultSettings: Record<string, string> = {
    download_path: getDefaultDownloadPath(),
    max_download_speed: '0',   // 0 = unlimited
    max_upload_speed:   '0',
    port_range:         '6881-6891',
    seed_after_done:    '0',   // 0 = no seeding (stop & remove after move)
  };

  const insert = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaultSettings)) insert.run(k, v);


}

function getDefaultDownloadPath(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(homeDir, 'Downloads');
}

// ── Torrent CRUD ───────────────────────────────────────────────────────────────

export interface TorrentRow {
  id: string;
  name: string;
  magnet: string;
  save_path: string;
  dest_path: string;
  status: TorrentStatus;
  error_msg: string | null;
  progress: number;
  size: number;
  speed_dl: number;
  speed_ul: number;
  peers: number;
  seeds: number;
  eta_secs: number;
  added_at: number;
  completed_at: number | null;
  scheduled_at: number | null;  // unix ms — when to auto-start (null = not scheduled)
  hidden: number;
  task_kind?: string;
}

export type TorrentStatus =
  | 'scheduled'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'repairing'
  | 'moving'
  | 'completed'
  | 'error';

export function dbInsertTorrent(row: Omit<TorrentRow, 'added_at' | 'completed_at' | 'hidden' | 'scheduled_at'> & { scheduled_at?: number | null }) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO torrents
      (id, name, magnet, save_path, dest_path, status, error_msg,
       progress, size, speed_dl, speed_ul, peers, seeds, eta_secs,
       scheduled_at, added_at, hidden, task_kind)
    VALUES
      (@id, @name, @magnet, @save_path, @dest_path, @status, @error_msg,
       @progress, @size, @speed_dl, @speed_ul, @peers, @seeds, @eta_secs,
       @scheduled_at, ${Date.now()}, 0, @task_kind)
  `).run({ scheduled_at: null, task_kind: 'download', ...row });
}

export function dbUpdateTorrentStats(id: string, patch: Partial<TorrentRow>) {
  const db = getDb();
  const sets = Object.keys(patch)
    .map(k => `${k} = @${k}`)
    .join(', ');
  if (!sets) return;
  db.prepare(`UPDATE torrents SET ${sets} WHERE id = @id`)
    .run({ id, ...patch });
}

export function dbMarkCompleted(id: string) {
  const db = getDb();
  db.prepare(`
    UPDATE torrents
    SET status = 'completed', progress = 1.0, completed_at = ?, hidden = 1
    WHERE id = ?
  `).run(Date.now(), id);
}

export function dbMarkError(id: string, msg: string) {
  dbUpdateTorrentStats(id, { status: 'error', error_msg: msg } as Partial<TorrentRow>);
}

export function dbGetAllTorrents(): TorrentRow[] {
  return getDb().prepare(`SELECT * FROM torrents ORDER BY added_at DESC`).all() as TorrentRow[];
}

export function dbGetTorrent(id: string): TorrentRow | null {
  return (getDb().prepare(`SELECT * FROM torrents WHERE id = ?`).get(id) as TorrentRow) ?? null;
}

export function dbDeleteTorrent(id: string) {
  getDb().prepare(`DELETE FROM torrents WHERE id = ?`).run(id);
}

/** Returns all scheduled items whose scheduled_at time has passed. */
export function dbGetOverdueScheduled(nowMs: number): TorrentRow[] {
  return getDb().prepare(`
    SELECT * FROM torrents
    WHERE status = 'scheduled' AND scheduled_at <= ? AND hidden = 0
    ORDER BY scheduled_at ASC, added_at ASC
  `).all(nowMs) as TorrentRow[];
}

/** Returns all items in 'queued (pending)' state, ordered oldest first. */
export function dbGetPendingQueue(): TorrentRow[] {
  return getDb().prepare(`
    SELECT * FROM torrents
    WHERE status = 'queued' AND scheduled_at IS NOT NULL AND hidden = 0
    ORDER BY scheduled_at ASC, added_at ASC
  `).all() as TorrentRow[];
}

/** Returns true if any download is currently active. */
export function dbHasActiveDownload(): boolean {
  const row = getDb().prepare(`
    SELECT id FROM torrents
    WHERE status IN ('downloading', 'verifying', 'repairing', 'moving') AND hidden = 0
    LIMIT 1
  `).get();
  return !!row;
}

// ── Settings ───────────────────────────────────────────────────────────────────

export function dbGetSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function dbSetSetting(key: string, value: string) {
  getDb().prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

export function dbGetSetting(key: string, fallback = ''): string {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}