const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const installer = file => /^(setup|install|unins|uninstall|dxsetup|vcredist|vc_redist|redist)([._\-\d ]|$)/i.test(path.basename(file || '', '.exe'));
const launcher = file => /^(steam|epicgameslauncher|goggalaxy|eadesktop|eaapp|ubisoftconnect|battlenet|rockstarlauncher|riotclientservices|xboxpcapp|gamebar)([._\-\d ]|$)/i.test(path.basename(file || '', '.exe'));

const KNOWN_GAME_PUBLISHERS = [
  'rockstar', 'ubisoft', 'electronic arts', 'ea games', 'activision', 'blizzard',
  'bethesda', 'valve', 'epic games', 'cd projekt', 'bandai namco', 'capcom',
  'square enix', 'sega', 'take-two', '2k games', 'warner bros', 'wb games',
  'riot games', 'fromsoftware', 'mihoyo', 'hoyoverse', 'wargaming', 'gaijin',
  'netease', 'tencent', 'paradox interactive', 'thq nordic', 'focus entertainment',
  'deep silver', 'koei', 'techland', 'remedy', '505 games', 'gearbox',
  'devolver digital', 'larian', 'saber interactive', 'bungie', 'hello games',
  'team cherry', 'concernedape', 're-logic', 'mojang', 'microsoft studios',
  'xbox game studios', 'playstation pc', 'guerrilla', 'naughty dog',
  'frontier developments', 'scs software', 'giants software', 'konami', 'nacon',
  'milestone', 'codemasters', 'asobo', 'avalanche studios', 'io interactive',
  'tinybuild', 'coffee stain', 'game studio',
];

const NON_GAME_NAMES = [
  /\bvisual studio\b/i, /\bvisual c\+\+/i, /\bredistributable\b/i, /\bruntime\b/i,
  /\bdirectx\b/i, /\.net\b/i, /\bframework\b/i, /\bsdk\b/i, /\bdriver\b/i,
  /\bfirmware\b/i, /\bupdate\b/i, /\bsecurity\b/i, /\bbrowser\b/i, /\bantivirus\b/i,
  /\bpython\b/i, /\bnode\.?js\b/i, /\bjava\b/i, /\b7-?zip\b/i, /\bwinrar\b/i,
  /\bdiscord\b/i, /\bobs studio\b/i, /\bstreamlabs\b/i, /\bnvidia\b/i, /\bamd\b/i,
  /\bintel\b/i, /\brealtek\b/i, /\blogitech\b/i, /\bacer\b/i, /\brazer synapse\b/i,
  /^steam$/i, /^epic games launcher$/i, /^gog galaxy$/i, /^ubisoft connect$/i, /^ea app$/i,
  /^battle\.?net$/i, /^rockstar games launcher$/i, /^riot client$/i,
  /\bsteamworks common redistributables\b/i, /\bepic online services\b/i,
  /\bepic games launcher\b/i, /\bgog galaxy\b/i, /\bubisoft connect\b/i,
  /\bea app\b/i, /\belectronic arts app\b/i, /\bbattle\.?net\b/i,
  /\brockstar games launcher\b/i, /\briot client\b/i, /\bxbox app\b/i,
  /\blauncher\b/i, /\buninstall\b/i, /\bremove only\b/i, /\bservices?\b/i,
  /\bdeveloper (command|powershell)\b/i, /\badministrative tools\b/i,
  /\bapplication verifier\b/i, /\bcharacter map\b/i, /\bcommand prompt\b/i,
  /\bdisk cleanup\b/i, /\bmemory diagnostics\b/i, /\bmetaeditor\b/i,
  /\bvisual studio\b/i, /\btools?\s*\(?(32|64)-bit\)?$/i,
  /\bwindows (powershell|media player|app cert kit)\b/i,
  /\bgame downloader\b/i, /\bdownload manager\b/i, /\bmedia grab\b/i, /\bmedia downloader\b/i,
  /\btask manager\b/i, /\bregistry editor\b/i, /\bsystem (configuration|information)\b/i,
  /\bresource monitor\b/i, /\bon-screen keyboard\b/i, /\bmagnify\b/i,
  /\bsteps recorder\b/i, /\bremote desktop connection\b/i, /\biscsi initiator\b/i,
  /\bodbc data sources\b/i, /\bcheck for updates\b/i,
  /\bgoogle play games\b/i, /\bbluestacks (services|store|multi-instance manager)\b/i,
  /\bmicrosoft edge\b/i, /\bgoogle chrome\b/i, /\bmozilla firefox\b/i,
  /\bgeforce experience\b/i, /\badrenalin\b/i, /\banti.?cheat\b/i,
];

