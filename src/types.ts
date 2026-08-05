export interface GameDownloadOption {
  type: 'direct' | 'part';
  label: string;
  url: string | string[];
  speedEstimate: string;
}

export interface GameItem {
  id: string;
  title: string;
  cover: string;
  size: string;
  repackSizeStr?: string;
  originalSizeStr?: string;
  repacker: string;
  siteBadge: string;
  siteUrl: string;
  category: string;
  description: string;
  releaseDate: string;
  screenshots: string[];
  downloads: GameDownloadOption[];
}

export type DownloadStatus = 
  | 'queued'
  | 'preparing'
  | 'fetching_torrent'
  | 'downloading'
  | 'paused'
  | 'waiting_reconnect'
  | 'extracting'
  | 'completed'
  | 'error';

export interface ChunkProgress {
  id: number;
  progressPercent: number;
  speedBps: number;
  downloadedBytes: number;
  totalBytes: number;
  filename?: string;
}

export interface DownloadTask {
  id: string;
  gameId: string;
  title: string;
  cover: string;
  repacker: string;
  siteBadge: string;
  downloadUrl: string | string[];
  downloadType: 'magnet' | 'direct' | 'torrent' | 'part' | string;
  totalSizeBytes: number;
  downloadedBytes: number;
  speedBps: number;
  progressPercent: number;
  status: DownloadStatus;
  torrentFileSize?: number;
  chunks: ChunkProgress[];
  extractProgress: number;
  addedAt: number;
  completedAt?: number;
  errorMsg?: string;
  retryAttempts: number;
  installDirectory: string;
  hasSetupExe: boolean;
  hasMainExe: boolean;
  exePath?: string;
  isInstalled?: boolean;
  installedExePath?: string;
}

export interface AppVersionInfo {
  currentVersion: string;
  latestVersion: string;
  isUpdateAvailable: boolean;
  updateSize: string;
  changelog: string[];
  downloadUrl: string;
  developer: string;
  nickname: string;
  whatsapp: string;
}

export interface AppSettings {
  downloadDirectory: string;
  maxParallelConnections: number;
  autoExtractZipRar: boolean;
  windowsDefenderExclusionAdded: boolean;
  autoLaunchGames: boolean;
  simulatedNetworkOffline: boolean;
  developerInfo: {
    name: string;
    nickname: string;
    whatsapp: string;
    supportPhone: string;
  };
}
