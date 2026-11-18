"""Torrent-backed scan reports and portable SHA-256 manifests."""
import hashlib
import json
import os
import re
from pathlib import Path
from datetime import datetime, timezone
from repair_utils import safe_file

MANIFEST = '.mn-game.json'


def package_files(ti):
    storage = ti.files()
    return [{'name': storage.file_path(i), 'size': storage.file_size(i), 'index': i,
             'offset': storage.file_offset(i)} for i in range(ti.num_files())
            if not storage.file_flags(i) & storage.flag_pad_file]


def scan_report(handle, before, expected_title=None):
    ti = handle.torrent_file()
    status = handle.status()
    result = []
    identity_confirmed = False
    for entry in package_files(ti):
        file = safe_file(status.save_path, entry['name'])
        first = entry['offset'] // ti.piece_length()
        last = (entry['offset'] + entry['size'] - 1) // ti.piece_length()
        valid = all(handle.have_piece(i) for i in range(first, last + 1)) if entry['size'] else True
        # Shared repack helpers (setup, QuickSFV, checksums, artwork) do not identify a game.
        name = entry['name'].replace('\\', '/').lower()
        leaf = name.rsplit('/', 1)[-1]
        helper = (leaf.startswith(('setup', 'unins', 'quicksfv', 'dxsetup', 'vcredist')) or
                  Path(leaf).suffix in ('.txt', '.md5', '.sfv', '.bat', '.cmd', '.ini', '.nfo', '.jpg', '.png', '.ico'))
        # Only count hash-verified pieces wholly inside a payload file, not a boundary shared with helpers.
        interior_first = (entry['offset'] + ti.piece_length() - 1) // ti.piece_length()
        interior_end = (entry['offset'] + entry['size']) // ti.piece_length()
        if not helper and before.get(entry['name'], False):
            identity_confirmed |= any(handle.have_piece(i) for i in range(interior_first, interior_end))
            if valid and entry['size'] > 0 and file.is_file() and file.stat().st_size == entry['size']:
                identity_confirmed = True
        if not before.get(entry['name'], False):
            state = 'missing'
        elif not file.is_file() or file.stat().st_size != entry['size']:
            state = 'wrong_size'
        else:
            state = 'ok' if valid else 'damaged'
        result.append({**entry, 'status': state})
    torrent_name = ti.name()
    expected_tokens = _game_tokens(expected_title or '')
    torrent_tokens = _game_tokens(torrent_name)
    title_match = not expected_tokens or (len(expected_tokens & torrent_tokens) >= min(2, len(expected_tokens)))
    identity_confirmed = identity_confirmed and title_match
    title_error = f"The selected game '{expected_title}' does not match this magnet's game '{torrent_name}'. Select the correct game's download option." if not title_match else None
    return {'files': result, 'all_ok': all(f['status'] == 'ok' for f in result),
            'identity_confirmed': identity_confirmed, 'title_match': title_match,
            'torrent_name': torrent_name,
            'identity_error': title_error or (None if identity_confirmed else 'This folder does not contain a hash-verified game data file for the selected game. Select the original downloaded repack for this game and version.'),
            'missing_bytes': max(0, status.total_wanted - status.total_wanted_done),
            'total_size': status.total_wanted, 'folder': status.save_path,
            'name': ti.name(), 'id': str(handle.info_hash())}


def _game_tokens(value):
    value = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', str(value).lower())
    ignored = {'fitgirl', 'repack', 'edition', 'deluxe', 'ultimate', 'complete', 'the', 'and', 'version'}
    return {token for token in re.findall(r'[a-z0-9]+', value) if len(token) > 2 and token not in ignored}


def write_manifest(handle, cancelled=lambda: False):
    ti = handle.torrent_file()
    files = package_files(ti)
    base = Path(handle.status().save_path)
    paths = [safe_file(base, f['name']) for f in files]
    roots = {Path(f['name']).parts[0] for f in files}
    folder = base / next(iter(roots)) if len(roots) == 1 and paths and len(Path(files[0]['name']).parts) > 1 else base
    manifest_path = folder / MANIFEST
    old = {}
    try:
        old = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    records = []
    for entry, file in zip(files, paths):
        digest = hashlib.sha256()
        with file.open('rb') as stream:
            while True:
                if cancelled():
                    raise RuntimeError('Manifest generation cancelled')
                chunk = stream.read(4 * 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        records.append({'path': str(file.relative_to(folder)).replace('\\', '/'),
                        'size': entry['size'], 'sha256': digest.hexdigest()})
    folder_hash = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    manifest = {'schema': 1, 'infohash': str(handle.info_hash()), 'name': ti.name(),
                'total_size': sum(f['size'] for f in records), 'files': records,
                'folder_sha256': folder_hash, 'verified_at': datetime.now(timezone.utc).isoformat(),
                'cover': old.get('cover'), 'display_name': old.get('display_name', ti.name())}
    import libtorrent as lt
    manifest['magnet'] = lt.make_magnet_uri(ti)
    # Retain trusted torrent metadata alongside the manifest for offline rechecks.
    (folder / '.mn-package.torrent').write_bytes(lt.bencode(lt.create_torrent(ti).generate()))
    temp = folder / (MANIFEST + '.tmp')
    temp.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    os.replace(temp, manifest_path)
    return str(manifest_path)