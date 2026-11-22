# 1.2.1 corrections

- Library scans now preview packages and require selecting entries before importing. Opening/refreshing Library no longer recursively scans saved Desktop locations. Development and hidden directories are excluded from recursive discovery.
- Remove deletes only the library database entry. Files and download history remain. Refresh does not silently re-add removed entries.
- Arbitrary executable imports were removed. Setup, uninstall and redistributable executables cannot be linked as Play targets, including old saved installer links.
- Install launches setup. Library checks Windows uninstall records for a matching title and a unique existing executable in DisplayIcon, within InstallLocation when supplied. Detection runs after installer exit and periodically while Library is open. Missing, ambiguous or installer-only records require explicitly linking the installed executable; no claim is made that every FitGirl installer writes a usable record.
- Repair files appears beside Download based on the actual magnet URL, independent of scraper option labels. Repair retains the selected title and cover for the completed package.
- External downloads do not require an MN manifest. Repair uses metadata matching the selected magnet. It searches the selected folder and descendants, including renamed package roots, then verifies torrent pieces. Preview does not download repair payload; confirmation enables missing/corrupt piece downloads and final verification.
- Installed/unpacked game contents differ from downloaded repack contents. This repair flow repairs repack archives for the selected version, not arbitrary installed files. Metadata and missing pieces still require reachable peers when no local torrent metadata is available.

Validation: TypeScript check; library database migration/import/removal/scan tests; Edge UI fixture tests; desktop updater/launch tests; installed-record resolution tests; generated-data native libtorrent integration tests including external renamed folders. No full third-party FitGirl installation or public GitHub auto-update cycle was executed.

## Repair workflow revision

- Removed the Game Library navigation tab and screen.
- Repair scan now compares the selected game title to torrent metadata and requires a hash-verified game data file before presenting a repairable report. Confirmation is rejected if the selected game identity is not established. Shared repack helpers alone do not prove identity.
- Confirmed repairs are persisted with a `repair` task kind, restored without silently falling back to a fresh download, and show per-file byte progress in Downloads. Completed repair entries are labeled in download history and announced as “Repair successful”.