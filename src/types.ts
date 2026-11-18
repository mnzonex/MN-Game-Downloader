export interface GameDownloadOption {
  type: 'magnet' | 'direct' | 'part';
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

export interface AppVersionInfo {
  currentVersion: string;
  latestVersion: string;
  isUpdateAvailable: boolean;
  updateSize: string;
  changelog: string[];
  downloadUrl: string;
  developer: string;
  nickname: string;
  whatsapp?: string;
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

export interface TorrentInspectFile {
  name: string;
  size: number;
}

export interface TorrentInspectResult {
  has_metadata: boolean;
  availability_known?: boolean;
  ok: boolean;
  name: string;
  totalSize: number;
  filesCount: number;
  files: TorrentInspectFile[];
  seeds: number;
  peers: number;
  error?: string;
}

export interface TorrentInfo {
  taskKind?: 'download' | 'repair';
  files?: { name: string; size: number; downloaded: number; status: string }[];
  id: string;
  name: string;
  progress: number;          // 0.0 – 1.0
  downloadSpeed: number;     // bytes/sec
  uploadSpeed: number;       // bytes/sec
  peers: number;
  seeds: number;
  size: number;              // total bytes
  etaSecs: number;           // -1 = unknown
  status: TorrentStatus;
  errorMsg?: string;
  addedAt: number;           // unix ms
  completedAt?: number;
  scheduledAt?: number;      // unix ms — when scheduled download should start
  hidden: boolean;           // true = completed+moved, hide from active list
}

export interface DownloadSettings {
  download_path: string;
  port_range: string;
  max_download_speed: string;  // '0' = unlimited
  max_upload_speed: string;
  seed_after_done: string;     // '0' | '1'
  speed_limit?: string;        // '0' | '2097152' | '5242880' | '10485760'
  defender_excluded?: string;  // '1' | '0'
}