import React, { useState, useEffect, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { NavigationSidebar, NavTab } from './components/NavigationSidebar';
import { SearchScraperView } from './components/SearchScraperView';
import { AboutAndSupportView } from './components/AboutAndSupportView';
import { SettingsView } from './components/SettingsView';
import { DonationModal } from './components/DonationModal';
import { Download } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import { AppVersionInfo } from './types';
import { apiFetch } from './services/api';
import { listTorrents, getSettings } from './services/downloadApi';
import { DownloadsView } from './components/DownloadsView';
import { DefenderGuideModal } from './components/DefenderGuideModal';
import { RateAppModal } from './components/RateAppModal';

const APP_VERSION = '1.2.5';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('search');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  
  // Theme state — default Light. Persisted in localStorage.
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('mn_theme') === 'dark'; } catch { return false; }
  });

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    try { localStorage.setItem('mn_theme', isDarkMode ? 'dark' : 'light'); } catch {}
  }, [isDarkMode]);
  
  // Splash Screen State
  const [showSplash, setShowSplash] = useState<boolean>(true);

  // Version & Update Enforcement state
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [showDonationModal, setShowDonationModal] = useState<boolean>(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [isUpdateRequiredBlocked, setIsUpdateRequiredBlocked] = useState<boolean>(false);

  // Active Download Count (for badge)
  const [activeDownloadCount, setActiveDownloadCount] = useState(0);

  useEffect(() => {
    const pollCount = async () => {
      try {
        const torrents = await listTorrents();
        const active = torrents.filter(t => (t.status === 'downloading' || t.status === 'scheduled' || t.status === 'queued') && !t.hidden).length;
        setActiveDownloadCount(active);
      } catch {
        // ignore
      }
    };
    pollCount();
    const interval = setInterval(pollCount, 2000);
    return () => clearInterval(interval);
  }, []);

  // Background auto-updater state
  const [bgUpdateState, setBgUpdateState] = useState<'idle'|'checking'|'downloading'|'downloaded'|'error'>('idle');
  const bgUpdateStateRef = useRef(bgUpdateState);
  useEffect(() => { bgUpdateStateRef.current = bgUpdateState; }, [bgUpdateState]);

  const [bgUpdateProgress, setBgUpdateProgress] = useState<number>(0);
  const [bgUpdateVersion, setBgUpdateVersion] = useState<string>('');
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);

  // Windows Defender Exclusion Onboarding Guide state
  const [showDefenderGuide, setShowDefenderGuide] = useState<boolean>(false);
  const [highlightExclusion, setHighlightExclusion] = useState<boolean>(false);

  const handleSuccessfulCompletion = (kind: 'download' | 'repair') => {
    const key = `mn_rate_prompt_${APP_VERSION}_${kind}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, 'shown');
    } catch {}
    setShowRateModal(true);
  };

  useEffect(() => {
    // Check if Defender exclusion is already configured
    const checkDefenderStatus = async () => {
      try {
        const s = await getSettings();
        if (s && s.defender_excluded !== '1') {
          // Exclusion NOT allowed/granted yet -> show visual guide
          setShowDefenderGuide(true);
        }
      } catch {}
    };

    const timer = setTimeout(checkDefenderStatus, 2400); // Trigger after splash screen
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 2000);
    return () => clearTimeout(splashTimer);
  }, []);

  const checkVersion = async () => {
    try {
      const res = await apiFetch('/api/version');
      const data: AppVersionInfo = await res.json();
      setVersionInfo(data);
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

  // Background auto-updater polling
  useEffect(() => {
    let toastShown = false;
    const poll = async () => {
      try {
        const res = await apiFetch('/api/update/status');
        const s = await res.json();
        setBgUpdateState(s.state);
        if (s.state === 'downloading') {
          setBgUpdateProgress(Math.round(s.progress || 0));
          if (!toastShown) {
            toastShown = true;
            toast.info('Update Downloading...', { description: 'A new version is downloading in the background.', duration: 4000 });
          }
        }
        if (s.state === 'downloaded') {
          setBgUpdateVersion(s.versionInfo?.version || '');
        }
      } catch (_) {}
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRestartAndInstall = async () => {
    setIsInstallingUpdate(true);
    try {
      await apiFetch('/api/update/install', { method: 'POST' });
    } catch (_) {}
  };
  
  if (showSplash) {
    return (
      <div className="h-screen w-screen bg-white flex flex-col items-center justify-center font-sans">
        <div className="animate-in fade-in zoom-in-95 duration-700 flex flex-col items-center">
          <div className="w-24 h-24 bg-emerald-50 border-2 border-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10 mb-6">
            <Download className="w-12 h-12 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">MN GAME DOWNLOADER</h1>
          <p className="text-emerald-700 font-mono text-sm font-bold mb-12">GAME AGGREGATOR • ZONEX</p>
          
          <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div className="h-full bg-emerald-600 rounded-full animate-[progress_2s_ease-in-out_infinite]" style={{ width: '60%' }}></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-900 flex flex-col font-sans overflow-hidden">
      {/* Background Update Banner */}
      {bgUpdateState === 'downloading' && (
        <div style={{ background: '#0f4c2a', color: '#d1fae5', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399', display: 'inline-block', animation: 'pulse 1s infinite' }} />
          Downloading update in background... {bgUpdateProgress}%
          <div style={{ flex: 1, height: 4, background: '#065f46', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${bgUpdateProgress}%`, height: '100%', background: '#34d399', transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}
      {bgUpdateState === 'downloaded' && (
        <div style={{ background: '#065f46', color: '#d1fae5', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600, justifyContent: 'space-between' }}>
          <span>Update v{bgUpdateVersion} is ready. It will install silently when you close the app. Your download data is retained.</span>
        </div>
      )}

      {/* Top Titlebar */}
      <TitleBar
        isOnline={isOnline}
        versionInfo={versionInfo}
        onOpenAboutModal={() => setActiveTab('about')}
        onOpenDonateModal={() => setShowDonationModal(true)}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <NavigationSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          versionInfo={versionInfo}
          activeDownloadCount={activeDownloadCount}
        />

        {/* View Router */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">
          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'search' ? '' : 'hidden'}`}>
            <SearchScraperView onSwitchToDownloads={() => setActiveTab('downloads')} />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'downloads' ? '' : 'hidden'}`}>
            <DownloadsView onSuccessfulCompletion={handleSuccessfulCompletion} />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'about' ? '' : 'hidden'}`}>
            <AboutAndSupportView
              versionInfo={versionInfo}
              onOpenDonateModal={() => setShowDonationModal(true)}
              bgUpdateState={bgUpdateState}
              bgUpdateProgress={bgUpdateProgress}
              bgUpdateVersion={bgUpdateVersion}
              onRestartAndInstall={handleRestartAndInstall}
              isInstallingUpdate={isInstallingUpdate}
            />
          </div>

          <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'settings' ? '' : 'hidden'}`}>
            <SettingsView
              isDarkMode={isDarkMode}
              onToggleDark={setIsDarkMode}
              highlightExclusion={highlightExclusion}
            />
          </div>
        </main>
      </div>

      <DefenderGuideModal
        isOpen={showDefenderGuide}
        onClose={() => setShowDefenderGuide(false)}
        onGoToSettings={() => {
          setShowDefenderGuide(false);
          setActiveTab('settings');
          setHighlightExclusion(true);
        }}
        onExclusionApplied={() => {
          setShowDefenderGuide(false);
          setHighlightExclusion(false);
        }}
      />

      <DonationModal 
        isOpen={showDonationModal} 
        onClose={() => setShowDonationModal(false)} 
      />

      {showRateModal && <RateAppModal isDarkMode={isDarkMode} onClose={() => setShowRateModal(false)} />}

      <Toaster position="bottom-right" richColors />
    </div>
  );
}