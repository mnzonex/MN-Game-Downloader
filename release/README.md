# v1.2.5 Build Artifacts

This folder keeps the small updater metadata associated with the latest local Windows build.

- `latest.yml`: Electron auto-update manifest for v1.2.5.
- `MN-Game-Downloader-Setup.exe.blockmap`: differential-update metadata for the installer.

The installer itself is already published on the existing GitHub Release:

https://github.com/mnzonex/MN-Game-Downloader/releases/tag/v1.2.5

The installer (135,986,588 bytes) and unpacked application executable (225,947,136 bytes) are intentionally not duplicated in the Git source tree because GitHub's regular Git file limit is 100 MB per file. Build output under `win-unpacked/` remains excluded; rebuild it from the source and packaging configuration in the repository.
