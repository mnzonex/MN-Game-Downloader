"""
ENGINE.PY - Python Libtorrent Sidecar

HTTP API ENDPOINTS:
  GET /list
    Returns: [ { id, name, progress, download_rate, upload_rate, peers, seeds, eta_secs, state, size, is_finished, is_moved, error } ]
  POST /add
    Body: { "magnet": "...", "save_path": "..." }
    Returns: { "id": "...", "name": "..." }
  POST /remove
    Body: { "id": "...", "delete_files": bool }
    Returns: { "ok": true }
  POST /pause
    Body: { "id": "..." }
    Returns: { "ok": true }
  POST /resume
    Body: { "id": "..." }
    Returns: { "ok": true }
  POST /move
    Body: { "id": "...", "target_path": "..." }
    Returns: { "ok": true }
  POST /shutdown
    Body: {}
    Returns: { "ok": true }
"""

import sys
import json
import time
import os
import shutil
import threading
import traceback
import signal
from integrity import package_files, scan_report, write_manifest
from repair_utils import find_save_path, find_repair_layout, files_complete, safe_file
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler

try:
    import libtorrent as lt
except ImportError:
    print("ERROR: libtorrent not installed")
    sys.exit(1)

# Ensure UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def log(msg):
    try:
        safe_msg = str(msg).encode('utf-8', errors='replace').decode('utf-8')
        sys.stdout.write(f"[ENGINE] {safe_msg}\n")
        sys.stdout.flush()
    except Exception:
        pass  # Never crash the engine because of a log message


PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3001
SAVE_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), '.mndownloads')
PARENT_PID = int(sys.argv[3]) if len(sys.argv) > 3 else (int(os.environ.get('PARENT_PID', 0)) if os.environ.get('PARENT_PID') else None)
RESUME_DIR = os.path.join(SAVE_DIR, '.resume')

# Validate SAVE_DIR
try:
    os.makedirs(SAVE_DIR, exist_ok=True)
    os.makedirs(RESUME_DIR, exist_ok=True)
    test_file = os.path.join(SAVE_DIR, '.test')
    with open(test_file, 'w') as f:
        f.write('test')
    os.remove(test_file)
except Exception as e:
    log(f"FATAL: SAVE_DIR '{SAVE_DIR}' is not writable. {e}")
    sys.exit(1)

log(f"Starting engine on port {PORT}, Save Dir: {SAVE_DIR}, Parent PID: {PARENT_PID}")

# Global State
torrents = {}  # id -> {'handle': handle, 'target_path': str|None, 'is_moved': bool, 'error': str|None}
is_shutting_down = False
metadata_cache = {}

# 1. SESSION SETTINGS FOR LARGE FILES
settings = {
    'listen_interfaces': '0.0.0.0:6881',
    'enable_dht': True,
    'enable_lsd': True,
    'enable_upnp': True,
    'enable_natpmp': True,
    
    # 100GB+ File Tuning
    'cache_size': 32768,               # 512MB disk cache (32768 * 16KB blocks)
    'connections_limit': 500,          # High peer swarms
    'mixed_mode_algorithm': 0,         # Prefer TCP/uTP balance
    'file_pool_size': 40,              # Max open files
    
    # Buffers
    'send_buffer_watermark': 500 * 1024,
    'send_buffer_low_watermark': 10 * 1024,
    'send_buffer_watermark_factor': 50,
    
    # Unlimited upload during download (crucial for tit-for-tat speed),
    # we prevent seeding by removing the torrent once it finishes.
    'upload_rate_limit': 0,
    
    # Alert mask (to receive finish, move, and resume data alerts)
    'alert_mask': lt.alert.category_t.all_categories
}

ses = lt.session(settings)

def get_state_string(state):
    states = ['queued', 'checking', 'downloading_metadata', 'downloading', 'finished', 'seeding', 'allocating', 'checking_resume_data']
    return states[int(state)] if 0 <= int(state) < len(states) else 'unknown'

# ── Resilient Mover Worker ───────────────────────────────────────────────────
moving_tasks = set()

def move_worker(tid, target_path):
    obj = torrents.get(tid)
    if not obj or not obj.get('is_verified') or tid in moving_tasks:
        return
    h = obj['handle']
    if os.path.normcase(os.path.abspath(h.status().save_path)) == os.path.normcase(os.path.abspath(target_path)):
        moving_tasks.add(tid)
        h.unset_flags(lt.torrent_flags.auto_managed)
        h.pause()
        obj['is_manifesting'] = True
        try:
            obj['manifest_path'] = write_manifest(h, lambda: tid not in torrents or is_shutting_down)
            obj['is_moved'] = True
        except Exception as e:
            obj['error'] = 'Manifest generation failed: ' + str(e)
        finally:
            obj['is_manifesting'] = False
            moving_tasks.discard(tid)
        return
    moving_tasks.add(tid)
    try:
        os.makedirs(target_path, exist_ok=True)
        h.pause()
        h.move_storage(target_path)
    except Exception as e:
        moving_tasks.discard(tid)
        obj['error'] = 'Move failed; verified source files retained: ' + str(e)