function isGameLikeName(name) {
  const value = String(name || '').trim();
  return value.length >= 2 && value.length <= 180 && !NON_GAME_NAMES.some(pattern => pattern.test(value));
}
function isGamePublisher(value) {
  const publisher = String(value || '').toLowerCase();
  return KNOWN_GAME_PUBLISHERS.some(name => publisher.includes(name.toLowerCase()));
}
function isGameInstallRecord(record) {
  const name = String(record.DisplayName || '').trim();
  if (!isGameLikeName(name)) return false;
  const publisher = record.Publisher || record.CompanyName || '';
  const product = [record.ProductName, record.FileDescription].filter(Boolean).join(' ');
  const titleInMetadata = product && normalizedName(product).includes(normalizedName(name));
  const location = cleanPath(record.InstallLocation);
  const gameInstallPath = /\\(?:games?|steamapps\\common|epic games|gog games?)\\/i.test(location);
  const gameWord = /\b(game|games|simulator|racing|adventure|shooter|role.?playing|rpg)\b/i.test(name);
  return isGamePublisher(publisher) || isGamePublisher(record.CompanyName) ||
    Boolean(titleInMetadata && isGamePublisher(record.CompanyName)) || gameInstallPath || gameWord;
}
function words(name) {
  return String(name).toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)|v?\d+(\.\d+)+.*/g, ' ')
    .replace(/\b(fitgirl|repack|edition|deluxe|ultimate|complete|game|the|of|and)\b/g, ' ')
    .match(/[a-z0-9]+/g) || [];
}
function matches(title, installed) {
  const a = words(title), b = new Set(words(installed));
  return a.length > 0 && new Set(a).size === b.size && a.every(word => b.has(word));
}
function normalizedName(value) {
  return words(value).sort().join(' ');
}
function safeId(prefix, value) {
  return prefix + ':' + crypto.createHash('sha256').update(String(value).toLowerCase()).digest('hex').slice(0, 20);
}
function cleanPath(value) {
  return String(value || '').trim().replace(/^"(.*)"$/, '$1');
}
function executableFromRecord(record) {
  const icon = cleanPath(String(record.DisplayIcon || '').trim().replace(/,\s*-?\d+$/, ''));
  if (!path.isAbsolute(icon) || path.extname(icon).toLowerCase() !== '.exe' || installer(icon) || launcher(icon)) return null;
  try { if (!fs.statSync(icon).isFile()) return null; } catch { return null; }
  const location = cleanPath(record.InstallLocation);
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
function parseJsonArray(stdout) {
  const parsed = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim() || '[]');
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
function powershell(script, timeout = 20000) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => execFile(executable,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error) return reject(error);
      try { resolve(parseJsonArray(stdout)); } catch (parseError) { reject(parseError); }
    }));
}

function readInstalledGames() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "$keys=@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); " +
    "$items=@(foreach($key in $keys){Get-ItemProperty $key | Where-Object {$_.DisplayName} | ForEach-Object {$icon=[Environment]::ExpandEnvironmentVariables([string]$_.DisplayIcon); $icon=$icon -replace ',\\s*-?\\d+$','' -replace '^\"|\"$',''; $meta=$null; if($icon -and (Test-Path -LiteralPath $icon)){try{$meta=[Diagnostics.FileVersionInfo]::GetVersionInfo($icon)}catch{}}; [pscustomobject]@{DisplayName=$_.DisplayName;InstallLocation=[Environment]::ExpandEnvironmentVariables([string]$_.InstallLocation);DisplayIcon=$icon;Publisher=$_.Publisher;ProductName=$meta.ProductName;FileDescription=$meta.FileDescription;CompanyName=$meta.CompanyName}}}); " +
    "ConvertTo-Json -InputObject $items -Compress";
  return powershell(script);
}

