const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, '.test-data', 'exe-' + Date.now());
fs.mkdirSync(folder, { recursive: true });
const exe = process.env.ENGINE_EXE || path.join(root, 'bin', 'engine.exe');
const child = spawn(exe, ['19315', folder, String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => output += data);
child.on('error', err => { console.error(err); process.exitCode = 1; });
(async () => {
  try {
    for (let i = 0; i < 100 && !output.includes('ENGINE_READY'); i++) {
      if (child.exitCode !== null) throw new Error(output || 'Engine exited');
      await new Promise(r => setTimeout(r, 100));
    }
    assert(output.includes('ENGINE_READY'), output);
    const response = await fetch('http://127.0.0.1:19315/list');
    assert.deepEqual(await response.json(), []);
    await fetch('http://127.0.0.1:19315/shutdown', { method: 'POST', body: '{}' });
    console.log('Compiled engine smoke passed: starts, serves /list, accepts shutdown.');
  } finally {
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 2500);
  }
})().catch(error => { console.error(error); child.kill(); process.exitCode = 1; });