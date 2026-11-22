import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTorrentTempPayload } from '../src/engine/downloadCleanup';

const projectRoot = process.cwd();
const torrentEngineSource = fs.readFileSync(path.join(projectRoot, 'src/engine/TorrentEngine.ts'), 'utf8');
const httpEngineSource = fs.readFileSync(path.join(projectRoot, 'src/engine/HttpEngine.ts'), 'utf8');
assert.match(torrentEngineSource, /if \(deleteFiles && existing\) removeTorrentTempPayload\(existing\)/,
  'Torrent deletion fallback is limited to the temporary payload helper');
assert.doesNotMatch(torrentEngineSource, /destTorrentDir/,
  'Torrent deletion must not recursively remove the final destination game directory');
assert.match(httpEngineSource, /deleteFiles && row\.status === 'completed'/,
  'HTTP engine may delete a final destination file only for a completed row');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-download-cleanup-'));
try {
  const downloads = path.join(root, 'Downloads');
  const temp = path.join(downloads, '.mn-temp');
  const previousCompleted = path.join(downloads, 'Example Game');
  const activePayload = path.join(temp, 'Example Game');
  const siblingPayload = path.join(temp, 'Another Game');

  fs.mkdirSync(path.join(previousCompleted, 'data'), { recursive: true });
  fs.mkdirSync(activePayload, { recursive: true });
  fs.mkdirSync(siblingPayload, { recursive: true });
  fs.writeFileSync(path.join(previousCompleted, 'data', 'keep.bin'), 'PREVIOUS-COMPLETED-GAME');
  fs.writeFileSync(path.join(activePayload, 'partial.bin'), 'PARTIAL-DOWNLOAD');
  fs.writeFileSync(path.join(siblingPayload, 'other.part'), 'OTHER-DOWNLOAD');

  assert.equal(removeTorrentTempPayload({
    save_path: temp,
    dest_path: downloads,
    name: 'Example Game',
  }), true);
  assert.equal(fs.existsSync(activePayload), false, 'only this torrent temporary folder is removed');
  assert.equal(fs.readFileSync(path.join(previousCompleted, 'data', 'keep.bin'), 'utf8'), 'PREVIOUS-COMPLETED-GAME',
    'previously completed game files in the final download folder are never touched');
  assert.equal(fs.readFileSync(path.join(siblingPayload, 'other.part'), 'utf8'), 'OTHER-DOWNLOAD',
    'other active downloads sharing .mn-temp stay intact');
  assert.equal(fs.existsSync(temp), true, 'shared .mn-temp remains while another task still uses it');

  const unsafeDestination = path.join(downloads, 'Unsafe');
  fs.mkdirSync(unsafeDestination, { recursive: true });
  fs.writeFileSync(path.join(unsafeDestination, 'keep.bin'), 'DO-NOT-DELETE');
  assert.equal(removeTorrentTempPayload({
    save_path: downloads,
    dest_path: downloads,
    name: 'Unsafe',
  }), false, 'a real destination folder is never eligible for temporary cleanup');
  assert.equal(fs.readFileSync(path.join(unsafeDestination, 'keep.bin'), 'utf8'), 'DO-NOT-DELETE');

  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'PATH-TRAVERSAL-GUARD');
  assert.equal(removeTorrentTempPayload({
    save_path: temp,
    dest_path: downloads,
    name: '..\\outside.txt',
  }), false, 'torrent names cannot escape the .mn-temp directory');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'PATH-TRAVERSAL-GUARD');

  console.log('Download cleanup tests passed: active temp payload removed, previous completed files preserved, sibling tasks preserved, unsafe paths rejected.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}