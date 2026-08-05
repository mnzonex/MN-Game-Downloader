const fs = require('fs');

const content = fs.readFileSync('src/components/SearchScraperView.tsx', 'utf8');

const regex = /fetch\('\/api\/downloads\/schedule', \{[\s\S]*?\}\)\.catch\(err => alert\('Failed to schedule download\.'\)\);/;

const replacement = `fetch('/api/downloads/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: \`dl-\${Date.now()}\`,
                          title: selectedGame.title,
                          url: scheduleOption.url,
                          cover: displayCover || selectedGame.cover,
                          repacker: selectedGame.repacker,
                          siteBadge: selectedGame.siteBadge,
                          size: displayRepackSize || selectedGame.size,
                          scheduledTime: targetTime
                        })
                      }).then(res => res.json()).then(data => {
                        if (data.error) throw new Error(data.error);
                        toast.success(\`Download scheduled for \${new Date(targetTime).toLocaleString()}!\`);
                        alert(\`Download scheduled for \${new Date(targetTime).toLocaleString()}!\`);
                        setScheduleModalOpen(false);
                      }).catch(err => {
                        toast.error(err.message || 'Failed to schedule download.');
                        alert(err.message || 'Failed to schedule download.');
                      });`;

const newContent = content.replace(regex, replacement);
fs.writeFileSync('src/components/SearchScraperView.tsx', newContent);
console.log('done');
