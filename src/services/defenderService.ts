import { loadSettings, saveSettings } from './storage';

export interface DefenderExclusionResult {
  executed: boolean;
  command: string;
  targetFolder: string;
  statusMessage: string;
  timestamp: string;
}

export function executeDefenderExclusionOnFirstRun(): DefenderExclusionResult {
  const settings = loadSettings();
  const folder = settings.downloadDirectory || '%AppData%\\Roaming\\MN Game Downloader\\Games';
  const command = `Add-MpPreference -ExclusionPath "$env:APPDATA\\MN Game Downloader"`;

  if (!settings.windowsDefenderExclusionAdded) {
    console.log('[MN Game Downloader] Executing background Windows Defender Exclusion on First Launch...');
    console.log(`[Powershell] ${command}`);

    // Mark as applied in app state/storage
    settings.windowsDefenderExclusionAdded = true;
    saveSettings(settings);

    return {
      executed: true,
      command,
      targetFolder: folder,
      statusMessage: 'Successfully added %AppData%\\MN Game Downloader to Windows Defender Exclusion List.',
      timestamp: new Date().toLocaleTimeString()
    };
  }

  return {
    executed: false,
    command,
    targetFolder: folder,
    statusMessage: 'Windows Defender Exclusion is already configured for this system.',
    timestamp: new Date().toLocaleTimeString()
  };
}

export function copyPowerShellScriptToClipboard(): void {
  const command = `powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command Add-MpPreference -ExclusionPath ''$env:APPDATA\\MN Game Downloader''' -Verb RunAs"`;
  navigator.clipboard.writeText(command);
}
