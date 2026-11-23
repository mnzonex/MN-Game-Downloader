import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-http-shutdown-test-'));
process.env.MN_DATA_DIR = path.join(tempRoot, 'data');
const events = [];
globalThis.mnAnalyticsCapture = (event, properties) => events.push({ event, properties });

let server;
let db;
try {
  const { dbGetTorrent, dbSetSetting, getDb } = await import('../src/engine/db.ts');
  const { HttpEngine } = await import('../src/engine/HttpEngine.ts');
  db = getDb();

  const downloadRoot = path.join(tempRoot, 'downloads');
  fs.mkdirSync(downloadRoot, { recursive: true });
  dbSetSetting('download_path', downloadRoot);

  const payload = Buffer.alloc(4 * 1024 * 1024, 0x5a);
  const rangeRequests = [];
  server = http.createServer((req, res) => {
    // /no-range deliberately ignores Range to exercise the safe restart-from-zero path.
    const supportsRange = !String(req.url || '').startsWith('/no-range');
    const requestedRange = req.headers.range;
    const range = supportsRange ? requestedRange : undefined;
    rangeRequests.push({ path: req.url, requestedRange: requestedRange || null, honored: !!range });
    const start = range ? Number((/^bytes=(\d+)-/.exec(range) || [])[1]) : 0;
    if (!Number.isInteger(start) || start < 0 || start >= payload.length) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + payload.length });
      res.end();
      return;
    }
    res.statusCode = range ? 206 : 200;
    res.setHeader('Accept-Ranges', supportsRange ? 'bytes' : 'none');
    res.setHeader('Content-Length', String(payload.length - start));
    if (range) res.setHeader('Content-Range', 'bytes ' + start + '-' + (payload.length - 1) + '/' + payload.length);
    res.setHeader('Content-Type', 'application/octet-stream');
    let cursor = start;
    const writeChunk = () => {
      if (res.destroyed || res.writableEnded) return;
      if (cursor >= payload.length) {
        res.end();
        return;
      }
      const next = Math.min(cursor + 16 * 1024, payload.length);
      res.write(payload.subarray(cursor, next));
      cursor = next;
      setTimeout(writeChunk, 12);
    };
    writeChunk();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  const waitFor = async (predicate, timeoutMs, description) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Timed out waiting for ' + description);
  };

  // Case 1: server honours Range; partial data is appended and verified byte-for-byte.
  const firstEngine = new HttpEngine();
  const url = baseUrl + '/resume-test.bin';
  const added = await firstEngine.add(url, 'Resume Test Game', 'erolabs');
  const firstRow = dbGetTorrent(added.id);
  assert.ok(firstRow?.attempt_id, 'each persisted download must have an attempt ID');
  const partFile = path.join(firstRow.save_path, added.id + '.part');

  await waitFor(() => {
    try { return fs.existsSync(partFile) && fs.statSync(partFile).size > 128 * 1024; }
    catch { return false; }
  }, 12000, 'partial HTTP payload');
  const partialBeforeShutdown = fs.statSync(partFile).size;
  assert.ok(partialBeforeShutdown > 0 && partialBeforeShutdown < payload.length);

  await firstEngine.shutdown();
  const interruptedRow = dbGetTorrent(added.id);
  assert.equal(interruptedRow.status, 'downloading', 'graceful shutdown must preserve the active state for startup recovery');
  assert.ok(fs.existsSync(partFile), 'shutdown must preserve the .part payload');
  assert.equal(fs.statSync(partFile).size, partialBeforeShutdown, 'shutdown must not truncate already written bytes');

  const secondEngine = new HttpEngine();
  assert.equal(secondEngine.restoreInterruptedDownloads(), 1, 'startup should detect and restore the interrupted HTTP row');
  await waitFor(() => dbGetTorrent(added.id)?.status === 'completed', 30000, 'resumed HTTP completion');

  const completedPath = path.join(downloadRoot, added.name);
  assert.ok(fs.existsSync(completedPath), 'resumed payload should be finalized to its destination');
  const finalBytes = fs.readFileSync(completedPath);
  assert.equal(finalBytes.length, payload.length);
  assert.equal(Buffer.compare(finalBytes, payload), 0, 'resumed output must match the original payload exactly');
  assert.ok(rangeRequests.some(value => value.path === '/resume-test.bin' && value.honored && value.requestedRange === 'bytes=' + partialBeforeShutdown + '-'), 'startup must issue an honoured HTTP Range request from the preserved .part offset');

  const firstAttemptEvents = events.filter(item => item.properties.attempt_id === firstRow.attempt_id);
  for (const required of ['download_started', 'download_interrupted', 'download_resumed', 'download_completed']) {
    assert.ok(firstAttemptEvents.some(item => item.event === required), 'missing lifecycle event: ' + required);
  }
  assert.ok(!firstAttemptEvents.some(item => item.event === 'download_resume_restarted'), 'a valid Range resume must not be reported as a restart');
  assert.ok(!firstAttemptEvents.some(item => item.event === 'download_cancelled'), 'app shutdown must not be reported as user cancellation');
  assert.ok(!firstAttemptEvents.some(item => item.event === 'download_failed'), 'successful resume must not be reported as a failure');
  await secondEngine.shutdown();

  // Case 2: server ignores Range; engine must truncate the partial file and report a restart, not a successful resume.
  const thirdEngine = new HttpEngine();
  const noRangeUrl = baseUrl + '/no-range-test.bin';
  const restarted = await thirdEngine.add(noRangeUrl, 'Resume Restart Test Game', 'erolabs');
  const restartRow = dbGetTorrent(restarted.id);
  assert.ok(restartRow?.attempt_id);
  const restartPartFile = path.join(restartRow.save_path, restarted.id + '.part');
  await waitFor(() => {
    try { return fs.existsSync(restartPartFile) && fs.statSync(restartPartFile).size > 128 * 1024; }
    catch { return false; }
  }, 12000, 'second partial HTTP payload');
  const restartPartialBeforeShutdown = fs.statSync(restartPartFile).size;
  await thirdEngine.shutdown();

  const fourthEngine = new HttpEngine();
  assert.equal(fourthEngine.restoreInterruptedDownloads(), 1, 'startup should restore the second interrupted HTTP row');
  await waitFor(() => dbGetTorrent(restarted.id)?.status === 'completed', 30000, 'restart-from-zero completion');

  const restartedPath = path.join(downloadRoot, restarted.name);
  assert.ok(fs.existsSync(restartedPath));
  const restartedBytes = fs.readFileSync(restartedPath);
  assert.equal(restartedBytes.length, payload.length);
  assert.equal(Buffer.compare(restartedBytes, payload), 0, 'restart-from-zero output must still match the original payload');
  assert.ok(rangeRequests.some(value => value.path === '/no-range-test.bin' && value.requestedRange === 'bytes=' + restartPartialBeforeShutdown + '-' && !value.honored), 'test server must have ignored the resume Range request');

  const secondAttemptEvents = events.filter(item => item.properties.attempt_id === restartRow.attempt_id);
  assert.ok(secondAttemptEvents.some(item => item.event === 'download_resume_restarted'), 'a server that ignores Range must produce the restart event');
  assert.ok(!secondAttemptEvents.some(item => item.event === 'download_resumed'), 'a 200 response to Range must never be reported as a successful partial resume');
  assert.ok(secondAttemptEvents.some(item => item.event === 'download_completed'));
  await fourthEngine.shutdown();

  console.log('HTTP engine integration passed: graceful shutdown preserves partial bytes; Range resume is verified byte-for-byte; servers ignoring Range restart safely from zero and are tracked separately.');
} finally {
  if (db?.open) db.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