def trigger_move_worker(tid, target_path):
    threading.Thread(target=move_worker, args=(tid, target_path), daemon=True).start()

# 3. BACKGROUND ALERT LOOP
def alert_loop():
    global is_shutting_down
    while not is_shutting_down:
        try:
            alerts = ses.pop_alerts()
            for alert in alerts:
                # Metadata received — generate file manifest
                if isinstance(alert, lt.metadata_received_alert):
                    tid = str(alert.handle.info_hash())
                    if tid in torrents:
                        h = alert.handle
                        size = h.status().total_wanted
                        save_path = h.status().save_path
                        
                        # Save file list manifest for integrity verification
                        try:
                            ti = h.torrent_file()
                            if ti:
                                manifest = {
                                    'name': ti.name(),
                                    'total_size': ti.total_size(),
                                    'num_files': ti.num_files(),
                                    'files': []
                                }
                                for i in range(ti.num_files()):
                                    manifest['files'].append({
                                        'path': ti.files().file_path(i),
                                        'size': ti.files().file_size(i)
                                    })
                                m_path = os.path.join(RESUME_DIR, f"{tid}.manifest.json")
                                with open(m_path, 'w', encoding='utf-8') as mf:
                                    mf.write(json.dumps(manifest, indent=2))
                                log(f"Saved package manifest for {tid}: {ti.num_files()} files, {ti.total_size()} bytes")
                        except Exception as me:
                            log(f"Failed to save manifest for {tid}: {me}")

                        # Check free space on the SAVE path drive
                        try:
                            check_path = os.path.splitdrive(save_path)[0] + os.sep
                            total, used, free = shutil.disk_usage(check_path)
                            if size > 0 and free < size + (512 * 1024 * 1024):
                                log(f"Insufficient disk space for {tid}. Need: {size // (1024*1024)}MB, Free: {free // (1024*1024)}MB")
                                h.pause()
                                torrents[tid]['error'] = f"Not enough disk space! Need {size // (1024*1024*1024 or 1):.1f}GB, only {free // (1024*1024*1024 or 1):.1f}GB free."
                        except Exception as e:
                            log(f"Disk space check error: {e}")

                # Torrent Finished Download Phase
                elif isinstance(alert, lt.torrent_finished_alert):
                    h = alert.handle
                    tid = str(h.info_hash())
                    name = alert.torrent_name if hasattr(alert, 'torrent_name') else tid
                    log(f"Torrent Download Finished: {tid} ({name})")
                    if tid in torrents and torrents[tid].get('scan_only'):
                        continue
                    
                    # Flush disk cache to ensure all write buffers hit disk
                    try:
                        h.save_resume_data(lt.save_resume_flags_t.flush_disk_cache)
                    except Exception:
                        pass

                    if tid in torrents:
                        # If already verified, safe to move!
                        if torrents[tid].get('scan_only') or torrents[tid].get('is_verifying'):
                            continue
                        if torrents[tid].get('is_verified'):
                            log(f"Torrent {tid} already verified 100%. Executing move...")
                            if torrents[tid].get('target_path'):
                                target = torrents[tid]['target_path']
                                trigger_move_worker(tid, target)
                        else:
                            # Start 100% cryptographic piece hash verification (force_recheck)
                            torrents[tid]['is_verifying'] = True
                            torrents[tid]['is_repairing'] = False
                            log(f"Starting 100% piece hash verification (force_recheck) for {tid}...")
                            
                            def delayed_recheck(th, t_id):
                                time.sleep(1.0)
                                try:
                                    th.force_recheck()
                                except Exception as err_rc:
                                    log(f"force_recheck exception for {t_id}: {err_rc}")
                            threading.Thread(target=delayed_recheck, args=(h, tid), daemon=True).start()

                # Torrent Checked (Result of force_recheck)
                elif isinstance(alert, lt.torrent_checked_alert):
                    h = alert.handle
                    tid = str(h.info_hash())
                    if tid in torrents:
                        s = h.status()
                        log(f"Torrent piece check complete for {tid}: progress={s.progress:.4f}, state={s.state}, wanted_done={s.total_wanted_done}/{s.total_wanted}")
                        
                        if torrents[tid].get('scan_only'):
                            h.pause()
                            torrents[tid]['report'] = scan_report(h, torrents[tid]['before'], torrents[tid].get('game_name'))
                            torrents[tid]['is_verifying'] = False
                            continue
                        if torrents[tid].get('is_verifying'):
                            # 1. Piece hash check: all pieces must match SHA-1 hashes
                            hash_ok = bool(s.has_metadata and s.is_seeding and s.total_wanted_done == s.total_wanted)
                            try:
                                manifest_ok = files_complete(h.torrent_file(), s.save_path)
                            except Exception as e:
                                manifest_ok = False
                                log(f"Disk verification failed: {e}")

                            if hash_ok and manifest_ok:
                                log(f"[VERIFY] SUCCESS: Torrent {tid} passed 100% integrity verification!")
                                torrents[tid]['is_verifying'] = False
                                torrents[tid]['is_repairing'] = False
                                torrents[tid]['is_verified'] = True
                                torrents[tid]['error'] = None
                                
                                target = torrents[tid].get('target_path')
                                if target:
                                    trigger_move_worker(tid, target)
                            else:
                                attempts = torrents[tid].get('verification_attempts', 0) + 1
                                torrents[tid]['verification_attempts'] = attempts
                                log(f"[VERIFY] FAILED for {tid} (attempt {attempts}/3). HashOK={hash_ok}, ManifestOK={manifest_ok}")
                                
                                if attempts >= 3:
                                    torrents[tid]['is_verifying'] = False
                                    torrents[tid]['is_repairing'] = False
                                    torrents[tid]['error'] = "Verification failed after 3 checks. Check disk space, permissions and antivirus quarantine, then retry."
                                    h.pause()
                                else:
                                    # Resume to download ONLY missing pieces
                                    torrents[tid]['is_verifying'] = False
                                    torrents[tid]['is_repairing'] = True
                                    try:
                                        h.set_flags(lt.torrent_flags.auto_managed)
                                        h.resume()
                                        log(f"[REPAIR] Resumed {tid} to redownload missing pieces only.")
                                    except Exception as re_err:
                                        log(f"[REPAIR] Resume error for {tid}: {re_err}")

                # Storage Moved — mark done and cleanup meta
                elif isinstance(alert, lt.storage_moved_alert):
                    tid = str(alert.handle.info_hash())
                    log(f"Storage moved successfully for {tid}")
                    if tid in torrents:
                        moving_tasks.discard(tid)
                        torrents[tid]['is_verified'] = False
                        torrents[tid]['is_verifying'] = True
                        torrents[tid]['error'] = None
                        alert.handle.force_recheck()
                        alert.handle.resume()

                elif isinstance(alert, lt.storage_moved_failed_alert):
                    tid = str(alert.handle.info_hash())
                    err = alert.message()
                    log(f"Storage move failed for {tid}: {err}")
                    moving_tasks.discard(tid)
                    if tid in torrents:
                        torrents[tid]['error'] = 'Move failed; source files retained: ' + err

                # Save Resume Data
                elif isinstance(alert, lt.save_resume_data_alert):
                    tid = str(alert.handle.info_hash())
                    if tid in torrents:
                        path = os.path.join(RESUME_DIR, f"{tid}.fastresume")
                        try:
                            with open(path, 'wb') as f:
                                if hasattr(lt, 'write_resume_data_buf'):
                                    f.write(lt.write_resume_data_buf(alert.params))
                                else:
                                    f.write(lt.bencode(alert.resume_data))
                        except Exception as e:
                            log(f"Failed to save resume data for {tid}: {e}")

                elif isinstance(alert, lt.save_resume_data_failed_alert):
                    tid = str(alert.handle.info_hash())
                    log(f"Resume data generation failed for {tid}: {alert.message()}")

                # Error Alerts
                elif isinstance(alert, lt.file_error_alert):
                    tid = str(alert.handle.info_hash())
                    err = alert.message()
                    log(f"File Error for {tid}: {err}")
                    if tid in torrents:
                        torrents[tid]['error'] = f"File error: {err}"
        except Exception as e:
            log(f"Alert loop error: {e}")
        time.sleep(1)

