import { apiFetch } from './api';
import type { TorrentInfo, DownloadSettings, TorrentInspectResult } from '../types';

// ── Torrent actions ────────────────────────────────────────────────────────────

export async function inspectTorrent(magnetLink: string, timeout: number = 8): Promise<TorrentInspectResult> {
  const res = await apiFetch('/api/torrent/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetLink, timeout }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to inspect torrent' }));
    throw new Error(err.error || 'Failed to inspect torrent');
  }
  const data = await res.json();
  return { ...data, totalSize: data.total_size ?? 0, filesCount: data.files_count ?? 0 };

}

export async function addTorrent(magnetLink: string, gameName?: string, coverUrl?: string): Promise<{ id: string; name: string }> {
  const res = await apiFetch('/api/torrent/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetLink, gameName, coverUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Failed to start download');
  }
  return res.json();
}

export async function scheduleTorrent(
  magnetLink: string,
  gameName: string,
  scheduledAt: number,
  coverUrl?: string,
): Promise<{ id: string; name: string; scheduledAt: number }> {
  const res = await apiFetch('/api/torrent/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetLink, gameName, scheduledAt, coverUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Failed to schedule download');
  }
  return res.json();
}

export async function startNowTorrent(id: string): Promise<{ id: string; name: string }> {
  const res = await apiFetch('/api/torrent/start-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Failed to start download');
  }
  return res.json();
}

export async function listTorrents(): Promise<TorrentInfo[]> {
  const res = await apiFetch('/api/torrent/list');
  if (!res.ok) throw new Error('Failed to fetch torrent list');
  return res.json();
}

export async function pauseTorrent(id: string): Promise<void> {
  const res = await apiFetch('/api/torrent/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to pause');
}

export async function resumeTorrent(id: string): Promise<void> {
  const res = await apiFetch('/api/torrent/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to resume');
}

export async function deleteTorrent(id: string, deleteFiles: boolean): Promise<void> {
  const res = await apiFetch('/api/torrent/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, deleteFiles }),
  });
  if (!res.ok) throw new Error('Failed to delete');
}

export async function retryTorrent(id: string): Promise<void> {
  const res = await apiFetch('/api/torrent/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error('Failed to retry');
}

// ── Settings ───────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<DownloadSettings> {
  const res = await apiFetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

export async function saveSettings(settings: Partial<DownloadSettings>): Promise<void> {
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save settings');
}

export async function addDefenderExclusion(): Promise<{ ok: boolean; paths?: string[]; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = (window as any).electron;
  if (electron?.addDefenderExclusion) {
    return electron.addDefenderExclusion();
  }
  const res = await apiFetch('/api/settings/add-exclusion', {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to add exclusion' }));
    throw new Error(err.error || 'Failed to add exclusion');
  }
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—';
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatEta(etaSecs: number): string {
  if (etaSecs <= 0) return '—';
  if (etaSecs < 60) return `${etaSecs}s`;
  if (etaSecs < 3600) return `${Math.floor(etaSecs / 60)}m ${etaSecs % 60}s`;
  const h = Math.floor(etaSecs / 3600);
  const m = Math.floor((etaSecs % 3600) / 60);
  return `${h}h ${m}m`;
}