import { DownloadTask, AppSettings } from '../types';

const STORAGE_KEYS = {
  TASKS: 'mn_game_downloader_tasks_v1',
  SETTINGS: 'mn_game_downloader_settings_v1',
  DEFENDER: 'mn_game_downloader_defender_v1',
  DISMISSED_UPDATE: 'mn_game_downloader_dismissed_update'
};

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDirectory: 'C:\\Users\\User\\AppData\\Roaming\\MN Game Downloader\\Games',
  maxParallelConnections: 8,
  autoExtractZipRar: true,
  windowsDefenderExclusionAdded: false,
  autoLaunchGames: false,
  simulatedNetworkOffline: false,
  developerInfo: {
    name: 'H M MADHUSHA NIMSARA',
    nickname: 'MN ZONEX Dev',
    whatsapp: 'https://wa.me/94776941748',
    supportPhone: '0776941748'
  }
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to load settings from storage', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings to storage', e);
  }
}

export function loadTasks(): DownloadTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TASKS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load download tasks', e);
  }
  return [];
}

export function saveTasks(tasks: DownloadTask[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
  } catch (e) {
    console.error('Failed to save tasks', e);
  }
}
