const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildInstalledGames, readSteamInstalledGamesFromRoots, readEpicInstalledGames } = require('../installed-games.cjs');

const root = path.resolve('.test-data', 'installed-discovery-' + Date.now());
fs.mkdirSync(root, { recursive: true });
const exe = name => {
  const file = path.join(root, name);
  fs.writeFileSync(file, 'fixture executable, never launched');
  return file;
};
const gameExe = exe('sample-game.exe');
const secondExe = exe('another-game.exe');
const setupExe = exe('setup.exe');
const steamRoot = path.join(root, 'Steam');
const steamApps = path.join(steamRoot, 'steamapps');
const common = path.join(steamApps, 'common', 'Sample Steam Game');
fs.mkdirSync(common, { recursive: true });
fs.writeFileSync(path.join(steamApps, 'appmanifest_12345.acf'),
  '"AppState"\\n{\\n "appid" "12345"\\n "name" "Sample Steam Game"\\n "StateFlags" "4"\\n "installdir" "Sample Steam Game"\\n}');
fs.writeFileSync(path.join(steamApps, 'appmanifest_12346.acf'),
  '"AppState"\\n{\\n "appid" "12346"\\n "name" "Uninstalled Game"\\n "StateFlags" "2"\\n "installdir" "Uninstalled Game"\\n}');
const steamGames = readSteamInstalledGamesFromRoots([steamRoot]);
assert.equal(steamGames.length, 1);
assert.equal(steamGames[0].name, 'Sample Steam Game');
assert.equal(steamGames[0].launchUri, 'steam://rungameid/12345');
assert.match(steamGames[0].coverUrl, /12345\/library_600x900\.jpg$/);

const epicRoot = path.join(root, 'ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
const epicInstall = path.join(root, 'Epic Games', 'Fixture Epic Game');
fs.mkdirSync(epicRoot, { recursive: true });
fs.mkdirSync(epicInstall, { recursive: true });
const epicExe = path.join(epicInstall, 'EpicGame.exe');
fs.writeFileSync(epicExe, 'fixture executable, never launched');
const oldProgramData = process.env.ProgramData;
process.env.ProgramData = path.join(root, 'ProgramData');
fs.writeFileSync(path.join(epicRoot, 'fixture.item'), JSON.stringify({
  DisplayName: 'Fixture Epic Game',
  AppName: 'FixtureEpicGame',
  InstallLocation: epicInstall,
  LaunchExecutable: 'EpicGame.exe',
}));
const epicGames = readEpicInstalledGames();
assert.equal(epicGames.length, 1);
assert.equal(epicGames[0].executable, epicExe);
assert.equal(epicGames[0].launchUri.startsWith('com.epicgames.launcher:'), true);
if (oldProgramData === undefined) delete process.env.ProgramData;
else process.env.ProgramData = oldProgramData;

const appExe = exe('mn-game-downloader.exe');
const records = [
  { DisplayName: 'Sample Windows Game', InstallLocation: root, DisplayIcon: gameExe, Publisher: 'Test Game Studio' },
  { DisplayName: 'Visual C++ Redistributable', InstallLocation: root, DisplayIcon: secondExe },
  { DisplayName: 'Installer Only Game', InstallLocation: root, DisplayIcon: setupExe },
  { DisplayName: 'Sample Steam Game', InstallLocation: root, DisplayIcon: secondExe, Publisher: 'Valve Corporation' },
  { DisplayName: 'MN Game Downloader 1.2.8', InstallLocation: root, DisplayIcon: appExe, Publisher: 'MN ZONEX Dev' },
];
const result = buildInstalledGames({
  records,
  steamGames,
  epicGames,
  gogGames: [{ id: 'gog:777', name: 'A GOG Game', source: 'GOG', sourceId: 'gog', installLocation: root, executable: gameExe }],
});
const names = result.map(game => game.name);
assert(names.includes('Sample Windows Game'));
assert(!names.includes('MN Game Downloader 1.2.8'), 'the downloader itself must not appear as an installed game');
assert(names.includes('Sample Steam Game'));
assert(names.includes('Fixture Epic Game'));
assert(names.includes('A GOG Game'));
assert(!names.includes('Visual C++ Redistributable'));
assert(!names.includes('Installer Only Game'));
assert.equal(result.filter(game => game.name === 'Sample Steam Game').length, 1, 'Steam manifests take priority over matching Windows uninstall records');
assert(!result.some(game => game.executable === setupExe));
console.log('Installed-games discovery tests passed: Steam/Epic manifests, GOG/Windows registry records, app/launcher/runtime filtering, de-duplication and installer exclusion.');