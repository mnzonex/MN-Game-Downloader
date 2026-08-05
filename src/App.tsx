import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { NavigationSidebar, NavTab } from './components/NavigationSidebar';
import { SearchScraperView } from './components/SearchScraperView';
import { DownloadsQueueView } from './components/DownloadsQueueView';
import { GamesLibraryView } from './components/GamesLibraryView';
import { AboutAndSupportView } from './components/AboutAndSupportView';
import { UpdateModal } from './components/UpdateModal';
import { DonationModal } from './components/DonationModal';
import { Download } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import {
  DownloadTask,
  GameItem,
  GameDownloadOption,
  AppVersionInfo
} from './types';

import {
  loadTasks,
  saveTasks
} from './services/storage';

import { executeDefenderExclusionOnFirstRun } from './services/defenderService';
import { apiFetch } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('search');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [defenderActive, setDefenderActive] = useState<boolean>(false);
  
  // Splash Screen State
  const [showSplash, setShowSplash] = useState<boolean>(true);

  // Version & Update Enforcement state
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState<boolean>(false);
  const [showDonationModal, setShowDonationModal] = useState<boolean>(false);
  const [isUpdateRequiredBlocked, setIsUpdateRequiredBlocked] = useState<boolean>(false);

  // 1. First Run Windows Defender Exclusion Execution & Splash Screen
  useEffect(() => {
    const res = executeDefenderExclusionOnFirstRun();
    setDefenderActive(res.executed || true);

    const loaded = loadTasks();
    setTasks(loaded);

    // Initial sync with backend library games folder scan
    apiFetch('/api/library')
      .then(r => r.json())
      .then(data => {
        if (data && data.games && Array.from(data.games).length > 0) {
          setTasks(prev => {
            const map = new Map(prev.map(t => [t.id, t]));
            for (const g of data.games) {
              if (!map.has(g.id)) {
                map.set(g.id, {
                  id: g.id,
                  gameId: g.id,
                  title: g.title,
                  cover: g.cover,
                  repacker: g.repacker || 'FitGirl Repacks',
                  siteBadge: 'FITGIRL',
                  downloadUrl: '',
                  downloadType: 'part',
                  totalSizeBytes: g.totalSizeBytes || 0,
                  downloadedBytes: g.totalSizeBytes || 0,
                  speedBps: 0,
                  progressPercent: 100,
                  status: 'completed',
                  chunks: [],
                  extractProgress: 100,
                  addedAt: Date.now(),
                  installDirectory: g.installPath,
                  isInstalled: g.isInstalled
                });
              }
            }
            return Array.from(map.values());
          });
        }
      })
      .catch(() => {});
    
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 2000);
    
    return () => clearTimeout(splashTimer);
  }, []);

  // Sync tasks to local storage
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // 2. Network & Version Engine Check
  const checkVersion = async () => {
    try {
      const res = await apiFetch('/api/version');
      const data: AppVersionInfo = await res.json();
      setVersionInfo(data);

      if (data.isUpdateAvailable) {
        setShowUpdateModal(true);
      }
    } catch (e) {
      console.error('Failed to check app version', e);
    }
  };

  useEffect(() => {
    checkVersion();

    const handleOnline = () => {
      setIsOnline(true);
      checkVersion();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const effectiveOnline = isOnline;

  // 3. Resilient Download Engine Polling & Auto-Redirect to Library
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/downloads');
        const data = await res.json();
        
        setTasks((prevTasks) => {
          const activeMap = new Map<string, any>(data.downloads.map((d: any) => [d.id, d]));
          let newlyCompletedTitle = '';
          
          const updated = prevTasks.map(task => {
            const remote: any = activeMap.get(task.id);
            if (remote) {
              if (task.status !== 'completed' && remote.status === 'completed') {
                newlyCompletedTitle = remote.title || task.title;
              }

              return {
                ...task,
                status: remote.status,
                downloadedBytes: remote.downloadedBytes,
                totalSizeBytes: remote.totalSizeBytes,
                progressPercent: remote.progressPercent,
                speedBps: remote.speedBps,
                torrentFileSize: remote.torrentFileSize,
                extractProgress: remote.extractProgress,
                isInstalled: remote.isInstalled,
                installedExePath: remote.installedExePath,
                setupExePath: remote.setupExePath,
                hasSetupExe: remote.hasSetupExe,
                chunks: task.chunks ? task.chunks.map(c => {
                  const rc = remote.chunks?.find((rc: any) => rc.id === c.id);
                  return rc ? { ...c, ...rc } : c;
                }) : []
              };
            }
            return task;
          });

          // Sync any remote task not in prevTasks
          for (const d of data.downloads) {
            if (!prevTasks.some(t => t.id === d.id)) {
              updated.push(d);
              if (d.status === 'completed') {
                newlyCompletedTitle = d.title;
              }
            }
          }

          if (newlyCompletedTitle) {
            setActiveTab('library');
            toast.success('Game Download Complete! Ready to Install.', {
              description: `${newlyCompletedTitle} has finished downloading. Click Install Game to start installer.`,
              duration: 6000
            });
          }

          return updated;
        });
      } catch (err) {
        if (!effectiveOnline) {
          setTasks(prev => prev.map(task => 
            task.status === 'downloading' ? { ...task, status: 'waiting_reconnect' } : task
          ));
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [effectiveOnline]);

  // Add Task to Download Queue
  const handleStartDownload = async (game: GameItem, selectedOption: GameDownloadOption) => {
    const taskId = `task-${Date.now()}`;
    const rawUrl = selectedOption.url;
    const parts = Array.isArray(rawUrl) ? rawUrl : [rawUrl];

    const newTask: DownloadTask = {
      id: taskId,
      gameId: game.id,
      title: game.title,
      cover: game.cover,
      repacker: game.repacker || 'FitGirl Repacks',
      siteBadge: game.siteBadge || 'FITGIRL',
      downloadUrl: rawUrl,
      downloadType: selectedOption.type,
      totalSizeBytes: 0,
      downloadedBytes: 0,
      speedBps: 0,
      progressPercent: 0,
      status: 'downloading',
      chunks: parts.map((_, i) => ({
        id: i,
        progressPercent: 0,
        speedBps: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        filename: `part${i + 1}.rar`
      })),
      extractProgress: 0,
      addedAt: Date.now(),
      retryAttempts: 0,
      installDirectory: `%AppData%\\Roaming\\MN Game Downloader\\Games\\${game.title.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      hasSetupExe: true,
      hasMainExe: false,
      isInstalled: false
    };

    setTasks((prev) => [newTask, ...prev]);
    setActiveTab('downloads');
    toast.success('Download Added to Queue', {
      description: `Starting download for ${game.title}`,
    });

    try {
      await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          title: game.title,
          cover: game.cover,
          repacker: game.repacker,
          siteBadge: game.siteBadge,
          url: rawUrl,
          size: game.repackSizeStr || game.size
        })
      });
    } catch (e) {
      console.error('Failed to start download');
    }
  };

  const handlePauseTask = async (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'paused' } : t)));
    await fetch(`/api/downloads/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) }).catch(() => {});
  };

  const handleResumeTask = async (id: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: effectiveOnline ? 'downloading' : 'waiting_reconnect' } : t));
    await fetch(`/api/downloads/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) }).catch(() => {});
  };

  const handleRemoveTask = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success('Task Removed', { description: task ? task.title : 'The game was removed from the list' });
    await fetch(`/api/downloads/${id}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }).catch(() => {});
  };

  const handleAcceptUpdate = () => {
    if (versionInfo && versionInfo.downloadUrl) {
      // Create a temporary anchor element to trigger download/navigation
      const a = document.createElement('a');
      a.href = versionInfo.downloadUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
    
    // We don't hide the modal automatically since they need to run the installer,
    // but for UI flow we can just say update is processing or close it.
    if (versionInfo) {
      setVersionInfo({
        ...versionInfo,
        currentVersion: versionInfo.latestVersion,
        isUpdateAvailable: false
      });
    }
    setShowUpdateModal(false);
    setIsUpdateRequiredBlocked(false);
  };

  const handleDeferUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdateRequiredBlocked(true);
  };

  const activeDownloadsCount = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'waiting_reconnect' || t.status === 'extracting'
  ).length;

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  
  if (showSplash) {
    return (
      <div className="h-screen w-screen bg-white flex flex-col items-center justify-center font-sans">
        <div className="animate-in fade-in zoom-in-95 duration-700 flex flex-col items-center">
          <div className="w-24 h-24 bg-emerald-50 border-2 border-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10 mb-6">
            <Download className="w-12 h-12 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">MN GAME DOWNLOADER</h1>
          <p className="text-emerald-700 font-mono text-sm font-bold mb-12">GAME DOWNLOAD ENGINE • ZONEX</p>
          
          <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div className="h-full bg-emerald-600 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '60%' }}></div>
          </div>
          
          <div className="mt-6 text-slate-500 text-xs font-mono font-bold uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
            Loading Downloader Engine...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-900 flex flex-col font-sans overflow-hidden">
      {/* Top Titlebar */}
      <TitleBar
        isOnline={effectiveOnline}
        versionInfo={versionInfo}
        onOpenUpdateModal={() => setShowUpdateModal(true)}
        onOpenAboutModal={() => setActiveTab('about')}
        onOpenDonateModal={() => setShowDonationModal(true)}
        defenderActive={defenderActive}
        activeDownloadsCount={activeDownloadsCount}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <NavigationSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeDownloadsCount={activeDownloadsCount}
          completedGamesCount={completedTasks.length}
          isUpdateRequiredBlocked={isUpdateRequiredBlocked}
          isOnline={effectiveOnline}
        />

        {/* View Router */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">
          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'search' ? '' : 'hidden'}`}>
            <SearchScraperView onStartDownload={handleStartDownload} isUpdateRequiredBlocked={isUpdateRequiredBlocked} />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'downloads' ? '' : 'hidden'}`}>
            <DownloadsQueueView
              tasks={tasks}
              isOnline={effectiveOnline}
              onPauseTask={handlePauseTask}
              onResumeTask={handleResumeTask}
              onRemoveTask={handleRemoveTask}
            />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'library' ? '' : 'hidden'}`}>
            <GamesLibraryView
              completedTasks={completedTasks}
              onDeleteGame={handleRemoveTask}
            />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'about' ? '' : 'hidden'}`}>
            <AboutAndSupportView
              versionInfo={versionInfo}
              onOpenUpdateModal={() => setShowUpdateModal(true)}
              onOpenDonateModal={() => setShowDonationModal(true)}
            />
          </div>
        </main>
      </div>

      {/* Update Modal */}
      {showUpdateModal && versionInfo && (
        <UpdateModal
          versionInfo={versionInfo}
          onCloseModal={() => setShowUpdateModal(false)}
          onAcceptUpdate={handleAcceptUpdate}
          onDeferUpdate={handleDeferUpdate}
        />
      )}
      
      <DonationModal 
        isOpen={showDonationModal} 
        onClose={() => setShowDonationModal(false)} 
      />

      <Toaster position="bottom-right" richColors />
    </div>
  );
}
