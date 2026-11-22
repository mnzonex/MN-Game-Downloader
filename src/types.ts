import type { SourceId } from "./sources/registry";

export interface GameDownloadOption {
  type: "magnet" | "direct" | "part";
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
  developer?: string;
  publisher?: string;
  repacker: string;
  siteBadge: string;
  sourceId?: SourceId;
  sourceAction?: "built-in-download" | "official-store";
  siteUrl: string;
  category: string;
  description: string;
  releaseDate: string;
  screenshots: string[];
  downloads: GameDownloadOption[];
  isFreeToPlay?: boolean;
  offerStatus?: "free-now" | "upcoming";
  offerStart?: string;
  offerEnd?: string;
  reviewSummary?: string;
  reviewPercent?: number;
}

export interface AppVersionInfo {
  currentVersion: string;
  latestVersion: string;
  isUpdateAvailable: boolean;
  updateSize: string;
  changelog: string[];
  downloadUrl: string;
}

export type TorrentStatus =
  | "scheduled"
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "repairing"
  | "moving"
  | "completed"
  | "error";

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
  taskKind?: "download" | "repair";
  files?: { name: string; size: number; downloaded: number; status: string }[];
  id: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  size: number;
  etaSecs: number;
  status: TorrentStatus;
  errorMsg?: string;
  addedAt: number;
  completedAt?: number;
  scheduledAt?: number;
  hidden: boolean;
}

export interface DownloadSettings {
  download_path: string;
  port_range: string;
  max_download_speed: string;
  max_upload_speed: string;
  seed_after_done: string;
  speed_limit?: string;
  appearance?: "light" | "dark";
  analytics_enabled?: "0" | "1";
}