threading.Thread(target=alert_loop, daemon=True).start()

# 4. RESUME DATA PERSISTENCE
def load_resume_data():
    log("Scanning for resume data...")
    count = 0
    for file in os.listdir(RESUME_DIR):
        if file.endswith('.fastresume'):
            tid = file.replace('.fastresume', '')
            path = os.path.join(RESUME_DIR, file)
            meta_path = os.path.join(RESUME_DIR, f"{tid}.meta")
            try:
                with open(path, 'rb') as f:
                    data = f.read()
                params = lt.read_resume_data(data)
                h = ses.add_torrent(params)
                actual_tid = str(h.info_hash())
                
                # Restore target_path from sidecar .meta file first
                meta = {}
                target_path = None
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, 'r', encoding='utf-8') as mf:
                            meta = json.loads(mf.read())
                            target_path = meta.get('target_path')
                    except Exception:
                        pass

                torrents[actual_tid] = {
                    'repair_task': meta.get('repair_task', False),
                    'handle': h,
                    'target_path': target_path,
                    'is_moved': False,
                    'is_verified': False,
                    'is_verifying': False,
                    'is_repairing': False,
                    'verification_attempts': 0,
                    'user_paused': bool(params.flags & lt.torrent_flags.paused),
                    'error': None
                }
                if h.status().is_finished:
                    torrents[actual_tid]['is_verifying'] = True
                    h.force_recheck()
                    h.resume()
                count += 1
            except Exception as e:
                log(f"Failed to load resume data {file}: {e} — deleting corrupt file")
                # Delete corrupt fastresume so it doesn't block future restarts
                try:
                    os.remove(path)
                except Exception:
                    pass
    log(f"Loaded {count} active torrents from resume data.")

