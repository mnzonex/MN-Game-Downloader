const fs = require('fs');

const content = fs.readFileSync('server.ts', 'utf8');

const scanFolderRegex = /function scanLocalGamesFolder\(\) \{[\s\S]*?libraryGames\.set\(gameId, gameRecord\);/g;

const matches = content.match(scanFolderRegex);
console.log(matches ? matches.length : 0);
