const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// Also make sure startAria2Download sets status to 'downloading' and not just queued
// It already does: task.status = 'downloading'; 

// Let's check processDownloadPayload
// In the current logic, it sets task.status = 'queued', and then startAria2Download sets 'downloading'
// But wait, there might be a delay where it's 'queued'. We can make it 'downloading' right away.

content = content.replace(/status: 'queued',/g, "status: 'downloading',");

fs.writeFileSync('server.ts', content);
console.log('done');