def periodic_resume_save():
    while not is_shutting_down:
        time.sleep(180) # Every 3 mins
        if is_shutting_down: break
        for tid, obj in list(torrents.items()):
            h = obj['handle']
            if h.is_valid() and h.status().has_metadata and not obj.get('scan_only'):
                h.save_resume_data(lt.save_resume_flags_t.flush_disk_cache)

threading.Thread(target=periodic_resume_save, daemon=True).start()

class EngineAPI(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def _send_json(self, data, status=200):
        self.send_response(status)
        self._send_cors_headers()
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_GET(self):
        if self.path == '/list':
            res = []
            for tid, obj in list(torrents.items()):
                h = obj['handle']
                if not h.is_valid():
                    continue
                s = h.status()
                
                # If paused flag is set (user called our /pause which clears auto_managed),
                # force speed to 0 regardless of what libtorrent reports momentarily.
                is_paused = obj.get('user_paused', False)
                
                dl = 0 if is_paused else s.download_rate
                is_finished = s.is_finished
                is_verifying = obj.get('is_verifying', False) or obj.get('is_manifesting', False)
                is_repairing = obj.get('is_repairing', False)
                is_verified = obj.get('is_verified', False)

                state_str = 'paused' if is_paused else get_state_string(s.state)
                if not is_paused:
                    if is_verifying:
                        state_str = 'verifying'
                    elif is_repairing:
                        state_str = 'repairing'
                    elif is_finished:
                        state_str = 'finished' if is_verified else 'verifying'
                
                eta = -1 if dl == 0 else int((s.total_wanted - s.total_wanted_done) / dl)
                if is_finished and is_verified: eta = 0
                
                res.append({
                    'files': [{'name': entry['name'], 'size': entry['size'],
                               'downloaded': min(entry['size'], file_bytes[entry['index']]),
                               'status': ('Verified' if is_verified else 'Checking' if is_verifying else
                                          'Present / awaiting final check' if file_bytes[entry['index']] >= entry['size'] else
                                          'Paused' if is_paused else 'Downloading')}
                              for file_bytes in [h.file_progress()] for entry in package_files(h.torrent_file())]
                             if obj.get('repair_task') and s.has_metadata else [],
                    'id': str(tid),
                    'name': s.name if s.has_metadata else 'Downloading metadata...',
                    'progress': s.progress,
                    'speed_dl': dl,
                    'speed_ul': s.upload_rate,
                    'peers': s.num_peers,
                    'seeds': s.num_seeds,
                    'total_size': s.total_wanted,
                    'downloaded_bytes': s.total_wanted_done,
                    'eta_secs': eta,
                    'state': state_str,
                    'is_paused': is_paused,
                    'is_finished': is_finished,
                    'scan_only': obj.get('scan_only', False),
                    'manifest_path': obj.get('manifest_path'),
                    'is_verifying': is_verifying,
                    'is_repairing': is_repairing,
                    'is_verified': is_verified,
                    'is_moved': obj.get('is_moved', False),
                    'error': obj.get('error')
                })
            self._send_json(res)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global is_shutting_down
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
            data = json.loads(body) if body else {}
        except Exception as e:
            return self._send_json({"error": f"Invalid JSON body: {e}"}, 400)

        try:
            if self.path == '/inspect':
                magnet = data.get('magnet')
                timeout_sec = max(1, min(30, float(data.get('timeout', 8.0))))
                if not magnet:
                    return self._send_json({"error": "magnet required"}, 400)
                
                try:
                    params = lt.parse_magnet_uri(magnet)
                except Exception as pe:
                    return self._send_json({"error": f"Invalid magnet URI: {pe}"}, 400)

                info_hash = str(params.info_hash) if hasattr(params, 'info_hash') else None

                cached = metadata_cache.get(info_hash)
                if cached and info_hash not in torrents:
                    files = [{'name': cached.files().file_path(i), 'size': cached.files().file_size(i)}
                             for i in range(cached.num_files())]
                    return self._send_json({'ok': True, 'has_metadata': True, 'name': cached.name(),
                                           'total_size': cached.total_size(), 'files_count': len(files),
                                           'files': files, 'seeds': None, 'peers': None, 'availability_known': False})
                
                # If already active in session, return known status immediately
                if info_hash and info_hash in torrents:
                    h = torrents[info_hash]['handle']
                    s = h.status()
                    files = []
                    name = s.name
                    total_size = s.total_wanted
                    if s.has_metadata:
                        try:
                            ti = h.torrent_file()
                            if ti:
                                name = ti.name()
                                total_size = ti.total_size()
                                for i in range(ti.num_files()):
                                    files.append({
                                        'name': ti.files().file_path(i),
                                        'size': ti.files().file_size(i)
                                    })
                        except Exception: pass
                    return self._send_json({
                        'ok': True,
                        'has_metadata': s.has_metadata,
                        'name': name,
                        'total_size': total_size,
                        'files_count': len(files),
                        'files': files,
                        'seeds': s.num_seeds,
                        'peers': s.num_peers
                    })

                # Otherwise resolve metadata via temporary inspection session
                inspect_dir = os.path.join(SAVE_DIR, '.inspect_temp')
                os.makedirs(inspect_dir, exist_ok=True)
                params.save_path = inspect_dir
                params.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed)
                # Fetch metadata without selecting any payload files. stop_when_ready
                # must not be used here: metadata discovery itself is a ready state.
                params.flags |= lt.torrent_flags.default_dont_download
                params.storage_mode = lt.storage_mode_t.storage_mode_sparse
                
                trackers = [
                    'udp://tracker.opentrackr.org:1337/announce',
                    'udp://open.tracker.cl:1337/announce',
                    'udp://exodus.desync.com:6969/announce',
                    'udp://tracker.torrent.eu.org:451/announce',
                    'udp://tracker.moeking.me:6969/announce',
                    'http://tracker.openbittorrent.com:80/announce'
                ]
                for t in trackers:
                    params.ti.add_tracker(t) if params.ti else params.trackers.append(t)
                
                h = ses.add_torrent(params)
                try:
                    start_wait = time.time()
                    while time.time() - start_wait < timeout_sec:
                        if h.status().has_metadata:
                            break
                        time.sleep(0.3)
                        
                    s = h.status()
                    has_meta = s.has_metadata
                    files = []
                    name = s.name if has_meta else (data.get('fallback_name') or 'Torrent Game')
                    total_size = s.total_wanted if has_meta else 0
                    
                    if has_meta:
                        ti = h.torrent_file()
                        if ti:
                            metadata_cache[info_hash] = lt.torrent_info(ti)
                            if len(metadata_cache) > 32:
                                metadata_cache.pop(next(iter(metadata_cache)))
                            name = ti.name()
                            total_size = ti.total_size()
                            for i in range(ti.num_files()):
                                files.append({
                                    'name': ti.files().file_path(i),
                                    'size': ti.files().file_size(i)
                                })
                    
                    seeds = s.num_seeds
                    peers = s.num_peers
                    
                    try:
                        ses.remove_torrent(h, lt.session.delete_files)
                    except Exception:
                        pass
                        
                    return self._send_json({
                        'ok': True,
                        'has_metadata': has_meta,
                        'name': name,
                        'total_size': total_size,
                        'files_count': len(files),
                        'files': files,
                        'seeds': seeds,
                        'peers': peers
                    })
                except Exception as ie:
                    try:
                        ses.remove_torrent(h, lt.session.delete_files)
                    except Exception:
                        pass
                    return self._send_json({"error": str(ie)}, 500)

            elif self.path in ('/repair', '/repair/scan'):
                if self.path == '/repair':
                    return self._send_json({'error': 'Scan and confirm the game folder before repair.'}, 400)
                params = lt.parse_magnet_uri(data.get('magnet', ''))
                tid = str(params.info_hash)
                if tid in torrents:
                    return self._send_json({'error': 'This game is already active. Pause/remove its task without deleting files first.'}, 409)
                ti = metadata_cache.get(tid)
                # A portable torrent is usable only when its cryptographic infohash matches the selected magnet.
                if not ti:
                    selected = os.path.abspath(data.get('folder', ''))
                    visited = 0
                    for root, dirs, names in os.walk(selected, followlinks=False):
                        visited += 1
                        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d)) and not os.path.isjunction(os.path.join(root, d))]
                        if visited > 2000: break
                        if len(os.path.relpath(root, selected).split(os.sep)) > 4: dirs[:] = []
                        if '.mn-package.torrent' in names:
                            try:
                                candidate = lt.torrent_info(os.path.join(root, '.mn-package.torrent'))
                                if str(candidate.info_hash()) == tid:
                                    ti = candidate
                                    metadata_cache[tid] = ti
                                    break
                            except Exception: pass
                if not ti:
                    return self._send_json({'error': 'Resolve game metadata first, then retry Get missing files.'}, 409)
                files = [{'name': ti.files().file_path(i), 'size': ti.files().file_size(i)}
                         for i in range(ti.num_files()) if not (ti.files().file_flags(i) & ti.files().flag_pad_file)]
                save_path, mapping = find_repair_layout(data.get('folder', ''), files)
                ti = lt.torrent_info(ti)
                if mapping:
                    for i in range(ti.num_files()):
                        original = ti.files().file_path(i)
                        if original in mapping:
                            ti.rename_file(i, mapping[original])
                    files = [{'name': ti.files().file_path(i), 'size': ti.files().file_size(i)}
                             for i in range(ti.num_files()) if not (ti.files().file_flags(i) & ti.files().flag_pad_file)]
                scan_only = self.path == '/repair/scan'
                before = {entry['name']: safe_file(save_path, entry['name']).is_file() for entry in files}
                if not scan_only:
                    for entry in files:
                        file = safe_file(save_path, entry['name'])
                        if file.is_file() and file.stat().st_size > entry['size']:
                            with open(file, 'r+b') as output: output.truncate(entry['size'])
                params.ti = lt.torrent_info(ti)
                params.save_path = save_path
                params.flags &= ~(lt.torrent_flags.auto_managed | lt.torrent_flags.seed_mode)
                params.flags |= lt.torrent_flags.paused
                if scan_only: params.flags |= lt.torrent_flags.upload_mode
                params.storage_mode = lt.storage_mode_t.storage_mode_sparse
                h = ses.add_torrent(params)
                torrents[tid] = {'handle': h, 'target_path': save_path, 'is_moved': False,
                                 'is_verified': False, 'is_verifying': True, 'is_repairing': False,
                                 'verification_attempts': 0, 'error': None, 'scan_only': scan_only,
                                 'before': before, 'magnet': data.get('magnet'),
                                 'game_name': str(data.get('game_name') or '')[:300], 'created_at': time.time()}
                if not scan_only:
                    with open(os.path.join(RESUME_DIR, tid + '.meta'), 'w', encoding='utf-8') as mf:
                        json.dump({'target_path': save_path}, mf)
                h.force_recheck()
                h.resume()
                return self._send_json({'id': tid, 'name': ti.name(), 'save_path': save_path, 'size': ti.total_size()})

            elif self.path in ('/repair/status', '/repair/confirm', '/repair/cancel'):
                tid = data.get('id')
                obj = torrents.get(tid)
                if not obj or not obj.get('scan_only'):
                    return self._send_json({'error': 'Scan expired or already confirmed. Scan again.'}, 404)
                h = obj['handle']
                if self.path == '/repair/cancel':
                    ses.remove_torrent(h, 0)
                    del torrents[tid]
                    return self._send_json({'ok': True})
                if self.path == '/repair/status':
                    return self._send_json({'id': tid, 'checking': obj.get('is_verifying', False),
                                           'progress': h.status().progress, 'report': obj.get('report'), 'error': obj.get('error')})
                if not obj.get('report'):
                    return self._send_json({'error': 'Hash check still running'}, 409)
                if not obj['report'].get('identity_confirmed'):
                    return self._send_json({'error': obj['report'].get('identity_error') or 'Wrong game folder'}, 409)
                for entry in package_files(h.torrent_file()):
                    file = safe_file(h.status().save_path, entry['name'])
                    if file.is_file() and file.stat().st_size > entry['size']:
                        with open(file, 'r+b') as output: output.truncate(entry['size'])
                obj['scan_only'] = False
                obj['repair_task'] = True
                obj['is_verifying'] = True
                obj['user_paused'] = False
                with open(os.path.join(RESUME_DIR, tid + '.meta'), 'w', encoding='utf-8') as mf:
                    json.dump({'target_path': obj['target_path'], 'repair_task': True}, mf)
                h.unset_flags(lt.torrent_flags.upload_mode | lt.torrent_flags.auto_managed)
                h.force_recheck()
                h.resume()
                return self._send_json({'id': tid, 'name': h.status().name, 'magnet': obj['magnet'],
                                       'save_path': h.status().save_path, 'size': h.status().total_wanted})

            elif self.path == '/add':
                magnet = data.get('magnet')
                save_path = data.get('save_path', SAVE_DIR)
                if not magnet:
                    return self._send_json({"error": "magnet required"}, 400)
                
                params = lt.parse_magnet_uri(magnet)
                
                # Check if this torrent is already in session or has stale resume files; if so, purge it for a fresh start
                tid_preview = str(params.info_hash) if hasattr(params, 'info_hash') else None
                if tid_preview and tid_preview in torrents:
                    return self._send_json({'error': 'This game already has an active task. Resume it from Downloads.'}, 409)
                
                if tid_preview:
                    for ext in ['.fastresume', '.meta', '.manifest.json']:
                        fp = os.path.join(RESUME_DIR, f"{tid_preview}{ext}")
                        if os.path.exists(fp):
                            try: os.remove(fp)
                            except: pass

                params.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed | lt.torrent_flags.upload_mode)
                params.save_path = save_path
                if tid_preview in metadata_cache:
                    params.ti = lt.torrent_info(metadata_cache[tid_preview])
                # Sparse allocation
                params.storage_mode = lt.storage_mode_t.storage_mode_sparse
                
                # Add default trackers for faster metadata resolution
                trackers = [
                    'udp://tracker.opentrackr.org:1337/announce',
                    'udp://open.tracker.cl:1337/announce',
                    'udp://exodus.desync.com:6969/announce',
                    'udp://tracker.torrent.eu.org:451/announce',
                    'udp://tracker.moeking.me:6969/announce',
                    'http://tracker.openbittorrent.com:80/announce'
                ]
                for t in trackers:
                    params.ti.add_tracker(t) if params.ti else params.trackers.append(t)
                
                h = ses.add_torrent(params)
                info_hash = str(h.info_hash())

                # Accept optional target_path immediately in /add (avoids race with /move)
                target_path = data.get('target_path', None)
                if target_path:
                    meta_path = os.path.join(RESUME_DIR, f"{info_hash}.meta")
                    try:
                        os.makedirs(os.path.dirname(meta_path), exist_ok=True)
                        with open(meta_path, 'w', encoding='utf-8') as mf:
                            mf.write(json.dumps({"target_path": target_path}))
                    except Exception as e:
                        log(f"Failed to persist .meta on /add for {info_hash}: {e}")

                torrents[info_hash] = {
                    'handle': h,
                    'target_path': target_path,
                    'is_moved': False,
                    'is_verified': False,
                    'is_verifying': False,
                    'is_repairing': False,
                    'verification_attempts': 0,
                    'error': None
                }
                log(f"Added magnet: {info_hash} target_path={target_path}")
                return self._send_json({"id": info_hash, "name": "Downloading metadata..."})
            
            elif self.path == '/remove':
                tid = data.get('id')
                delete_files = data.get('delete_files', False)
                if not tid or tid not in torrents:
                    return self._send_json({"error": "Torrent not found"}, 404)
                
                h = torrents[tid]['handle']
                if os.path.normcase(os.path.abspath(h.status().save_path)) == os.path.normcase(os.path.abspath(torrents[tid].get('target_path') or SAVE_DIR)):
                    delete_files = False
                ses.remove_torrent(h, lt.session.delete_files if delete_files else 0)
                
                # Cleanup resume, meta, and manifest files
                for ext in ['.fastresume', '.meta', '.manifest.json']:
                    fp = os.path.join(RESUME_DIR, f"{tid}{ext}")
                    if os.path.exists(fp):
                        try: os.remove(fp)
                        except: pass
                
                del torrents[tid]
                log(f"Removed torrent: {tid} (delete_files={delete_files})")
                return self._send_json({"ok": True})
                
            elif self.path == '/pause':
                tid = data.get('id')
                if not tid or tid not in torrents:
                    return self._send_json({"error": "Torrent not found"}, 404)
                h = torrents[tid]['handle']
                # Must unset auto_managed BEFORE pausing, otherwise libtorrent's
                # internal session queue manager will silently re-queue the torrent
                # and resume downloading chunks even though we called h.pause().
                h.unset_flags(lt.torrent_flags.auto_managed)
                h.pause()
                torrents[tid]['user_paused'] = True
                log(f"Paused torrent {tid} (auto_managed cleared)")
                return self._send_json({"ok": True})
                
            elif self.path == '/resume':
                tid = data.get('id')
                if not tid or tid not in torrents:
                    return self._send_json({"error": "Torrent not found"}, 404)
                h = torrents[tid]['handle']
                # Restore auto_managed so the session can manage download slots
                # normally, then call resume to restart the download.
                h.unset_flags(lt.torrent_flags.auto_managed)
                h.resume()
                torrents[tid]['user_paused'] = False
                log(f"Resumed torrent {tid} (auto_managed restored)")
                return self._send_json({"ok": True})
                
            elif self.path == '/move':
                tid = data.get('id')
                target = data.get('target_path')
                if not tid or tid not in torrents:
                    return self._send_json({"error": "Torrent not found"}, 404)
                if not target:
                    return self._send_json({"error": "target_path required"}, 400)
                
                # Always persist target_path to .meta so it survives restarts
                meta_path = os.path.join(RESUME_DIR, f"{tid}.meta")
                try:
                    with open(meta_path, 'w', encoding='utf-8') as mf:
                        mf.write(json.dumps({"target_path": target,
                                             **({'repair_task': True} if torrents[tid].get('repair_task') else {})}))
                except Exception as e:
                    log(f"Failed to save .meta for {tid}: {e}")
                
                h = torrents[tid]['handle']
                if h.status().is_finished and torrents[tid].get('is_verified'):
                    log(f"Manual move triggered for {tid} to {target}")
                    try:
                        trigger_move_worker(tid, target)
                        torrents[tid]['target_path'] = target
                        return self._send_json({"ok": True})
                    except Exception as e:
                        return self._send_json({"error": str(e)}, 500)
                else:
                    # Save target_path for auto-move on completion
                    torrents[tid]['target_path'] = target
                    return self._send_json({"ok": True, "msg": "Will move on completion"})
                
            elif self.path == '/settings':
                # Apply libtorrent session settings such as download rate limit
                dl_limit = int(data.get('download_rate_limit', 0))
                try:
                    ses.apply_settings({'download_rate_limit': dl_limit})
                    log(f"Applied libtorrent download_rate_limit: {dl_limit} bytes/sec")
                    return self._send_json({"ok": True, "download_rate_limit": dl_limit})
                except Exception as e:
                    log(f"Failed to apply libtorrent settings: {e}")
                    return self._send_json({"error": str(e)}, 500)

            elif self.path == '/shutdown':
                log("Shutdown requested via API")
                self._send_json({"ok": True})
                shutdown_gracefully()
            else:
                self.send_response(404)
                self.end_headers()
                
        except Exception as e:
            err_trace = traceback.format_exc()
            log(f"API Error ({self.path}): {err_trace}")
            self._send_json({"error": str(e)}, 500)

    def log_message(self, format, *args):
        pass # Suppress HTTP logging

