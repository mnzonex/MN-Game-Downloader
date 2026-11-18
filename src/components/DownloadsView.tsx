import { DownloadHistory } from './DownloadHistory';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, Pause, Play, Trash2, RotateCcw, AlertCircle,
  CheckCircle2, Loader2, HardDrive, Zap, Clock, Users,
  FolderOpen, ArrowDownCircle, X, Calendar, Moon
} from 'lucide-react';
import { toast } from 'sonner';
import {
  listTorrents, pauseTorrent, resumeTorrent, deleteTorrent, retryTorrent,
  startNowTorrent, formatSpeed, formatSize, formatEta,
} from '../services/downloadApi';
import type { TorrentInfo, TorrentStatus } from '../types';

interface DeleteConfirmState {
  id: string;
  name: string;
}

const StatusBadge: React.FC<{ torrent: TorrentInfo }> = ({ torrent }) => {
  const { status, errorMsg, progress, peers, downloadSpeed } = torrent;

  let label = 'Unknown';
  if (status === 'scheduled') label = 'Scheduled';
  else if (status === 'queued') label = 'Queued';
  else if (status === 'paused') label = 'Paused';
  else if (status === 'moving') label = 'Moving...';
  else if (status === 'verifying') label = 'Verifying...';
  else if (status === 'repairing') label = 'Repairing...';
  else if (status === 'completed') label = 'Completed';
  else if (status === 'error') label = errorMsg ? 'Error' : 'Failed';
  else if (status === 'downloading') {
    if (torrent.name === 'Downloading metadata...') label = 'Fetching Metadata...';
    else if (progress > 0 && peers === 0 && downloadSpeed === 0) label = 'Reconnecting...';
    else if (progress === 0 && peers === 0) label = 'Connecting to peers...';
    else if (peers > 0 && downloadSpeed === 0) label = 'Negotiating...';
    else label = 'Downloading';
  }

  const configs: Record<TorrentStatus, { classes: string; icon: React.ElementType }> = {
    scheduled:   { classes: 'bg-indigo-50 text-indigo-700 border-indigo-200',                       icon: Clock },
    queued:      { classes: 'bg-slate-100 text-slate-600 border-slate-200',                         icon: Clock },
    downloading: { classes: 'bg-blue-50 text-blue-700 border-blue-200',                             icon: Download },
    paused:      { classes: 'bg-amber-50 text-amber-700 border-amber-200',                          icon: Pause },
    moving:      { classes: 'bg-purple-50 text-purple-700 border-purple-200',                       icon: Loader2 },
    verifying:   { classes: 'bg-cyan-50 text-cyan-700 border-cyan-200',                             icon: RotateCcw },
    repairing:   { classes: 'bg-orange-50 text-orange-700 border-orange-200',                       icon: RotateCcw },
    completed:   { classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',                    icon: CheckCircle2 },
    error:       { classes: 'bg-red-50 text-red-700 border-red-200',                                icon: AlertCircle },
  };

  const cfg = configs[status] ?? configs.error;
  const Icon = cfg.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${cfg.classes}`}>
      <Icon className={`w-2.5 h-2.5 ${status === 'moving' || status === 'verifying' || status === 'repairing' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
};

const ProgressBar: React.FC<{ progress: number; status: TorrentStatus }> = ({ progress, status }) => {
  const pct = Math.round(progress * 100);
  const colorMap: Record<TorrentStatus, string> = {
    scheduled:   'bg-indigo-500',
    queued:      'bg-slate-400',
    downloading: 'bg-blue-500',
    paused:      'bg-amber-400',
    moving:      'bg-purple-500',
    verifying:   'bg-cyan-500',
    repairing:   'bg-orange-400',
    completed:   'bg-emerald-500',
    error:       'bg-red-400',
  };

  return (
    <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorMap[status] || 'bg-blue-500'} ${status === 'downloading' ? 'animate-none' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

const TorrentCard: React.FC<{
  torrent: TorrentInfo;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onRetry: (id: string) => void;
  onStartNow?: (id: string) => void;
  isActing: boolean;
}> = ({ torrent, onPause, onResume, onDelete, onRetry, onStartNow, isActing }) => {
  const pct = Math.round(torrent.progress * 100);
  const isActive = torrent.status === 'downloading' || torrent.status === 'repairing';
  const isMoving = torrent.status === 'moving';
  const isFailed = torrent.status === 'error';
  const isPaused = torrent.status === 'paused';
  const isScheduled = torrent.status === 'scheduled';
  const isQueued = torrent.status === 'queued';
  const canControl = !isMoving && !isActing;

  const isReconnecting = isActive && torrent.progress > 0 && torrent.peers === 0 && torrent.downloadSpeed === 0;

  return (
    <div className={`bg-white border rounded-2xl p-4 space-y-3 transition-all shadow-xs relative overflow-hidden ${
      isFailed ? 'border-red-200 bg-red-50/30' :
      isMoving  ? 'border-purple-200 bg-purple-50/20' :
      isScheduled ? 'border-indigo-200 bg-indigo-50/20' :
      isQueued ? 'border-slate-200 bg-slate-50/40' :
      'border-slate-200 hover:border-slate-300'
    }`}>
      {isReconnecting && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-800 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            Reconnecting / Finding peers...
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 relative z-0">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 truncate" title={torrent.name}>
            {torrent.name || 'Fetching torrent info...'}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {torrent.taskKind === 'repair' && <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded-lg">Repair download</span>}
            <StatusBadge torrent={torrent} />
            {torrent.size > 0 && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <HardDrive className="w-2.5 h-2.5" />
                {formatSize(torrent.size)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(isScheduled || isQueued) && onStartNow && (
            <button
              onClick={() => onStartNow(torrent.id)}
              disabled={!canControl}
              title="Start downloading now"
              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center gap-1 border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Start Now</span>
            </button>
          )}
          {isFailed && torrent.taskKind !== 'repair' && (
            <button
              onClick={() => onRetry(torrent.id)}
              disabled={!canControl}
              title="Retry"
              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {isActive && (
            <button
              onClick={() => onPause(torrent.id)}
              disabled={!canControl}
              title="Pause"
              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => onResume(torrent.id)}
              disabled={!canControl}
              title="Resume"
              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {!isMoving && (
            <button
              onClick={() => onDelete(torrent.id, torrent.name)}
              disabled={!canControl}
              title={isScheduled ? 'Cancel scheduled download' : 'Delete'}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isMoving && (
            <div className="p-1.5">
              <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin" />
            </div>
          )}
        </div>
      </div>

      {torrent.taskKind === 'repair' && <details open className="rounded-xl bg-orange-50/40 p-3"><summary className="text-xs font-bold cursor-pointer">Repair file progress</summary><p className="text-[10px] text-slate-500 my-2">Files may receive pieces at the same time. Completion is confirmed after the final hash check.</p><div className="max-h-56 overflow-y-auto space-y-2">{torrent.files?.length ? torrent.files.map(file => <div key={file.name} className="text-xs border-b pb-2"><p className="break-all">{file.name}</p><div className="flex justify-between text-slate-500"><span>{formatSize(file.downloaded)} / {formatSize(file.size)}</span><span>{file.status}</span></div><progress className="w-full h-1.5" max={file.size || 1} value={file.downloaded} /></div>) : <p className="text-xs text-slate-500">Waiting for engine file progress…</p>}</div></details>}
      {/* Progress bar (only for active, paused, moving, failed) */}
      {!isScheduled && (
        <div className="space-y-1 relative z-0">
          <ProgressBar progress={torrent.progress} status={torrent.status} />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <span>{pct}%</span>
              {torrent.size > 0 && (
                <span className="font-medium text-slate-400">
                  ({formatSize(torrent.progress * torrent.size)} / {formatSize(torrent.size)})
                </span>
              )}
            </span>
            {isActive && !isReconnecting && (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-0.5">
                  <Zap className="w-2.5 h-2.5 text-blue-500" />
                  {formatSpeed(torrent.downloadSpeed)}
                </span>
                <span className="flex items-center gap-0.5">
                  <Users className="w-2.5 h-2.5 text-slate-400" />
                  {torrent.peers} peers
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5 text-slate-400" />
                  {formatEta(torrent.etaSecs)}
                </span>
              </div>
            )}
            {isMoving && (
              <span className="text-purple-600 font-semibold animate-pulse">Moving to your folder...</span>
            )}
            {isQueued && (
              <span className="text-slate-500 font-medium">Waiting for current download to finish...</span>
            )}
            {isFailed && torrent.errorMsg && (
              <span className="text-red-500 truncate max-w-xs" title={torrent.errorMsg}>
                {torrent.errorMsg}
              </span>
            )}
            {isPaused && (
              <span className="text-amber-600 font-semibold">Paused — click ▶ to resume</span>
            )}
          </div>
        </div>
      )}

      {/* Scheduled info banner */}
      {isScheduled && (
        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-indigo-100/80">
          <div className="flex items-center gap-1.5 text-indigo-700 font-medium">
            {torrent.scheduledAt && new Date(torrent.scheduledAt).getHours() === 0 && new Date(torrent.scheduledAt).getMinutes() === 0 ? (
              <Moon className="w-3.5 h-3.5 text-indigo-600 fill-current" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
            )}
            {torrent.scheduledAt ? (
              <span>
                Scheduled for{' '}
                <strong className="text-indigo-900">
                  {new Date(torrent.scheduledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                  at {new Date(torrent.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                  {new Date(torrent.scheduledAt).getHours() === 0 && new Date(torrent.scheduledAt).getMinutes() === 0 ? (
                    <span className="ml-1 text-indigo-600 font-extrabold">(Midnight 🌙)</span>
                  ) : null}
                </strong>
                {torrent.scheduledAt > Date.now() ? (
                  <span className="text-indigo-500 font-normal ml-1">
                    (in {Math.max(1, Math.round((torrent.scheduledAt - Date.now()) / (60 * 1000)))} mins)
                  </span>
                ) : (
                  <span className="text-amber-600 font-bold ml-1">— due now, will auto-start</span>
                )}
              </span>
            ) : (
              <span>Scheduled download</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            Auto-triggers when ready
          </span>
        </div>
      )}
    </div>
  );
};

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

const DeleteModal: React.FC<{
  item: DeleteConfirmState;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}> = ({ item, onConfirm, onCancel }) => (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 border border-slate-200">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm">Delete Download</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[180px]" title={item.name}>{item.name}</p>
          </div>
        </div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Remove this download from the list? You can also delete the partially downloaded files.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onConfirm(false)}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Remove only
        </button>
        <button
          onClick={() => onConfirm(true)}
          className="px-3 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors"
        >
          Delete files too
        </button>
      </div>
    </div>
  </div>
);

// ── Live Speed Graph ─────────────────────────────────────────────────────────────

const LiveSpeedGraph: React.FC<{ history: number[] }> = ({ history }) => {
  const maxSpeed = Math.max(...history, 1024); // at least 1KB/s scale
  
  return (
    <div className="flex items-end h-8 gap-0.5 mt-2">
      {history.map((speed, i) => {
        const heightPct = Math.max(5, (speed / maxSpeed) * 100);
        return (
          <div 
            key={i} 
            className="w-1.5 bg-blue-500/80 rounded-t-[2px] transition-all duration-300"
            style={{ height: `${heightPct}%` }}
            title={formatSpeed(speed)}
          />
        );
      })}
    </div>
  );
};

// ── Main DownloadsView ─────────────────────────────────────────────────────────

export const DownloadsView: React.FC<{ onSuccessfulCompletion?: (kind: 'download' | 'repair') => void }> = ({ onSuccessfulCompletion }) => {
  const [torrents, setTorrents] = useState<TorrentInfo[]>([]);
  const [speedHistory, setSpeedHistory] = useState<number[]>(Array(40).fill(0));
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);

  // Track active downloads to trigger native Windows notification upon completion
  const prevActiveDownloadsRef = useRef<Map<string, { name: string; kind: 'download' | 'repair' }>>(new Map());
  const isInitialLoadRef = useRef(true);

  const triggerCompletionNotification = (name: string) => {
    // 1. Electron Native Notification
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const electron = (window as any).electron;
      if (electron?.notify) {
        electron.notify('Download Completed! 🎉', `${name} is downloaded and ready to install.`);
      }
    } catch {}

    // 2. HTML5 Web Notification Fallback
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('Download Completed! 🎉', {
            body: `${name} has finished downloading.`,
          });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') {
              new Notification('Download Completed! 🎉', {
                body: `${name} has finished downloading.`,
              });
            }
          });
        }
      }
    } catch {}

    // 3. Audio Chime (gentle pleasant tone)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch {}

    // 4. In-App Toast
    toast.success(`Download Complete! 🎉`, {
      description: `${name} has finished downloading and is ready to install.`,
      duration: 8000,
    });
  };

  const loadTorrents = useCallback(async () => {
    try {
      const all = await listTorrents();
      const visible = all.filter(t => !t.hidden);
      setTorrents(visible);
      
      const currentSpeed = visible.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0);
      setSpeedHistory(prev => [...prev.slice(1), currentSpeed]);

      // Check if any previously downloading item has now completed
      const currentActiveMap = new Map<string, { name: string; kind: 'download' | 'repair' }>();
      for (const t of visible) {
        if (['downloading', 'repairing', 'verifying', 'moving'].includes(t.status)) {
          currentActiveMap.set(t.id, { name: t.name, kind: t.taskKind === 'repair' ? 'repair' : 'download' });
        }
      }

      if (!isInitialLoadRef.current) {
        for (const [prevId, prevTask] of prevActiveDownloadsRef.current.entries()) {
          const currentItem = visible.find(t => t.id === prevId);
          // Only fire the notification when the item is still visible AND
          // has just reached 'completed' status. If the item simply disappeared
          // from the list (user deleted it), currentItem is undefined — we must
          // NOT treat deletion as completion.
          if (currentItem && currentItem.status === 'completed') {
            triggerCompletionNotification(prevTask.name);
            onSuccessfulCompletion?.(currentItem.taskKind === 'repair' || prevTask.kind === 'repair' ? 'repair' : 'download');
          }
        }
      } else {
        isInitialLoadRef.current = false;
      }

      prevActiveDownloadsRef.current = currentActiveMap;
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTorrents();
    const interval = setInterval(loadTorrents, 1000); // Poll every 1s for fluid graph
    return () => clearInterval(interval);
  }, [loadTorrents]);

  const withActing = async (id: string, fn: () => Promise<void>) => {
    setActingOn(s => new Set(s).add(id));
    try {
      await fn();
    } finally {
      setActingOn(s => { const n = new Set(s); n.delete(id); return n; });
      loadTorrents();
    }
  };

  const handlePause = (id: string) => withActing(id, async () => {
    await pauseTorrent(id);
    toast.info('Download paused');
  });

  const handleResume = (id: string) => withActing(id, async () => {
    await resumeTorrent(id);
    toast.success('Download resumed');
  });

  const handleDeleteRequest = (id: string, name: string) => {
    setDeleteConfirm({ id, name });
  };

  const handleDeleteConfirm = async (deleteFiles: boolean) => {
    if (!deleteConfirm) return;
    const { id, name } = deleteConfirm;
    setDeleteConfirm(null);
    // Remove from the tracking map immediately so the polling loop can never
    // fire a "Download Completed" notification for an item the user just deleted.
    prevActiveDownloadsRef.current.delete(id);
    await withActing(id, async () => {
      await deleteTorrent(id, deleteFiles);
      toast.success(deleteFiles ? 'Deleted with files' : 'Removed from list', {
        description: name,
      });
    });
  };

  const handleRetry = (id: string) => withActing(id, async () => {
    await retryTorrent(id);
    toast.info('Retrying download...');
  });

  const handleStartNow = (id: string) => withActing(id, async () => {
    await startNowTorrent(id);
    toast.success('Download started now! 🚀');
  });

  const scheduledTorrents = torrents.filter(t => t.status === 'scheduled');
  const queuedTorrents = torrents.filter(t => t.status === 'queued');
  const activeTorrents = torrents.filter(t => ['downloading', 'repairing', 'verifying'].includes(t.status));
  const pausedTorrents = torrents.filter(t => t.status === 'paused');
  const failedTorrents = torrents.filter(t => t.status === 'error');
  const movingTorrents = torrents.filter(t => t.status === 'moving');

  const displayTorrents = [
    ...movingTorrents,
    ...activeTorrents,
    ...queuedTorrents,
    ...scheduledTorrents,
    ...pausedTorrents,
    ...failedTorrents,
  ];
  const totalSpeed = activeTorrents.reduce((sum, t) => sum + t.downloadSpeed, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-end justify-between">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
            <ArrowDownCircle className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900 text-lg leading-none mb-1.5">Downloads</h2>
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-500 font-medium">
                {activeTorrents.length > 0
                  ? <span className="text-blue-600 font-bold">{activeTorrents.length} active</span>
                  : scheduledTorrents.length > 0
                  ? <span className="text-indigo-600 font-bold">{scheduledTorrents.length} scheduled</span>
                  : 'No active downloads'}
              </p>
              {activeTorrents.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded text-xs font-bold text-slate-700">
                  <Zap className="w-3 h-3 text-amber-500" />
                  {formatSpeed(totalSpeed)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {displayTorrents.length > 0 && (
            <span className="text-xs text-slate-500 font-semibold mb-1">
              {displayTorrents.length} {displayTorrents.length === 1 ? 'item' : 'items'} in queue
            </span>
          )}
          {activeTorrents.length > 0 && <LiveSpeedGraph history={speedHistory} />}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        ) : displayTorrents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
              <FolderOpen className="w-8 h-8 text-slate-400" />
            </div>
            <div>
              <p className="font-bold text-slate-700 text-sm">No active downloads</p>
              <p className="text-xs text-slate-400 mt-1">
                Go to Browse Games and click <strong>⬇ Download</strong> to start or schedule
              </p>
            </div>
          </div>
        ) : (
          <>
            {movingTorrents.length > 0 && (
              <Section label="Moving to folder">
                {movingTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
            {activeTorrents.length > 0 && (
              <Section label="Downloads and repairs">
                {activeTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
            {queuedTorrents.length > 0 && (
              <Section label="Queued (Waiting in line)">
                {queuedTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
            {scheduledTorrents.length > 0 && (
              <Section label="Scheduled Downloads">
                {scheduledTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
            {pausedTorrents.length > 0 && (
              <Section label="Paused">
                {pausedTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
            {failedTorrents.length > 0 && (
              <Section label="Failed">
                {failedTorrents.map(t => (
                  <TorrentCard
                    key={t.id} torrent={t}
                    onPause={handlePause} onResume={handleResume}
                    onDelete={handleDeleteRequest} onRetry={handleRetry}
                    onStartNow={handleStartNow}
                    isActing={actingOn.has(t.id)}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <DownloadHistory />
      {/* Delete confirm modal */}
      {deleteConfirm && (
        <DeleteModal
          item={deleteConfirm}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-2">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">{label}</p>
    {children}
  </div>
);