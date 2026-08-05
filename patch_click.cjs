const fs = require('fs');

const content = fs.readFileSync('src/components/SearchScraperView.tsx', 'utf8');

const newContent = content.replace(/onClick=\{\(\) => onStartDownload\(selectedGame, opt\)\}/g, `onClick={() => { setScheduleOption(opt); setScheduleModalOpen(true); }}`);

fs.writeFileSync('src/components/SearchScraperView.tsx', newContent);
console.log('done');