def shutdown_gracefully(*args):
    global is_shutting_down
    if is_shutting_down: return
    is_shutting_down = True
    
    log("Initiating graceful shutdown...")
    ses.pause()
    
    active = 0
    for tid, obj in torrents.items():
        h = obj['handle']
        if h.is_valid() and h.status().has_metadata:
            h.save_resume_data(lt.save_resume_flags_t.flush_disk_cache)
            active += 1
            
    # Wait for alerts
    log(f"Waiting for {active} resume data saves...")
    timeout = 10
    start_t = time.time()
    
    while active > 0 and time.time() - start_t < timeout:
        alerts = ses.pop_alerts()
        for alert in alerts:
            if isinstance(alert, lt.save_resume_data_alert):
                tid = str(alert.handle.info_hash())
                fr_path = os.path.join(RESUME_DIR, f"{tid}.fastresume")
                try:
                    if hasattr(lt, 'write_resume_data_buf'):
                        resume_data = lt.write_resume_data_buf(alert.params)
                    else:
                        resume_data = lt.bencode(alert.resume_data)
                    with open(fr_path, 'wb') as f:
                        f.write(resume_data)
                except Exception as e:
                    log(f"Failed to save resume on shutdown for {tid}: {e}")
                active -= 1
            elif isinstance(alert, lt.save_resume_data_failed_alert):
                active -= 1
        time.sleep(0.1)
        
    log("Shutdown complete.")
    os._exit(0)

