import React, { useState, useEffect } from 'react';
import {
  Folder,
  HardDrive,
  Trash2,
  LayoutGrid,
  Wrench,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Loader2,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { DownloadTask } from '../types';
import { apiFetch } from '../services/api';

interface GamesLibraryViewProps {
  completedTasks: DownloadTask[];
  onDeleteGame: (id: string) => void;
}

interface LibraryGame {
  id: string;
  title: string;
  cover: string;
  repacker: string;
  installDate?: string;
  totalSizeBytes: number;
  installPath: string;
  isInstalled?: boolean;
  installedExePath?: string | null;
  hasSetupExe?: boolean;
  hasMainExe?: boolean;
}

export const GamesLibraryView: React.FC<GamesLibraryViewProps> = ({
  completedTasks,
  onDeleteGame
}) => {
  const [scannedGames, setScannedGames] = useState<LibraryGame[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(true);

  // Setup Guide Modal state
  const [setupGuideGame, setSetupGuideGame] = useState<LibraryGame | DownloadTask | null>(null);

  // Status message banner
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Deletion modals state
  const [gameToDelete, setGameToDelete] = useState<LibraryGame | DownloadTask | null>(null);
  const [installerGuideGame, setInstallerGuideGame] = useState<LibraryGame | DownloadTask | null>(null);
  
  const handleInstallerGuideContinue = () => {
    if (installerGuideGame) {
      handleInstallGame(installerGuideGame);
      setInstallerGuideGame(null);
    }
  };

  const [deletingTask, setDeletingTask] = useState<LibraryGame | DownloadTask | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<number>(0);
  const [deleteStatusText, setDeleteStatusText] = useState<string>('Preparing deletion...');

  // Fetch games from server local Games directory scan
  const fetchLibraryFromDisk = async () => {
    setIsLoadingLibrary(true);
    try {
      const res = await apiFetch('/api/library');
      if (res.ok) {
        const data = await res.json();
        setScannedGames(data.games || []);
      }
    } catch (e) {
      console.error('Failed to fetch library from disk:', e);
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  useEffect(() => {
    fetchLibraryFromDisk();
  }, [completedTasks.length]);

  // Combine props completed tasks + server scanned games (remove duplicates by ID)
  const allLibraryGames = React.useMemo(() => {
    const map = new Map<string, LibraryGame | DownloadTask>();
    
    // Add scanned games from disk scan first
    for (const g of scannedGames) {
      map.set(g.id, g);
    }

    // Overlay or add completed tasks
    for (const task of completedTasks) {
      if (!map.has(task.id)) {
        map.set(task.id, {
          id: task.id,
          title: task.title,
          cover: task.cover,
          repacker: task.repacker,
          totalSizeBytes: task.totalSizeBytes,
          installPath: task.installDirectory || `C:\\Users\\User\\AppData\\Roaming\\MN Game Downloader\\Games\\${task.title.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          isInstalled: task.isInstalled
        });
      }
    }

    return Array.from(map.values());
  }, [scannedGames, completedTasks]);

  // Handler to open game folder directly
  const handleOpenFolder = async (game: LibraryGame | DownloadTask) => {
    try {
      const res = await apiFetch(`/api/games/${game.id}/open-folder`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.status === 'opened') {
        setStatusBanner(`Opened folder: ${data.folder}`);
      } else {
        const folderPath = 'installPath' in game ? game.installPath : game.installDirectory;
        setStatusBanner(`Folder path: ${folderPath || 'Games Directory'}`);
      }
    } catch (e) {
      setStatusBanner(`Failed to open folder directly. Check AppData folder.`);
    }

    setTimeout(() => {
      setStatusBanner(null);
    }, 4000);
  };

  const handleInstallGame = async (game: LibraryGame | DownloadTask) => {
    try {
      const res = await apiFetch(`/api/games/${game.id}/install`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'launched') {
           setStatusBanner(`Launched Installer (setup.exe) for ${game.title}`);
        } else {
           setStatusBanner(`Opened game directory for setup installer.`);
        }
      } else {
        setStatusBanner(`Failed to launch installer.`);
      }
    } catch (e) {
      setStatusBanner(`Error communicating with backend installer engine.`);
    }
    setTimeout(() => setStatusBanner(null), 4000);
    setTimeout(fetchLibraryFromDisk, 2000);
  };

  // Handler to confirm deletion
  const handleConfirmDelete = async () => {
    if (!gameToDelete) return;
    const game = gameToDelete;
    setGameToDelete(null);
    setDeletingTask(game);
    setDeleteProgress(50);
    setDeleteStatusText('Deleting game files...');

    try {
      await apiFetch(`/api/games/${game.id}/delete`, { method: 'POST' });
      setDeleteProgress(100);
      setDeleteStatusText('Deletion completed!');
      setTimeout(() => {
        onDeleteGame(game.id);
        setDeletingTask(null);
        setDeleteProgress(0);
        fetchLibraryFromDisk();
      }, 300);
    } catch (e) {
      setDeleteStatusText('Failed to delete game.');
      setTimeout(() => {
        setDeletingTask(null);
      }, 2000);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 GB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] text-slate-900 overflow-hidden">
      {/* Library Header */}
      <div className="px-6 py-8 sm:px-10 bg-gradient-to-b from-white to-[#f8fafc] border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-600 font-bold tracking-widest text-xs uppercase">
            <LayoutGrid className="w-4 h-4" />
            Your Collection
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">
            Library
          </h2>
        </div>

        <button
          onClick={fetchLibraryFromDisk}
          disabled={isLoadingLibrary}
          className="self-start sm:self-auto px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 shadow-sm flex items-center gap-2 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isLoadingLibrary ? 'animate-spin' : ''}`} />
          <span>Rescan Games Folder</span>
        </button>
      </div>

      {/* Banner Message */}
      {statusBanner && (
        <div className="mx-6 sm:mx-10 mt-4 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl flex items-center gap-2.5 shadow-sm animate-in slide-in-from-top-2 shrink-0">
          <FolderOpen className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-mono font-bold">{statusBanner}</span>
        </div>
      )}

      {/* Main Library Cards Grid */}
      <div className="flex-1 overflow-y-auto p-6 sm:p-10">
        {isLoadingLibrary && allLibraryGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-20">
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
            <p className="text-sm font-bold text-slate-600">Scanning local games directory...</p>
          </div>
        ) : allLibraryGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 pb-20">
            <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mb-5 shadow-sm border border-slate-200/80">
              <HardDrive className="w-9 h-9 text-emerald-500/80" />
            </div>
            <h3 className="font-extrabold text-slate-800 text-2xl tracking-tight">Library is Empty</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mt-2 text-center leading-relaxed font-medium">
              Downloaded games automatically appear here with cover photos. Click Setup to view step-by-step installation instructions.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 sm:gap-8">
            {allLibraryGames.map((game) => (
              <div
                key={game.id}
                className="group relative bg-white rounded-[24px] overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 flex flex-col hover:-translate-y-1.5"
              >
                {/* Cover Image */}
                <div className="relative aspect-square bg-slate-900 overflow-hidden">
                  <img
                    src={(game.cover && game.cover.trim() !== '') ? game.cover : 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=600'}
                    alt={game.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    onError={(e) => {
                      // Fallback image if cover fails
                      (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=600';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/30 to-transparent opacity-90" />
                  
                  {/* Overlay Top Badges & Delete */}
                  <div className="absolute top-3.5 left-3.5 right-3.5 flex justify-between items-start z-10">
                    <span className="px-2.5 py-1 bg-black/50 backdrop-blur-md rounded-xl border border-white/10 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                      {game.repacker || 'FitGirl Repacks'}
                    </span>
                    <button
                      onClick={() => setGameToDelete(game)}
                      className="w-8 h-8 rounded-full bg-black/40 hover:bg-rose-600 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all shadow-sm cursor-pointer opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                      title="Uninstall / Delete Game"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Title & Size Info */}
                  <div className="absolute bottom-3.5 left-3.5 right-3.5 z-10">
                    <p className="text-emerald-400 font-mono font-bold text-[10px] mb-1 drop-shadow-sm flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {formatBytes(game.totalSizeBytes)} • READY
                    </p>
                    <h3 className="text-lg font-extrabold text-white leading-tight drop-shadow-md line-clamp-2">
                      {game.title}
                    </h3>
                  </div>
                </div>

                {/* Actions: Setup Button + Open Folder Button */}
                <div className="p-3.5 bg-white flex items-center gap-2.5">
                  <button
                    onClick={() => setInstallerGuideGame(game)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Open Folder & Install</span>
                  </button>
                  <button
                    onClick={() => setGameToDelete(game)}
                    className="w-11 h-11 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center border border-rose-200 transition-colors cursor-pointer shrink-0"
                    title="Delete Game"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      
      {/* Installer Guide Modal */}
      {installerGuideGame && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] max-w-lg w-full p-8 shadow-2xl relative overflow-hidden">
            <div className="flex items-center gap-4 mb-6 text-slate-800">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                <Wrench className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black">Game Installation Guide</h3>
                <p className="text-sm font-semibold text-slate-500">ක්රීඩාව ස්ථාපනය කිරීමේ උපදෙස්</p>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 1: Locate the setup.exe file inside the opened folder.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">විවෘත වන ෆෝල්ඩරය තුළ ඇති setup.exe ගොනුව සොයාගන්න.</div>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 2: Double-click on setup.exe to launch installation.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">setup.exe මත දෙවරක් ක්ලික් කර ස්ථාපනය ආරම්භ කරන්න.</div>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 3: If Windows asks for Administrator Permission (UAC), click Yes.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">Administrator අවසර ඉල්ලූ විට Yes ලබාදෙන්න.</div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setInstallerGuideGame(null)}
                className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInstallerGuideContinue}
                className="flex-[2] py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <FolderOpen className="w-5 h-5" />
                <span>Open Game Folder & Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Game Confirmation Warning Modal */}
      {gameToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-rose-200 rounded-[24px] max-w-md w-full p-8 space-y-6 shadow-2xl relative overflow-hidden">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-7 h-7 text-rose-600" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-xl tracking-tight">Delete Game?</h3>
                <p className="text-sm text-slate-500 font-medium mt-1">
                  This will permanently delete all downloaded files from disk.
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-sm">
              <div className="flex justify-between items-start gap-4 text-slate-700 font-bold">
                <span className="shrink-0">Title:</span>
                <span className="text-slate-900 font-black text-right line-clamp-2">{gameToDelete.title}</span>
              </div>
              <div className="flex justify-between items-center text-slate-700 font-bold pt-2 border-t border-slate-200/60">
                <span>Storage Size:</span>
                <span className="text-rose-600 font-mono font-bold bg-rose-50 px-2 py-0.5 rounded-md">{formatBytes(gameToDelete.totalSizeBytes)}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setGameToDelete(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3.5 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmDelete}
                className="flex-[1.5] bg-rose-600 hover:bg-rose-700 text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deletion Progress Modal */}
      {deletingTask && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-[24px] max-w-md w-full p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                {deleteProgress < 100 ? (
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                )}
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg tracking-tight">
                  {deleteProgress < 100 ? 'Deleting Game Files...' : 'Deleted successfully'}
                </h3>
                <p className="text-sm text-slate-500 font-bold truncate max-w-[260px]">
                  {deletingTask.title}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center font-mono font-bold">
                <span className="text-slate-500 text-xs truncate max-w-[280px]">{deleteStatusText}</span>
                <span className={deleteProgress === 100 ? 'text-emerald-600 font-black' : 'text-slate-700'}>
                  {deleteProgress}%
                </span>
              </div>

              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden border border-slate-200 p-0.5 shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-300 bg-emerald-500"
                  style={{ width: `${deleteProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
