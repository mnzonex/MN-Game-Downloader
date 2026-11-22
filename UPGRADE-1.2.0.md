# MN Game Downloader 1.2.0

This release preserves the existing app ID, user-data directory and SQLite database. Source snapshots from before this upgrade are in `.upgrade-backup-v2`; previous installer outputs were retained.

## Download state and availability

- New downloads explicitly start unpaused. Only a successful manual Pause request marks the task paused. Startup no longer rewrites active database rows to paused, and Resume/Pause errors are surfaced.
- Pre-download inspection has a longer metadata window, a refresh action and connected-peer terminology. Cached metadata never invents live seeder counts. A zero connected-seeder sample does not mean the swarm has no seeds.
- Metadata-only inspection selects no payload files using libtorrent's `default_dont_download` flag. See the [official torrent flag reference](https://www.libtorrent.org/reference-Core.html). Actual metadata retrieval was verified with a local seeder.
- Schedule / Download Now remain available. Package size is resolved from torrent metadata; unresolved site values remain estimates.

## Check and repair

1. Select the matching game/version in Browse Games and click **Get missing files**.
2. Choose its original repack/download folder, or a parent containing it.
3. Wait for the actual torrent piece-hash scan. The report distinguishes missing, damaged, wrong-size and OK files. It downloads no repair payload before confirmation.
4. Click **Repair selected game** to retrieve invalid pieces, then verify the complete package again. If everything is correct, the dialog shows **All files OK** and no repair button.

Folder discovery is bounded to four levels and 2,000 directories, retains the original torrent folder layout, and rejects ambiguous matches and linked paths. Choose a more specific folder if needed. An installed/extracted game is not a substitute for its compressed repack files. Torrent pieces may overlap adjacent files, so the transfer unit is a piece rather than a whole file.

Completed downloads save `.mn-game.json` (package name, sizes, file SHA-256 hashes, canonical manifest digest, infohash, verification time), `.mn-package.torrent` (for offline rechecks) and, when its image can be fetched, `.mn-cover.img`. The folder digest covers expected package files, not unrelated saves or these generated metadata files. A JSON record is not trusted as proof that the current files are correct: rechecks still read actual files against torrent hashes. A saved torrent is accepted only when its infohash matches the selected magnet.

## Library and history

- Newly completed torrent packages appear in Game Library, with saved artwork when available and an Install action when `setup.exe` exists in the package root.
- **Scan folder** remembers selected locations and finds manifest-bearing packages, including packages moved within those locations. While Library is open, saved locations are rescanned every minute. Scans are bounded to eight levels / 20,000 directories and indicate when the bound is reached.
- Moving a package outside every registered location requires adding the new location. There is no claim of unrestricted whole-PC move tracking. Previous packages without manifests are not silently identified as verified games.
- **Add installed game** / **Locate game** select a real `.exe`. Play launches that executable and minimizes the app. After installation, use Locate game to link the installed executable; installation success is not guessed from a launcher exit code.
- Install launches the package's real installer. The activity panel records the launched process, exit code, stdout/stderr and relevant new `.log` files in the installer directory. Logs persist in the app user-data `launch-logs` directory. GUI-only DLL/DirectX/driver errors, elevated installers and detached child installers cannot all be captured. These limitations are stated in the UI.
- Downloads includes a grey history section and Download again. History is independent of active tasks, and repeated completions are separate entries.

## Silent app updates

Updates download in the background. Once ready, closing the window or quitting first saves download resume data, then calls the updater in silent mode. Restart-and-install buttons were removed. If an update was pending at an interrupted shutdown, the next launch asks the updater to resolve its cached update and apply it. The normal close-to-tray behavior remains when no update is ready.

The native engine is allowed to finish its resume-data save; the old immediate Windows SIGTERM and short forced-kill deadline no longer interrupt it. Installer configuration does not delete app data. Windows can still show a UAC permission prompt when elevation is required.

Install 1.2.0 once to acquire this behavior: an older installed version's updater code cannot be changed retroactively. Future GitHub releases must publish the matching NSIS installer, `latest.yml` and blockmap under a higher version. Nothing was published to GitHub during this task.

## Verification

- Eight real libtorrent integration cases using generated data and a loopback seeder: missing/same-size corruption repair; download/move/destination verification; folder/path safety; healthy/oversized file checks; pause/resume persistence; preview/confirm + per-file manifest + offline rescan; explicit pause state; uncached live metadata discovery.
- Library tests run with Electron's native SQLite ABI: legacy-schema migration and existing data retention, folder/executable relocation, completion idempotency and repeat-download history.
- UI smoke in headless Edge: exact size, missing-file preview before confirmation, all-OK state and Library navigation. API/picker responses are fixtures.
- Desktop controller tests: resume-save-before-silent-install ordering, duplicate installation guard, Play/minimize and launch-error log persistence. Process/updater objects are test doubles.
- TypeScript and production builds; compiled-engine startup/API/shutdown smoke.

A real FitGirl installation, game launch, GUI-error capture and live GitHub old-version-to-new-version update were not performed. No claim of full end-to-end verification for those external workflows is made.