signal.signal(signal.SIGINT, shutdown_gracefully)
signal.signal(signal.SIGTERM, shutdown_gracefully)

# ── Watchdog: auto-terminate if parent process terminates ─────────────────────────
def parent_watchdog():
    if not PARENT_PID or PARENT_PID <= 0:
        return
    import ctypes
    while not is_shutting_down:
        time.sleep(1.5)
        try:
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, PARENT_PID) # PROCESS_QUERY_LIMITED_INFORMATION
            if handle == 0:
                log(f"Parent process PID {PARENT_PID} not found. Terminating engine...")
                shutdown_gracefully()
                break
            else:
                exit_code = ctypes.c_ulong()
                if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    if exit_code.value != 259: # 259 = STILL_ACTIVE
                        kernel32.CloseHandle(handle)
                        log(f"Parent process PID {PARENT_PID} exited. Terminating engine...")
                        shutdown_gracefully()
                        break
                kernel32.CloseHandle(handle)
        except Exception:
            pass

if PARENT_PID and PARENT_PID > 0:
    threading.Thread(target=parent_watchdog, daemon=True).start()

def run_server():
    load_resume_data()
    server = ThreadingHTTPServer(('127.0.0.1', PORT), EngineAPI)
    print(f"ENGINE_READY:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown_gracefully()

if __name__ == '__main__':
    run_server()