function readSteamRoots() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Steam'),
    process.env.HOMEDRIVE && process.env.HOMEPATH && path.join(process.env.HOMEDRIVE, process.env.HOMEPATH, 'Steam'),
  ].filter(Boolean);
  return Promise.resolve().then(async () => {
    if (process.platform !== 'win32') return [];
    const script = "$ErrorActionPreference='SilentlyContinue'; $values=@(); " +
      "$keys=@('HKCU:\\Software\\Valve\\Steam','HKLM:\\Software\\WOW6432Node\\Valve\\Steam','HKLM:\\Software\\Valve\\Steam'); " +
      "foreach($key in $keys){$v=(Get-ItemProperty -Path $key -Name SteamPath -ErrorAction SilentlyContinue).SteamPath; if($v){$values += $v}}; " +
      "$values | Select-Object -Unique | ConvertTo-Json -Compress";
    try {
      const registered = await powershell(script);
      return [...new Set([...candidates, ...registered.map(x => String(x))].map(cleanPath).filter(p => p && fs.existsSync(path.join(p, 'steamapps'))))];
    } catch {
      return [...new Set(candidates.filter(p => fs.existsSync(path.join(p, 'steamapps'))))];
    }
  });
}

function getVdfValue(text, key) {
  const match = String(text).match(new RegExp('"' + key + '"\\s*"([^"]*)"', 'i'));
  return match ? match[1].replace(/\\\\/g, '\\') : '';
}
function readSteamInstalledGamesFromRoots(roots) {
  const libraries = new Set(roots);
  for (const root of roots) {
    const file = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) {
        const value = match[1].replace(/\\\\/g, '\\');
        if (fs.existsSync(path.join(value, 'steamapps'))) libraries.add(value);
      }
    } catch { /* Older Steam installs may not have libraryfolders.vdf. */ }
  }

  const games = [];
  for (const library of libraries) {
    const steamApps = path.join(library, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(steamApps).filter(name => /^appmanifest_\d+\.acf$/i.test(name)); } catch { continue; }
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(steamApps, file), 'utf8');
        const appId = getVdfValue(text, 'appid');
        const name = getVdfValue(text, 'name');
        const installDir = getVdfValue(text, 'installdir');
        const stateFlags = Number(getVdfValue(text, 'StateFlags') || 0);
        if (!/^\d{1,12}$/.test(appId) || !isGameLikeName(name) || !(stateFlags & 4) || !installDir) continue;
        const installLocation = path.join(steamApps, 'common', installDir);
        if (!fs.existsSync(installLocation)) continue;
        games.push({
          id: 'steam:' + appId,
          name,
          source: 'Steam',
          sourceId: 'steam',
          appId,
          installLocation,
          launchUri: 'steam://rungameid/' + appId,
          coverUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/' + appId + '/library_600x900.jpg',
          headerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/' + appId + '/header.jpg',
        });
      } catch { /* One malformed manifest does not block the rest. */ }
    }
  }
  return games;
}

function readEpicInstalledGames() {
  const roots = [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests',
  ].filter(Boolean);
  const root = roots.find(value => fs.existsSync(value));
  if (!root) return [];
  const games = [];
  let files = [];
  try { files = fs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.item')); } catch { return games; }
  for (const file of files) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      const name = String(manifest.DisplayName || manifest.AppName || '').trim();
      const installLocation = cleanPath(manifest.InstallLocation);
      const appName = String(manifest.AppName || '');
      if (!isGameLikeName(name) || !installLocation || !fs.existsSync(installLocation)) continue;
      const relativeExe = cleanPath(manifest.LaunchExecutable).replace(/[\\/]+/g, path.sep);
      const executable = relativeExe && path.extname(relativeExe).toLowerCase() === '.exe'
        ? path.resolve(installLocation, relativeExe) : '';
      const relative = executable ? path.relative(installLocation, executable) : '';
      const validExecutable = executable && !relative.startsWith('..') && !path.isAbsolute(relative)
        && !installer(executable) && !launcher(executable) && fs.existsSync(executable);
      if (!validExecutable && !appName) continue;
      games.push({
        id: 'epic:' + (appName || manifest.CatalogItemId || safeId('app', name)),
        name,
        source: 'Epic Games',
        sourceId: 'epic',
        appName,
        installLocation,
        executable: validExecutable ? executable : undefined,
        launchUri: appName ? 'com.epicgames.launcher://apps/' + encodeURIComponent(appName) + '?action=launch&silent=true' : undefined,
      });
    } catch { /* Ignore corrupt, partial or unrelated manifests. */ }
  }
  return games;
}

