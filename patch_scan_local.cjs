const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const scanFolderRegex = /function scanLocalGamesFolder\(\) \{[\s\S]*?libraryGames\.set\(gameId, gameRecord\);/;

const newScan = `function scanLocalGamesFolder() {
  if (!fs.existsSync(GAMES_DIR)) return;

  try {
    const entries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const gameFolder = entry.name;
        const gameDir = path.resolve(GAMES_DIR, gameFolder);
        const metaPath = path.resolve(gameDir, 'metadata.json');

        let metadata: any = {};
        if (fs.existsSync(metaPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          } catch {}
        } else {
           // Skip if there's an aria2 active download going on in here
           const files = fs.readdirSync(gameDir);
           if (files.some(f => f.endsWith('.aria2'))) {
             continue; // Currently downloading
           }
           const detected = scanForSetupExe(gameDir);
           if (!detected) {
             continue; // Just cover images or empty folder
           }
        }

        const gameId = metadata.id || \`game-\${gameFolder}\`;
        const title = metadata.title || gameFolder;
        const repacker = metadata.repacker || 'FitGirl Repacks';
        const totalSizeBytes = metadata.totalSizeBytes || 0;

        let coverUrl = metadata.cover || '';
        let localCoverFilename = '';
        for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
          if (fs.existsSync(path.resolve(gameDir, \`cover.\${ext}\`))) {
            localCoverFilename = \`cover.\${ext}\`;
            break;
          }
        }

        if (localCoverFilename) {
          coverUrl = \`/api/games/local-cover?folder=\${encodeURIComponent(gameFolder)}&file=\${localCoverFilename}\`;
        }

        const setupExePath = metadata.setupExePath || scanForSetupExe(gameDir) || path.resolve(gameDir, 'setup.exe');

        const gameRecord = {
          id: gameId,
          title,
          cover: coverUrl,
          repacker,
          installDate: metadata.installDate || new Date().toISOString(),
          totalSizeBytes,
          installPath: gameDir,
          setupExePath,
          hasSetupExe: fs.existsSync(setupExePath) || true
        };
        libraryGames.set(gameId, gameRecord);`;

content = content.replace(scanFolderRegex, newScan);
fs.writeFileSync('server.ts', content);
console.log('done');
