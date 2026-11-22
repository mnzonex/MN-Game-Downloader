import fs from 'node:fs';
import path from 'node:path';

export interface TorrentTempCleanupTarget {
  save_path: string;
  dest_path: string;
  name: string;
}

/**
 * Remove only the temporary payload for an in-progress torrent.
 * The final download directory is deliberately never touched here: it may
 * already contain a previously completed copy of the same game.
 */
export function removeTorrentTempPayload(row: TorrentTempCleanupTarget): boolean {
  if (!row || typeof row.save_path !== 'string' || typeof row.dest_path !== 'string'
    || typeof row.name !== 'string' || !row.name.trim()) return false;

  const tempRoot = path.resolve(row.save_path);
  const destinationRoot = path.resolve(row.dest_path);
  if (tempRoot === destinationRoot || path.basename(tempRoot).toLowerCase() !== '.mn-temp') return false;

  // Torrent root names must be one path segment; never let metadata escape .mn-temp.
  const name = row.name.trim();
  if (name === '.' || name === '..' || path.basename(name) !== name
    || name.includes('/') || name.includes('\\') || name.includes('\0')) return false;

  const payload = path.resolve(tempRoot, name);
  const relative = path.relative(tempRoot, payload);
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) return false;

  try {
    if (fs.existsSync(payload)) fs.rmSync(payload, { recursive: true, force: true });
  } catch {
    return false;
  }

  // .mn-temp is shared by downloads; remove it only when no other task data remains.
  try {
    if (fs.existsSync(tempRoot) && fs.readdirSync(tempRoot).length === 0) fs.rmdirSync(tempRoot);
  } catch { /* Keep the shared temp directory if anything still uses it. */ }

  return true;
}