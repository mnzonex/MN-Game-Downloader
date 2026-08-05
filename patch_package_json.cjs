const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.scripts['dist:win'] = 'npm run build && electron-builder --win nsis';

pkg.build.publish = {
  provider: 'github',
  owner: 'YourGitHubUsername',
  repo: 'mn-game-downloader'
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('done');
