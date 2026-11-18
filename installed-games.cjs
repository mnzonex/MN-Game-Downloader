const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const installer = file => /^(setup|install|unins|uninstall|dxsetup|vcredist|vc_redist|redist)([._\-\d ]|$)/i.test(path.basename(file, '.exe'));
function words(name) {
  return String(name).toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)|v?\d+(\.\d+)+.*/g, ' ')
    .replace(/\b(fitgirl|repack|edition|deluxe|ultimate|complete|game|the|of|and)\b/g, ' ').match(/[a-z0-9]+/g) || [];
}
function matches(title, installed) {
  const a = words(title), b = new Set(words(installed));
  return a.length > 0 && new Set(a).size === b.size && a.every(word => b.has(word));
}
function executableFromRecord(record) {
  // DisplayIcon is an executable path, never a command to execute.
  const icon = String(record.DisplayIcon || '').trim().replace(/,\s*-?\d+$/, '').replace(/^"(.*)"$/, '$1');
  if (!path.isAbsolute(icon) || path.extname(icon).toLowerCase() !== '.exe' || installer(icon)) return null;
  try { if (!fs.statSync(icon).isFile()) return null; } catch { return null; }
  const location = String(record.InstallLocation || '').trim().replace(/^"(.*)"$/, '$1');
  if (location) {
    const relative = path.relative(location, icon);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  }
  return icon;
}
function resolveInstalledGame(game, records) {
  const matchesFound = new Set();
  for (const record of records) {
    if (!matches(game.name, record.DisplayName)) continue;
    const exe = executableFromRecord(record);
    if (exe && (!game.installer || path.resolve(exe).toLowerCase() !== path.resolve(game.installer).toLowerCase())) matchesFound.add(exe);
  }
  return matchesFound.size === 1 ? [...matchesFound][0] : null;
}
function readInstalledGames() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const command = "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $items=@(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName } | Select-Object DisplayName,InstallLocation,DisplayIcon); ConvertTo-Json -InputObject $items -Compress";
  return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
    (error, stdout) => { if (error) return reject(error); try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]')); } catch (e) { reject(e); } }));
}
module.exports = { resolveInstalledGame, readInstalledGames, matches, executableFromRecord };