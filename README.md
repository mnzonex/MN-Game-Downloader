# MN Game Downloader

A Windows desktop application for discovering PC games, managing downloads, repairing existing game files, and organizing an installed-game library.

Built with Electron, React, TypeScript, Vite, Express, and a Python/libtorrent engine.

## Features

- Search and browse supported game sources.
- Manage direct-link and BitTorrent downloads with queueing, scheduling, pause/resume, and progress information.
- Verify downloaded files and repair missing or damaged files from matching torrent data.
- Import and manage an installed game library, select launch executables, and launch games.
- Light and dark themes, native Windows notifications, and in-app update handling.

## Requirements

- Windows 10 or 11 (64-bit)
- Node.js 20 or newer and npm
- Python 3.12 recommended for building the download engine
- Python packages listed in `engine-requirements.txt`

## Setup

```powershell
npm ci
py -3.12 -m pip install -r engine-requirements.txt
npm run electron:dev
```

The engine build uses the Python environment found on your machine. Set `MN_PYTHON` to the full path of the intended Python executable when automatic detection selects the wrong environment.

## Build

Build the frontend and API bundle:

```powershell
npm run build
```

Build the Windows installer:

```powershell
npm run dist:win
```

The installer and unpacked application are generated under `release/`. The Python sidecar is generated under `bin/`. These are build outputs and are intentionally excluded from Git.

## Tests

```powershell
node tests/desktop.test.cjs
node tests/installed-games.test.cjs
npx tsx tests/library.test.ts
py -3.12 tests/test_engine.py
```

The UI smoke test in `tests/ui-smoke.cjs` requires Playwright and Microsoft Edge. The compiled-engine smoke test in `tests/exe-smoke.cjs` requires a locally built `bin/engine.exe`.

## Data and privacy

Runtime databases, downloads, and application state are stored in the user's application data directory. Local state, test fixtures, generated binaries, dependencies, and build output should not be committed.

## Releases

The GitHub Actions workflow builds and publishes a release when a version tag matching `v*` is pushed. Pushing ordinary commits to `main` does not publish a release.