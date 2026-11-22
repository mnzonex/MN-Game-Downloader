# Download integrity upgrade

Use **Game details → Get missing files → select the original repack folder or a parent folder**. The engine finds the exact package folder, hashes existing pieces against the selected torrent and downloads only missing or damaged pieces. Progress appears in Downloads as Verifying / Repairing. Pausing and resuming remain available.

The selected package must match the game version and original torrent folder layout. Installed/extracted game files are not interchangeable with compressed repack files. Folder discovery searches up to four levels / 2,000 directories, rejects ambiguous matches and linked paths, and asks for a more specific folder when necessary. An entirely empty/unrelated folder is rejected; use normal Download for a new copy. Missing pieces still require reachable peers.

Existing unrelated files are retained. Removing an in-place repair task never deletes its files, even if the task-delete checkbox is selected. Oversized package files are truncated to the torrent length before checking; valid pieces are retained. A torrent piece can overlap files, so repair transfers are piece-based, not necessarily whole-file downloads.

Normal downloads now require full piece verification and exact expected file sizes. Files are moved through libtorrent, then verified again at the destination. Unsafe timeout-based filesystem move fallbacks were removed: a move failure retains the source and reports an error. Resume data serialization uses the current libtorrent API; retry keeps its database row and original paths.

Site sizes are labelled **Site estimate**. Once pre-download inspection resolves metadata, its exact package size replaces the estimate on that game's detail/card during the current view session. Fixed the snake_case API / camelCase UI mismatch. Metadata availability does not claim that local files have already been verified. HTTP/direct downloads keep their existing engine; this repair feature applies to torrent packages.

## Builds

- Updated installer: `release-upgrade/MN-Game-Downloader-Setup.exe`
- Updated native engine: `bin/engine.exe`
- Previous release directory retained. Edited original source snapshots are in `.upgrade-backup`.
- `npm run engine:build` builds the native engine; Windows packaging scripts rebuild it automatically so a stale executable is not shipped.
- Python dependencies: `engine-requirements.txt`. Set `MN_PYTHON` if Python is not on PATH. This workspace also has isolated dependencies in `.engine-deps`.

## Verified

- TypeScript: `npx tsc --noEmit`.
- Production frontend/server build and NSIS installer build.
- Five real libtorrent integration tests in `tests/test_engine.py`: same-size corruption + missing file repair; normal download/move/destination verification; folder mismatch/ambiguity/path safety; healthy files with zero payload downloads + oversized correction + file preservation; pause/resume and resume-data serialization. Tests use generated data and a local seeder.
- Headless Edge UI smoke in `tests/ui-smoke.cjs`: metadata-size rendering, honest verification text, folder-picker bridge and repair request. API and picker responses are test fixtures; this does not test the actual native Windows folder dialog.
- Compiled engine startup, `/list`, and shutdown smoke in `tests/exe-smoke.cjs`.

No large public game download or installed-app end-to-end test was performed. Installer was built, not installed over the user's existing app.