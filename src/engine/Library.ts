import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from './db';

export interface LibraryGame {
  id: string; name: string; folder: string; cover?: string; magnet?: string;
  size: number; verifiedAt?: string; executable?: string; installer?: string;
  addedAt: number; available?: boolean;
}
export interface ManualLibraryGame {
  id: string;
  name: string;
  launcherPath: string;
  coverPath?: string;
  addedAt: number;
}
function init() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS download_history (event_id TEXT PRIMARY KEY, torrent_id TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS game_context (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS manual_library_games (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
}
export function libraryList(): LibraryGame[] {
  init();
  return (getDb().prepare('SELECT data FROM library').all() as any[]).map(r => {
    const game = JSON.parse(r.data); return { ...game, available: fs.existsSync(game.folder),
      executable: game.executable && !isInstaller(game.executable) && fs.existsSync(game.executable) ? game.executable : undefined };
  });
}
export function libraryGet(id: string): LibraryGame {
  const game = libraryList().find(g => g.id === id);
  if (!game) throw new Error('Game not found in library');
  return game;
}
export function manualLibraryList(): ManualLibraryGame[] {
  init();
  return (getDb().prepare('SELECT data FROM manual_library_games ORDER BY rowid DESC').all() as any[])
    .map(row => JSON.parse(row.data) as ManualLibraryGame);
}
export function addManualLibraryGame(name: string, launcherPath: string): ManualLibraryGame {
  init();
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  const cleanPath = typeof launcherPath === 'string' ? path.resolve(launcherPath.trim().replace(/^['"]|['"]$/g, '')) : '';
  if (!cleanName) throw new Error('Enter a game name.');
  if (!path.isAbsolute(cleanPath) || !['.exe', '.lnk'].includes(path.extname(cleanPath).toLowerCase())) {
    throw new Error('Choose a game .exe or Windows .lnk shortcut.');
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(cleanPath); } catch { throw new Error('The selected game launcher could not be found.'); }
  if (!stat.isFile()) throw new Error('Choose a game launcher file, not a folder.');
  if (path.extname(cleanPath).toLowerCase() === '.exe' && isInstaller(cleanPath)) {
    throw new Error('That looks like an installer. Select the installed game launcher instead of setup.exe.');
  }
  const normalized = process.platform === 'win32' ? cleanPath.toLowerCase() : cleanPath;
  const id = 'manual-' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  const existing = getDb().prepare('SELECT data FROM manual_library_games WHERE id = ?').get(id) as any;
  if (existing) {
    const game = JSON.parse(existing.data) as ManualLibraryGame;
    if (game.name !== cleanName) {
      game.name = cleanName;
      getDb().prepare('UPDATE manual_library_games SET data = ? WHERE id = ?').run(JSON.stringify(game), id);
    }
    return game;
  }
  const game: ManualLibraryGame = { id, name: cleanName, launcherPath: cleanPath, addedAt: Date.now() };
  getDb().prepare('INSERT INTO manual_library_games VALUES (?, ?)').run(id, JSON.stringify(game));
  return game;
}
export function setManualGameCover(id: string, coverPath: string): ManualLibraryGame {
  init();
  const row = getDb().prepare('SELECT data FROM manual_library_games WHERE id = ?').get(id) as any;
  if (!row) throw new Error('This manually added game was not found.');
  const game = JSON.parse(row.data) as ManualLibraryGame;
  if (!path.isAbsolute(coverPath) || !fs.existsSync(coverPath) || !fs.statSync(coverPath).isFile()) {
    throw new Error('The selected cover image could not be found.');
  }
  game.coverPath = coverPath;
  getDb().prepare('UPDATE manual_library_games SET data = ? WHERE id = ?').run(JSON.stringify(game), id);
  return game;
}
export function removeManualLibraryGame(id: string): boolean {
  init();
  if (typeof id !== 'string' || !/^manual-[a-f0-9]{24}$/i.test(id)) {
    throw new Error('Choose a manually added game first.');
  }
  const result = getDb().prepare('DELETE FROM manual_library_games WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
function save(game: LibraryGame) {
  init(); getDb().prepare('INSERT OR REPLACE INTO library VALUES (?, ?)').run(game.id, JSON.stringify(game));
}
export async function rememberGame(id: string, name?: string, coverUrl?: string) {
  init();
  const previous = getDb().prepare('SELECT data FROM game_context WHERE id = ?').get(id) as any;
  const context = previous ? JSON.parse(previous.data) : {};
  if (name) context.name = name.slice(0, 500);
  getDb().prepare('INSERT OR REPLACE INTO game_context VALUES (?, ?)').run(id, JSON.stringify(context));
  if (!coverUrl) return;
  let cover: URL;
  try { cover = new URL(coverUrl); } catch { return; }
  const allowedCoverDomains = ['fitgirl-repacks.site', 'ero-labs.com', 'gog-statics.com', 'steamstatic.com', 'epicgames.com', 'unrealengine.com'];
  const trustedCoverHost = allowedCoverDomains.some(domain => cover.hostname === domain || cover.hostname.endsWith(`.${domain}`));
  if (cover.protocol !== 'https:' || cover.username || cover.password || cover.port || !trustedCoverHost) return;
  try {
    const response = await fetch(cover.toString(), { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const mime = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\/(png|jpeg|webp)/i.test(mime) || !response.body) return;
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of response.body as any) {
      length += chunk.length;
      if (length > 8 * 1024 * 1024) throw new Error('Cover too large');
      chunks.push(chunk);
    }
    const dir = path.join(process.env.MN_DATA_DIR || path.join(process.cwd(), '.mn-data'), 'covers');
    fs.mkdirSync(dir, { recursive: true });
    context.cover = path.join(dir, crypto.createHash('sha256').update(id).digest('hex') + '.img');
    fs.writeFileSync(context.cover, Buffer.concat(chunks));
    getDb().prepare('INSERT OR REPLACE INTO game_context VALUES (?, ?)').run(id, JSON.stringify(context));
  } catch { /* Cover failure must not interrupt a game download. */ }
}
export async function recordCompletion(row: any, manifestPath?: string) {
  init();
  const previous = getDb().prepare('SELECT data FROM game_context WHERE id = ?').get(row.id) as any;
  const context = previous ? JSON.parse(previous.data) : {};
  let folder = path.join(row.dest_path, row.name);
  if (manifestPath && fs.existsSync(manifestPath)) {
    folder = path.dirname(manifestPath);
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    manifest.display_name = context.name || manifest.display_name || row.name;
    if (context.cover && fs.existsSync(context.cover)) {
      await fs.promises.copyFile(context.cover, path.join(folder, '.mn-cover.img'));
      manifest.cover = '.mn-cover.img';
    }
    await fs.promises.writeFile(manifestPath + '.tmp', JSON.stringify(manifest, null, 2));
    await fs.promises.rename(manifestPath + '.tmp', manifestPath);
    // Portable manifests remain useful for repair; no Library entry is created.
  }
  const history = { id: row.id, name: context.name || row.name, size: row.size,
    folder, completedAt: Date.now(), magnet: row.magnet, taskKind: row.task_kind || 'download' };
  const inserted = getDb().prepare('INSERT OR IGNORE INTO download_history VALUES (?, ?, ?)').run(`${row.id}:${row.added_at}`, row.id, JSON.stringify(history));
  if (inserted.changes > 0 && row.task_kind !== 'repair') {
    try {
      const capture = (globalThis as any).mnAnalyticsCapture;
      if (typeof capture === 'function') {
        capture('download_completed', {
          game_name: context.name || row.name,
          source_id: row.source_id || undefined,
          download_type: typeof row.magnet === 'string' && row.magnet.startsWith('magnet:') ? 'torrent' : 'http',
          bytes: Math.max(0, Number(row.size) || 0),
          duration_ms: Math.max(0, Date.now() - (Number(row.started_at) || Number(row.added_at) || Date.now())),
        });
      }
    } catch { /* Analytics must never interrupt completion/history. */ }
  }
}
export function historyList() {
  init(); return (getDb().prepare('SELECT data FROM download_history ORDER BY rowid DESC LIMIT 200').all() as any[]).map(r => JSON.parse(r.data));
}
async function importManifest(file: string) {
  const stat = await fs.promises.stat(file);
  if (stat.size > 16 * 1024 * 1024) return;
  const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  if (manifest.schema !== 1 || !/^[a-f0-9]{40,64}$/i.test(manifest.infohash) || !Array.isArray(manifest.files)) return;
  const folder = path.dirname(file);
  init();
  const stored = getDb().prepare('SELECT data FROM library WHERE id = ?').get(manifest.infohash) as any;
  const previous: LibraryGame | undefined = stored ? JSON.parse(stored.data) : undefined;
  if (previous && previous.folder !== folder && fs.existsSync(previous.folder)) return;
  if (previous?.executable && previous.folder !== folder) {
    const relative = path.relative(previous.folder, previous.executable);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) previous.executable = path.join(folder, relative);
  }
  const installer = path.join(folder, 'setup.exe');
  const cover = path.join(folder, '.mn-cover.img');
  save({ ...previous, id: manifest.infohash, name: String(manifest.display_name || manifest.name), folder,
    size: Number(manifest.total_size) || 0, magnet: manifest.magnet,
    verifiedAt: manifest.verified_at, cover: fs.existsSync(cover) ? cover : previous?.cover,
    installer: fs.existsSync(installer) ? installer : undefined, addedAt: previous?.addedAt || Date.now() });
}
export function removeLibraryGame(id: string) {
  init(); getDb().prepare('DELETE FROM library WHERE id = ?').run(id);
  return libraryList();
}
export function isInstaller(executable: string) {
  return /^(setup|install|unins|uninstall|dxsetup|vcredist|vc_redist|redist)([._ 0-9-]|$)/i.test(path.basename(executable, path.extname(executable)).toLowerCase());
}
const scanCandidates = new Map<string, { file: string; expires: number }>();
export async function importLibraryCandidates(tokens: string[]) {
  if (!Array.isArray(tokens) || tokens.length > 200) throw new Error('Select games from the scan results');
  const candidates = tokens.map(token => {
    const candidate = scanCandidates.get(token);
    if (!candidate || candidate.expires < Date.now()) throw new Error('Scan expired. Scan the folder again.');
    return candidate;
  });
  for (const candidate of candidates) await importManifest(candidate.file);
  tokens.forEach(token => scanCandidates.delete(token));
  return libraryList();
}
let scanning = false;
export async function scanLibrary(folder?: string) {
  if (scanning) throw new Error('A library scan is already running');
  scanning = true;
  try {
    if (!folder) return { games: libraryList(), candidates: [], scanned: 0, limited: false };
    if (!path.isAbsolute(folder) || !(await fs.promises.stat(folder)).isDirectory()) throw new Error('Choose a game folder');
    const roots = [folder];
    const candidates: { token: string; name: string; folder: string }[] = [];
    for (const [token, item] of scanCandidates) if (item.expires < Date.now()) scanCandidates.delete(token);
    let count = 0; let limited = false;
    const queue = roots.map(root => ({ root, depth: 0 }));
    while (queue.length) {
      const next = queue.shift()!;
      if (++count > 20000) { limited = true; break; }
      try {
        const stat = await fs.promises.lstat(next.root);
        if (stat.isSymbolicLink()) continue;
        const entries = await fs.promises.readdir(next.root, { withFileTypes: true });
        if (entries.some(e => e.name === '.mn-game.json')) {
          const file = path.join(next.root, '.mn-game.json');
          if ((await fs.promises.stat(file)).size <= 16 * 1024 * 1024) {
            const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'));
            if (manifest.schema === 1 && /^[a-f0-9]{40,64}$/i.test(manifest.infohash) && Array.isArray(manifest.files)) {
              const token = crypto.randomUUID();
              scanCandidates.set(token, { file, expires: Date.now() + 15 * 60 * 1000 });
              candidates.push({ token, name: String(manifest.display_name || manifest.name || 'Downloaded package'), folder: next.root });
            }
          }
          continue;
        }
        if (next.depth >= 8) { if (entries.some(e => e.isDirectory())) limited = true; continue; }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !/^(node_modules|windows|\$recycle.bin|dist|build|release.*)$/i.test(entry.name)) {
            queue.push({ root: path.join(next.root, entry.name), depth: next.depth + 1 });
          }
        }
      } catch { /* Offline disks and access-denied folders remain in the saved roots. */ }
    }
    return { games: libraryList(), candidates, scanned: count, limited, roots };
  } finally { scanning = false; }
}
export function setExecutable(id: string | undefined, executable: string) {
  if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== '.exe' || !fs.statSync(executable).isFile()) throw new Error('Choose the installed game .exe');
  if (!id) throw new Error('Select a downloaded game in your library first');
  if (isInstaller(executable)) throw new Error('This is an installer. Select the game executable from its installed location, not setup.exe.');
  const game = libraryGet(id);
  if (game.installer && path.resolve(game.installer).toLowerCase() === path.resolve(executable).toLowerCase()) throw new Error('An installer cannot be used to play a game');
  game.executable = executable;
  save(game); return game;
}