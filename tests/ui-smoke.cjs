const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let repaired = false;
    let allOk = false;
    let wrongFolder = false;
    let completed = false;
    let libraryGames = [{ id: "fixture", name: "Saved package", folder: "C:\\Games", size: 123, available: true, installer: "C:\\Games\\setup.exe" }];
    let scanCalls = 0;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.electron = { showOpenDialog: async () => 'C:\\FixtureLibrary' }; });
    const opt = { type: 'direct', label: 'Fixture magnet', url: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), speedEstimate: 'Magnet Link' };
    const game = { id: 'fixture', title: 'Repair Test Game', cover: '', size: '1 GB', repacker: 'Test', siteBadge: 'FITGIRL', siteUrl: 'https://example.com/fixture', category: 'Test', description: '', releaseDate: '', screenshots: [], downloads: [opt] };
    await page.route('http://127.0.0.1:3000/api/**', async route => {
      const url = route.request().url();
      let data = {};
      if (url.includes('/popular')) data = { games: url.includes('fitgirl') ? [game] : [] };
      else if (url.includes('/details')) data = { downloads: [opt], partsCount: 0 };
      else if (url.includes('/inspect')) data = { ok: true, has_metadata: true, name: game.title, total_size: 2147483648, files_count: 1, files: [{ name: 'Game/data.bin', size: 2147483648 }], seeds: 0, peers: 0 };
      else if (url.endsWith('/repair/scan')) { const body = route.request().postDataJSON(); assert.equal(body.folder, 'C:\\FixtureLibrary'); assert.equal(body.magnetLink, opt.url); data = { id: 'a'.repeat(40), name: game.title }; }
      else if (url.endsWith('/repair/status')) data = { report: { identity_confirmed: !wrongFolder, identity_error: 'Wrong game folder. Select the matching game.', all_ok: allOk, name: game.title, total_size: 2147483648, missing_bytes: allOk ? 0 : 1024, files: [{ name: 'Game/data.bin', size: 2147483648, status: allOk ? 'ok' : 'damaged' }] } };
      else if (url.endsWith('/repair/confirm')) { repaired = true; data = { id: 'a'.repeat(40) }; }
      else if (url.includes('/download-history')) data = completed ? [{ id: 'repair-task', name: 'Repair Test Game', size: 1024, completedAt: 123, taskKind: 'repair', magnet: opt.url }] : [];
      else if (url.endsWith('/library/fixture') && route.request().method() === 'DELETE') { libraryGames = []; data = []; }
      else if (url.endsWith('/library')) data = libraryGames;
      else if (url.endsWith('/library/scan')) { scanCalls++; data = { games: libraryGames, candidates: [{ token: 'candidate', name: 'Found package', folder: 'C:\\FixtureLibrary' }], scanned: 1, limited: false }; }
      else if (url.includes('/list')) data = repaired && !completed ? [{ id: 'repair-task', name: 'Repair Test Game', taskKind: 'repair', status: 'repairing', size: 2147483648, progress: 0.5, downloadSpeed: 1024, peers: 2, seeds: 1, etaSecs: 4, addedAt: 1, hidden: false, files: [{ name: 'Game/data.bin', size: 1024, downloaded: 512, status: 'Downloading' }] }] : [];
      else if (url.includes('/settings')) data = {};
      await route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByText('Repair Test Game', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Download Repack', exact: true }).click();
    await page.getByText('Package metadata resolved', { exact: true }).waitFor();
    assert((await page.locator('body').innerText()).includes('1 files (2.00 GB)'));
    assert(!(await page.locator('body').innerText()).includes('Game files verified and ready'));
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Repair files', exact: true }).click();
    await page.getByText('1 missing or damaged files', { exact: true }).waitFor();
    assert.equal(repaired, false, 'preview does not start repair');
    await page.getByRole('button', { name: 'Repair and download', exact: true }).click();
    await page.getByText('Repair started', { exact: true }).waitFor();
    assert(repaired);
    await page.getByText('Repair download', { exact: true }).waitFor();
    await page.getByText('Repair file progress', { exact: true }).waitFor();
    await page.getByText('Game/data.bin', { exact: true }).waitFor();
    completed = true;
    await page.getByText('Repair successful — files verified', { exact: true }).waitFor();
    allOk = true;
    await page.getByRole('button', { name: /Browse Games/ }).click();
    await page.getByRole('button', { name: 'Repair files', exact: true }).click();
    await page.getByText('All files OK — no download needed', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Repair and download', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Game Library', exact: true }).count(), 0);
    wrongFolder = true; allOk = false;
    await page.getByRole('button', { name: 'Repair files', exact: true }).click();
    await page.getByText('Wrong game folder or unverified game', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Repair and download', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('UI smoke passed: metadata size, honest verification text, native picker bridge and repair request.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });