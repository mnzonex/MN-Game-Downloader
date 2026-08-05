const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const postDownloadRegex = /  app\.post\('\/api\/downloads', async \(req, res\) => \{[\s\S]*?res\.json\(\{ status: 'ok', taskId: downloadTask\.id, queueStatus: 'queued' \}\);\n  \}\);/g;

const schedulerApis = `
  // --- ISOLATED SCHEDULER API START ---
  app.post('/api/downloads/schedule', (req, res) => {
    console.log('[DEBUG] Scheduled Download Request:', req.body);
    const { id, title, url, cover, repacker, siteBadge, size, scheduledTime } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({ error: 'Scheduled time is required.' });
    }
    
    const targetEpoch = new Date(scheduledTime).getTime();
    if (isNaN(targetEpoch) || targetEpoch <= Date.now()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future!' });
    }
    
    const taskId = id || \`dl-sched-\${Date.now()}\`;
    const task: ScheduledTaskPayload = {
      id: taskId, title, url, cover, repacker, siteBadge, size, scheduledTime: targetEpoch
    };
    
    scheduledQueue.push(task);
    res.json({ success: true, message: "Task scheduled successfully", task });
  });

  app.get('/api/downloads/scheduled', (req, res) => {
    res.json({ scheduledTasks: scheduledQueue });
  });

  app.delete('/api/downloads/scheduled/:id', (req, res) => {
    const idx = scheduledQueue.findIndex(t => t.id === req.params.id);
    if (idx !== -1) {
      scheduledQueue.splice(idx, 1);
      res.json({ status: 'removed' });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
  // --- ISOLATED SCHEDULER API END ---
`;

content = content.replace(postDownloadRegex, schedulerApis + `\n  app.post('/api/downloads', async (req, res) => {
    console.log('[DEBUG] Download Request:', req.body);
    const task = processDownloadPayload(req.body);
    res.json({ status: 'started', task });
  });`);

fs.writeFileSync('server.ts', content);
console.log('done');
