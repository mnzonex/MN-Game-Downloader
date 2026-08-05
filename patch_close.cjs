const fs = require('fs');

const content = fs.readFileSync('server.ts', 'utf8');

const oldCloseRegex = /aria2Proc\.on\('close', \(code: number\) => \{[\s\S]*?activeProcesses\.delete\(task\.id\);[\s]*if \(code === 0\)/;

const newClose = `aria2Proc.on('close', (code: number) => {
      activeProcesses.delete(task.id);
      
      if (task.status === 'paused' || !activeDownloads.has(task.id)) {
        return;
      }

      if (code === 0)`;

const newContent = content.replace(oldCloseRegex, newClose);

fs.writeFileSync('server.ts', newContent);
console.log('done');
