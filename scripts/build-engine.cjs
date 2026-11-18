const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const candidates = [process.env.MN_PYTHON, 'python', 'py', bundled].filter(Boolean);
const env = { ...process.env, PYTHONPATH: [path.join(root, '.engine-deps'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
const python = candidates.find(cmd => spawnSync(cmd, ['-c', 'import libtorrent; import PyInstaller; assert hasattr(libtorrent, "session")'], { env, windowsHide: true }).status === 0);
if (!python) {
  console.error('Python with libtorrent and PyInstaller required. Install engine-requirements.txt, or set MN_PYTHON.');
  process.exit(1);
}
const result = spawnSync(python, ['-m', 'PyInstaller', 'engine.spec', '--distpath', 'bin', '--noconfirm'], {
  cwd: root, env, stdio: 'inherit', windowsHide: true,
});
if (result.status !== 0 || !fs.existsSync(path.join(root, 'bin/engine.exe'))) process.exit(result.status || 1);