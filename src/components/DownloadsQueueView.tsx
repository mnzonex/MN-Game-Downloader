import React, { useEffect, useState } from 'react';
import { Download, Pause, Play, Trash2, WifiOff, Cpu, AlertTriangle, Folder, CheckCircle, Gamepad2, Clock, Calendar } from 'lucide-react';

import { DownloadTask, DownloadStatus } from '../types';

interface DownloadsQueueViewProps {
  tasks: DownloadTask[];
  isOnline: boolean;
  onPauseTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onRemoveTask: (id: string) => void;
}

export const DownloadsQueueView: React.FC<DownloadsQueueViewProps> = ({
  tasks,
  isOnline,
  onPauseTask,
  onResumeTask,
  onRemoveTask
}) => {
  
  const [scheduledTasks, setScheduledTasks] = useState<any[]>([]);

  const fetchScheduledTasks = () => {
    fetch('/api/downloads/scheduled')
      .then(res => res.json())
      .then(data => {
        if (data.scheduledTasks) {
          setScheduledTasks(data.scheduledTasks);
        }
      })
      .catch(err => console.error("Failed to fetch scheduled tasks", err));
  };

  useEffect(() => {
    fetchScheduledTasks();
    const interval = setInterval(fetchScheduledTasks, 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Custom event listener for refreshing scheduled queue
  useEffect(() => {
    const handleRefresh = () => fetchScheduledTasks();
    window.addEventListener('refresh-scheduled-queue', handleRefresh);
    return () => window.removeEventListener('refresh-scheduled-queue', handleRefresh);
  }, []);

  const activeTasks = tasks.filter(t => t.status === 'downloading' || t.status === 'waiting_reconnect' || t.status === 'extracting');

  
  const onRemoveScheduledTask = (id: string) => {
    fetch(`/api/downloads/scheduled/${id}`, { method: 'DELETE' })
      .then(() => fetchScheduledTasks())
      .catch(err => console.error(err));
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    if (bytes === 1) return '1 Byte';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusBadge = (status: DownloadStatus) => {
    switch (status) {
      case 'downloading':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 animate-pulse">
            <Download className="w-3 h-3 text-emerald-600" />
            Downloading via Torrent Engine
          </span>
        );
      case 'fetching_torrent':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200 flex items-center gap-1 animate-pulse">
            <Folder className="w-3 h-3 text-sky-600 animate-spin" />
            Fetching game.torrent...
          </span>
        );
      case 'waiting_reconnect':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1 animate-pulse">
            <WifiOff className="w-3 h-3 text-rose-600" />
            Reconnecting Stream...
          </span>
        );
      case 'extracting':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1 animate-pulse">
            <Cpu className="w-3 h-3 text-purple-600" />
            7-Zip Unpacking RAR/ZIP
          </span>
        );
      case 'paused':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            Paused
          </span>
        );
      case 'completed':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            Extracted & Ready
          </span>
        );
      case 'preparing':
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1 animate-pulse">
            <svg className="w-3 h-3 text-blue-600 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Grabbing Links...
          </span>
        );
      case 'queued':
      default:
        return (
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            In Queue
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Downloads Manager Header */}
      <div className="p-5 border-b border-slate-200/90 bg-white/80 backdrop-blur-md space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2.5">
              <span>Game Download Queue Manager</span>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold">
                Auto Reconnect Active
              </span>
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Direct Aria2 Torrent downloader engine with real-time tracking
            </p>
          </div>
        </div>

        {/* Network Disconnect Infinite Loop Notice */}
        {!isOnline && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <span className="font-bold">Loss of Connection Detected! </span>
                <span>Infinite Reconnection Engine active. Retrying automatically. Byte offsets saved.</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {tasks.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Download className="w-12 h-12 mx-auto mb-3 text-emerald-600 opacity-60" />
            <p className="font-bold text-slate-700 text-base">Download Queue is Empty</p>
            <p className="text-xs text-slate-500 mt-1">Search for games in the Browse Games tab to begin downloading</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-xs hover:shadow-md transition-all"
            >
              {/* Task Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {task.cover && task.cover.trim() !== '' ? (
                    <img
                      src={task.cover}
                      alt={task.title}
                      className="w-12 h-16 object-cover rounded-xl border border-slate-200 shrink-0 bg-slate-100 shadow-xs"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-12 h-16 rounded-xl border border-slate-200 shrink-0 bg-slate-100 shadow-xs flex items-center justify-center text-emerald-600">
                      <Gamepad2 className="w-6 h-6" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusBadge(task.status)}
                      <span className="text-[10px] font-mono text-slate-500 font-bold">
                        {task.repacker}
                      </span>
                    </div>

                    <h3 className="font-extrabold text-slate-900 text-sm truncate">
                      {task.title}
                    </h3>

                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      Target Directory: %AppData%\Roaming\MN Game Downloader\Games
                    </p>
                  </div>
                </div>

                {/* Control Actions */}
                <div className="flex items-center space-x-1.5 shrink-0">
                  {(task.status === 'downloading' || task.status === 'preparing' || task.status === 'queued') && (
                    <button
                      onClick={() => onPauseTask(task.id)}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-amber-700 transition-colors border border-slate-200 cursor-pointer"
                      title="Pause Download"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  )}

                  {task.status === 'paused' && (
                    <button
                      onClick={() => onResumeTask(task.id)}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-emerald-700 transition-colors border border-slate-200 cursor-pointer"
                      title="Resume Download"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => onRemoveTask(task.id)}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-700 transition-colors border border-slate-200 hover:border-rose-200 cursor-pointer"
                    title="Remove Task"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Progress & Speed Stats Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-900 font-bold">
                    {task.status === 'queued' || task.status === 'preparing' ? '0.0%' : `${task.progressPercent.toFixed(1)}%`}
                  </span>

                  <span className="text-slate-500 font-medium">
                    {task.status === 'queued' 
                      ? 'Waiting in queue...'
                      : task.status === 'preparing'
                      ? 'Preparing download links...'
                      : task.status === 'fetching_torrent'
                      ? (task.torrentFileSize ? `Step 1 Complete: Torrent File Saved (${(task.torrentFileSize / 1024).toFixed(0)} KB)` : `Step 1: Fetching Torrent File...`)
                      : task.status === 'downloading' && task.downloadedBytes === 0 && task.progressPercent === 0
                      ? 'Step 2: Connecting to Peers & Parsing Files...'
                      : task.status === 'downloading'
                      ? `Step 3: Downloading Game Files (${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalSizeBytes)})`
                      : `Downloading ${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalSizeBytes)}`
                    }
                  </span>

                  <span className="text-emerald-700 font-bold">
                    {task.status === 'downloading'
                      ? `${(task.speedBps / (1024 * 1024)).toFixed(1)} MB/s`
                      : task.status === 'fetching_torrent'
                      ? 'Fetching Metadata'
                      : task.status === 'extracting'
                      ? '7-Zip Unpacking...'
                      : task.status === 'waiting_reconnect'
                      ? 'Infinite Retrying...'
                      : task.status === 'queued'
                      ? 'Queued'
                      : task.status === 'preparing'
                      ? 'Preparing...'
                      : task.status}
                  </span>
                </div>

                {/* Overall Progress Bar */}
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/80 relative">
                  <div
                    className={`h-full transition-all duration-300 ${
                      task.status === 'waiting_reconnect'
                        ? 'bg-rose-500 animate-pulse'
                        : task.status === 'extracting'
                        ? 'bg-purple-600'
                        : task.status === 'preparing' || task.status === 'queued'
                        ? 'bg-blue-400'
                        : 'bg-emerald-600'
                    } ${task.status === 'preparing' ? 'w-full animate-pulse opacity-50' : ''}`}
                    style={{ width: task.status === 'preparing' ? '100%' : `${task.progressPercent}%` }}
                  />
                </div>
              </div>

            </div>
          ))
        )}
      </div>
    </div>
  );
};

