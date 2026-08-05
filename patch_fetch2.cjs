const fs = require('fs');

const content = fs.readFileSync('src/components/SearchScraperView.tsx', 'utf8');

const regex = /setScheduleModalOpen\(false\);\n                      \}\)\.catch\(err => \{/g;
const replacement = `setScheduleModalOpen(false);
                        window.dispatchEvent(new CustomEvent('refresh-scheduled-queue'));
                      }).catch(err => {`;

const newContent = content.replace(regex, replacement);
fs.writeFileSync('src/components/SearchScraperView.tsx', newContent);
console.log('done');
