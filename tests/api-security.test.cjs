const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.test-data', 'api-security-' + Date.now());
const token = 'test-only-local-api-token-' + Date.now();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', headers, timeout: 2000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('API request timed out')));
    req.on('error', reject);
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Test server exited early');
    try {
      const response = await request(port, { 'X-MN-API-Token': token });
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Test API did not start');
}

async function run() {
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(root, 'server.ts'),
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      MN_DATA_DIR: dataDir,
      MN_API_TOKEN: token,
      MN_TEST_SKIP_ENGINE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', chunk => output += chunk.toString());
  child.stderr.on('data', chunk => output += chunk.toString());

  try {
    await waitForServer(port, child);
    assert.equal((await request(port)).status, 401, 'missing token must be rejected');
    assert.equal((await request(port, { 'X-MN-API-Token': 'wrong-token' })).status, 401, 'wrong token must be rejected');
    assert.equal((await request(port, {
      'X-MN-API-Token': token,
      Origin: 'https://untrusted.example',
    })).status, 403, 'untrusted browser origins must be rejected');

    const trusted = await request(port, { 'X-MN-API-Token': token, Origin: 'null' });
    assert.equal(trusted.status, 200);
    assert.equal(JSON.parse(trusted.body).ok, true);
    assert.equal(trusted.headers['access-control-allow-origin'], 'null');
    console.log('API security tests passed: token required, wrong token rejected, foreign origin blocked, Electron file origin allowed.');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode !== 0 && child.exitCode !== null) {
      console.log(output.slice(-4000));
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});