function readGogInstalledGames(records) {
  const games = [];
  for (const record of records) {
    const location = cleanPath(record.path || record.InstallLocation);
    const rawExe = cleanPath(record.exe || record.Executable || record.DisplayIcon);
    if (!location || !fs.existsSync(location)) continue;
    let executable = rawExe;
    if (executable.includes(',')) executable = executable.replace(/,\s*-?\d+$/, '');
    if (executable && !path.isAbsolute(executable)) executable = path.resolve(location, executable);
    if (!executable || path.extname(executable).toLowerCase() !== '.exe' || installer(executable) || launcher(executable) || !fs.existsSync(executable)) executable = '';
    const name = String(record.name || record.DisplayName || '').trim();
    if (!name || !executable || !isGameLikeName(name)) continue;
    games.push({
      id: 'gog:' + String(record.gameID || record.gameId || safeId('gog', name)),
      name,
      source: 'GOG',
      sourceId: 'gog',
      installLocation: location,
      executable,
    });
  }
  return games;
}

function readGogRegistryGames() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "$roots=@('HKLM:\\Software\\GOG.com\\Games\\*','HKLM:\\Software\\WOW6432Node\\GOG.com\\Games\\*','HKCU:\\Software\\GOG.com\\Games\\*'); " +
    "$items=@(foreach($root in $roots){Get-ItemProperty $root | Select-Object gameID,gameId,gameName,path,exe}); " +
    "ConvertTo-Json -InputObject $items -Compress";
  return powershell(script).catch(() => []);
}

function buildInstalledGames({ records = [], steamGames = [], epicGames = [], gogGames = [] } = {}) {
  const games = [...steamGames, ...epicGames, ...gogGames];
  for (const record of records) {
    const name = String(record.DisplayName || '').trim();
    if (!isGameInstallRecord(record)) continue;
    const executable = executableFromRecord(record);
    if (!executable) continue;
    const installLocation = cleanPath(record.InstallLocation) || path.dirname(executable);
    games.push({
      id: safeId('windows', name + '|' + installLocation),
      name,
      source: 'Windows',
      sourceId: 'windows',
      installLocation,
      executable,
    });
  }


  const unique = new Map();
  for (const game of games) {
    const key = normalizedName(game.name);
    if (!key) continue;
    const current = unique.get(key);
    const sourcePriority = { steam: 4, epic: 3, gog: 3, windows: 1 };
    if (!current || (sourcePriority[game.sourceId] || 0) > (sourcePriority[current.sourceId] || 0)) {
      unique.set(key, { ...current, ...game, executable: game.executable || current?.executable, coverUrl: game.coverUrl || current?.coverUrl });
    } else {
      if (!current.executable && game.executable) current.executable = game.executable;
      if (!current.coverUrl && game.coverUrl) current.coverUrl = game.coverUrl;
      if (!current.installLocation && game.installLocation) current.installLocation = game.installLocation;
    }
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function discoverInstalledGames() {
  if (process.platform !== 'win32') return [];
  const [records, steamRoots, gogRecords] = await Promise.all([
    readInstalledGames().catch(() => []),
    readSteamRoots().catch(() => []),
    readGogRegistryGames().catch(() => []),
  ]);
  const steamGames = readSteamInstalledGamesFromRoots(steamRoots);
  const epicGames = readEpicInstalledGames();
  const gogGames = readGogInstalledGames(gogRecords);
  return buildInstalledGames({ records, steamGames, epicGames, gogGames });
}

module.exports = {
  resolveInstalledGame,
  readInstalledGames,
  matches,
  executableFromRecord,
  isGameLikeName,
  isGamePublisher,
  isGameInstallRecord,
  parseVdfValue: getVdfValue,
  readSteamInstalledGamesFromRoots,
  readEpicInstalledGames,
  buildInstalledGames,
  discoverInstalledGames,
};