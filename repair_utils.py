"""Bounded folder discovery. Hash decisions belong to libtorrent, never filenames."""
import os
from pathlib import Path, PurePosixPath


def safe_file(base, relative):
    parts = PurePosixPath(relative.replace('\\', '/')).parts
    if not parts or any(p in ('..', '/', '.') or ':' in p for p in parts):
        raise ValueError('Unsafe torrent file path')
    base = Path(base).resolve()
    target = base.joinpath(*parts)
    # Reject junctions/symlinks even if they point back inside the chosen folder.
    for parent in [target, *target.parents]:
        if parent == base:
            break
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            raise ValueError('Linked files/folders cannot be repaired safely')
    if not target.resolve().is_relative_to(base):
        raise ValueError('Torrent path escapes selected folder')
    return target


def find_save_path(selected, files, max_depth=4, max_dirs=2000):
    selected = Path(selected).resolve(strict=True)
    if not selected.is_dir() or not files:
        raise ValueError('Select an existing repack folder or its parent')
    roots = {PurePosixPath(f['name'].replace('\\', '/')).parts[0] for f in files}
    candidates = set()
    seen = 0
    for current, dirs, _ in os.walk(selected, followlinks=False):
        seen += 1
        if seen > max_dirs:
            raise ValueError('Too many folders. Select the game folder directly')
        cur = Path(current)
        dirs[:] = [d for d in dirs if not (cur / d).is_symlink()
                   and not (hasattr(cur / d, 'is_junction') and (cur / d).is_junction())]
        if len(cur.relative_to(selected).parts) >= max_depth:
            dirs[:] = []
        if len(roots) == 1 and cur.name == next(iter(roots)):
            candidates.add(cur.parent)
        # Single-file torrents or parent folders containing the exact package root.
        if any((cur / root).exists() for root in roots):
            candidates.add(cur)
    valid = []
    for base in candidates:
        paths = [safe_file(base, f['name']) for f in files]
        if any(p.is_file() for p in paths):
            valid.append(base)
    if len(valid) != 1:
        raise ValueError('Multiple matching folders. Select one game folder directly' if valid else
                         'No matching repack found. Select the original download folder for this exact version (not the installed game)')
    return str(valid[0])


def find_repair_layout(selected, files, max_depth=4, max_dirs=2000):
    """Find a renamed repack by its relative layout; hashes decide validity later."""
    try:
        return find_save_path(selected, files, max_depth, max_dirs), {}
    except ValueError as error:
        if 'No matching repack' not in str(error):
            raise
    selected = Path(selected).resolve(strict=True)
    parts = [PurePosixPath(f['name'].replace('\\', '/')).parts for f in files]
    if any(len(p) < 2 for p in parts) or len({p[0] for p in parts}) != 1:
        raise ValueError('No matching repack found. Select its original download folder')
    candidates = []
    for count, (current, dirs, _) in enumerate(os.walk(selected, followlinks=False), 1):
        if count > max_dirs:
            raise ValueError('Too many folders. Select the game folder directly')
        current = Path(current)
        dirs[:] = [d for d in dirs if not (current / d).is_symlink()
                   and not (hasattr(current / d, 'is_junction') and (current / d).is_junction())]
        if len(current.relative_to(selected).parts) >= max_depth:
            dirs[:] = []
        paths = [safe_file(current, '/'.join(p[1:])) for p in parts]
        if any(file.is_file() for file in paths):
            candidates.append(current)
    if len(candidates) != 1:
        raise ValueError('Multiple matching folders. Select one game folder directly' if candidates else
                         'No matching repack files found in the selected folder')
    folder = candidates[0]
    return str(folder.parent), {f['name']: folder.name + '/' + '/'.join(p[1:]) for f, p in zip(files, parts)}


def files_complete(ti, save_path):
    storage = ti.files()
    for i in range(ti.num_files()):
        if storage.file_flags(i) & storage.flag_pad_file:
            continue
        target = safe_file(save_path, storage.file_path(i))
        if not target.is_file() or target.stat().st_size != storage.file_size(i):
            return False
    return True