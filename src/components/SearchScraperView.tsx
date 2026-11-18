import { RepairModal } from './RepairModal';
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';
import { toast } from 'sonner';
import {
  Clock, Search, Loader2, Copy, ExternalLink, AlertCircle,
  HardDrive, Info, ArrowLeft, Image as ImageIcon, Sparkles,
  X, Gamepad2, RotateCcw, CheckCheck, Link2, Users, Download
} from 'lucide-react';
import { GameItem, GameDownloadOption } from '../types';

interface LoadedDetails {
  downloads: GameDownloadOption[];
  partsCount: number;
  description?: string;
  repackSizeStr?: string;
  originalSizeStr?: string;
  cover?: string;
  screenshots?: string[];
}

type SourceId = 'fitgirl' | 'erolabs';

interface SourceFeed {
  games: GameItem[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  error: string | null;
}

const emptyFeed = (): SourceFeed => ({
  games: [], page: 1, hasMore: true, loading: false, loadingMore: false, loaded: false, error: null,
});

const isSourceUnavailable = (message: string) => /\b(502|503|504)\b|bad gateway|upstream|could not reach|network error|timed?\s*out/i.test(message);

// Strong multiplayer keywords — must appear explicitly in game description/title
const MULTIPLAYER_KEYWORDS = [
  'multiplayer',
  'co-op',
  'coop',
  'pvp',
  'split-screen',
  'splitscreen',
  'cooperative',
  'cross-play',
  'crossplay',
];

// Only return true when the keyword appears in the detailed description OR the game TITLE explicitly
const isMultiplayer = (game: GameItem, details?: LoadedDetails | null) => {
  const titleStr = (game.title || '').toLowerCase();
  
  // 1. Check title immediately (works on main screen before details load)
  const inTitle = MULTIPLAYER_KEYWORDS.some(kw => titleStr.includes(kw));
  if (inTitle) return true;

  // 2. If details are loaded, check description
  if (details) {
    const detailDesc = (details.description || '').toLowerCase();
    return MULTIPLAYER_KEYWORDS.some(kw => detailDesc.includes(kw));
  }

  return false;
};

import { addTorrent, scheduleTorrent, formatSize } from '../services/downloadApi';
import { ScheduleDownloadModal } from './ScheduleDownloadModal';
import { PreDownloadInspectModal } from './PreDownloadInspectModal';

export const SearchScraperView: React.FC<{
  onSwitchToDownloads?: () => void;
}> = ({ onSwitchToDownloads }) => {
  const [exactSizes, setExactSizes] = useState<Record<string, number>>({});
  const [repairing, setRepairing] = useState(false);
  const [repairSelection, setRepairSelection] = useState<{ magnet: string; folder: string; title: string; cover?: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState<Record<string, LoadedDetails>>({});
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState<number | null>(null);
  const [pendingInspectOption, setPendingInspectOption] = useState<{
    opt: GameDownloadOption;
    idx: number;
  } | null>(null);
  const [pendingDownloadOption, setPendingDownloadOption] = useState<{
    opt: GameDownloadOption;
    idx: number;
  } | null>(null);

  // Source selector: 'fitgirl' | 'erolabs'
  const [source, setSource] = useState<SourceId>('fitgirl');
  const sourceRef = React.useRef<SourceId>('fitgirl');
  sourceRef.current = source;
  const requestIdRef = React.useRef<Record<SourceId, number>>({ fitgirl: 0, erolabs: 0 });
  const controllersRef = React.useRef<Record<SourceId, AbortController | null>>({ fitgirl: null, erolabs: null });
  const [feeds, setFeeds] = useState<Record<SourceId, SourceFeed>>({
    fitgirl: emptyFeed(),
    erolabs: emptyFeed(),
  });
  const { games, loading, loadingMore, page, hasMore, error } = feeds[source];
  const sourceLabel = source === 'erolabs' ? 'EroLabs' : 'FitGirl Repacks';

  useEffect(() => { void fetchFeed('', 1, false, 'fitgirl'); }, []);

  const handleSwitchSource = (newSource: SourceId) => {
    if (newSource === source) return;
    setSource(newSource);
    setSearchQuery('');
    setSelectedGame(null);
    const feed = feeds[newSource];
    if (!feed.loaded && !feed.loading) void fetchFeed('', 1, false, newSource);
  };

  // Auto-fetch cover images for visible FitGirl cards
  useEffect(() => {
    if (games.length === 0) return;
    const withoutCover = games.filter(g => !g.cover && !detailsLoaded[g.id]);
    if (withoutCover.length === 0) return;

    withoutCover.slice(0, 10).forEach(async (game) => {
      try {
        if (game.siteBadge === 'EROLABS' || game.id.startsWith('ero-')) return;

        const res = await apiFetch(`/api/fitgirl/details?siteUrl=${encodeURIComponent(game.siteUrl)}`);

        if (res.ok) {
          const data = await res.json();
          if (data.cover) {
            setFeeds(prev => ({
              ...prev,
              [sourceRef.current]: {
                ...prev[sourceRef.current],
                games: prev[sourceRef.current].games.map(item => item.id === game.id && !item.cover ? { ...item, cover: data.cover } : item),
              },
            }));
            setDetailsLoaded(prev => ({
              ...prev,
              [game.id]: {
                downloads: data.downloads || [],
                partsCount: data.partsCount || 0,
                description: data.description,
                repackSizeStr: data.repackSizeStr,
                originalSizeStr: data.originalSizeStr,
                cover: data.cover,
                screenshots: data.screenshots || [],
              }
            }));
          }
        }
      } catch {
        // ignore background fetch errors
      }
    });
  }, [games]);

  const fetchFeed = async (query: string, pageNum: number = 1, append: boolean = false, src?: SourceId) => {
    const activeSource = src ?? source;
    if (pageNum === 1) controllersRef.current[activeSource]?.abort();
    const controller = new AbortController();
    controllersRef.current[activeSource] = controller;
    const reqId = ++requestIdRef.current[activeSource];

    setFeeds(prev => ({
      ...prev,
      [activeSource]: {
        ...prev[activeSource],
        page: pageNum === 1 ? 1 : prev[activeSource].page,
        hasMore: pageNum === 1 ? true : prev[activeSource].hasMore,
        loading: pageNum === 1,
        loadingMore: pageNum > 1,
        error: null,
      },
    }));

    try {
      let endpoint: string;
      if (activeSource === 'erolabs') {
        endpoint = query.trim()
          ? `/api/erolabs/search?q=${encodeURIComponent(query.trim())}&page=${pageNum}`
          : `/api/erolabs/popular?page=${pageNum}`;
      } else {
        endpoint = query.trim()
          ? `/api/fitgirl/search?q=${encodeURIComponent(query.trim())}&page=${pageNum}`
          : `/api/fitgirl/popular?page=${pageNum}`;
      }

      const timeout = AbortSignal.timeout(20000);
      const res = await apiFetch(endpoint, { signal: AbortSignal.any([controller.signal, timeout]) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load ${activeSource === 'fitgirl' ? 'FitGirl' : 'EroLabs'} games (${res.status})`);
      const expectedBadge = activeSource === 'fitgirl' ? 'FITGIRL' : 'EROLABS';
      const responseGames = Array.isArray(data.games) ? data.games as GameItem[] : [];
      const newGames = responseGames.filter(game => game.siteBadge === expectedBadge);
      if (responseGames.length > 0 && newGames.length !== responseGames.length) {
        throw new Error('This source returned games from another catalog. Please retry.');
      }
      if (reqId !== requestIdRef.current[activeSource]) return;
      setFeeds(prev => {
        const current = prev[activeSource];
        const existingUrls = new Set(current.games.map(game => game.siteUrl));
        const additions = newGames.filter(game => !existingUrls.has(game.siteUrl));
        const nextGames = append ? [...current.games, ...additions] : newGames;
        return {
          ...prev,
          [activeSource]: {
            ...current,
            games: nextGames,
            page: pageNum,
            hasMore: newGames.length > 0 && (!append || additions.length > 0),
            loading: false,
            loadingMore: false,
            loaded: true,
            error: null,
          },
        };
      });
    } catch (err: any) {
      if (reqId !== requestIdRef.current[activeSource] || controller.signal.aborted) return;
      setFeeds(prev => ({
        ...prev,
        [activeSource]: {
          ...prev[activeSource], loading: false, loadingMore: false, loaded: true,
          error: err.message || 'Failed to fetch games',
        },
      }));
    } finally {
      if (controllersRef.current[activeSource] === controller) controllersRef.current[activeSource] = null;
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFeed(searchQuery, 1, false, source);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 350 && hasMore && !loadingMore && !loading) {
      const next = page + 1;
      fetchFeed(searchQuery, next, true, source);
    }
  };

  const handleOpenGameDetails = async (game: GameItem) => {
    setSelectedGame(game);
    if (detailsLoaded[game.id]) return;

    setFetchingDetails(true);
    try {
      const isErolabs = game.siteBadge === 'EROLABS' || game.id.startsWith('ero-');
      const detailEndpoint = isErolabs
        ? `/api/erolabs/details?siteUrl=${encodeURIComponent(game.siteUrl)}`
        : `/api/fitgirl/details?siteUrl=${encodeURIComponent(game.siteUrl)}`;

      const res = await apiFetch(detailEndpoint);
      if (res.ok) {
        const data = await res.json();
        // Do NOT overwrite existing clean cover images!
        if (data.cover && !game.cover) {
          const gameSource: SourceId = (game.siteBadge === 'EROLABS' || game.id.startsWith('ero-')) ? 'erolabs' : 'fitgirl';
          setFeeds(prev => ({
            ...prev,
            [gameSource]: {
              ...prev[gameSource],
              games: prev[gameSource].games.map(item => item.id === game.id && !item.cover ? { ...item, cover: data.cover } : item),
            },
          }));
        }
        setDetailsLoaded(prev => ({
          ...prev,
          [game.id]: {
            downloads: data.downloads || [],
            partsCount: data.partsCount || 0,
            description: data.description,
            repackSizeStr: data.repackSizeStr,
            originalSizeStr: data.originalSizeStr,
            cover: game.cover || data.cover || '',
            screenshots: data.screenshots || [],
          }
        }));
      }
    } catch (err) {
      console.error('Failed to fetch details:', err);
      toast.error('Failed to load game details. Please try again.');
    } finally {
      setFetchingDetails(false);
    }
  };

  const handleRepair = async (opt: GameDownloadOption) => {
    const magnet = Array.isArray(opt.url) ? opt.url[0] : opt.url;
    const picker = (window as any).electron?.showOpenDialog;
    if (!picker) { toast.error('Open the desktop app to select a repair folder.'); return; }
    setRepairing(true);
    try {
      const folder = await picker('Select game folder');
      if (!folder) return;
      setRepairSelection({ magnet, folder, title: selectedGame?.title || 'Game', cover: selectedGame?.cover || currentDetails?.cover });
    } catch (e: any) { toast.error(e.message || 'Repair failed'); }
    finally { setRepairing(false); }
  };

  const handleOpenDownloadModal = (opt: GameDownloadOption, idx: number) => {
    const rawUrl = Array.isArray(opt.url) ? opt.url[0] : opt.url;
    if (!rawUrl) {
      toast.error('No download link available for this option.');
      return;
    }
    // FitGirl uses magnet links → show pre-download inspect modal (seeder check + file list)
    // EroLabs uses HTTP direct links → skip inspect, go straight to schedule modal
    const isErolabs = selectedGame?.siteBadge === 'EROLABS' || source === 'erolabs';
    if (!isErolabs && rawUrl.startsWith('magnet:')) {
      setPendingInspectOption({ opt, idx });
    } else {
      setPendingDownloadOption({ opt, idx });
    }
  };

  // Called when user clicks "Download Now" inside the PreDownloadInspectModal
  const handleInspectProceedNow = async () => {
    if (!pendingInspectOption || !selectedGame) return;
    const { opt, idx } = pendingInspectOption;
    const rawUrl = Array.isArray(opt.url) ? opt.url[0] : opt.url;
    if (!rawUrl) return;
    setPendingInspectOption(null);
    setIsAdding(idx);
    try {
      await addTorrent(rawUrl, selectedGame.title, selectedGame.cover || currentDetails?.cover);
      toast.success('Download started! 🚀');
      if (onSwitchToDownloads) {
        onSwitchToDownloads();
      }
    } finally {
      setIsAdding(null);
    }
  };

  // Called when user clicks "Schedule" inside the PreDownloadInspectModal
  const handleInspectProceedToSchedule = () => {
    if (!pendingInspectOption) return;
    const forwarded = pendingInspectOption;
    setPendingInspectOption(null);
    setPendingDownloadOption(forwarded);
  };

  const handleConfirmDownloadNow = async () => {
    if (!pendingDownloadOption || !selectedGame) return;
    const { opt, idx } = pendingDownloadOption;
    const rawUrl = Array.isArray(opt.url) ? opt.url[0] : opt.url;
    if (!rawUrl) throw new Error('No download link available');

    setIsAdding(idx);
    try {
      await addTorrent(rawUrl, selectedGame.title, selectedGame.cover || currentDetails?.cover);
      toast.success('Download started! 🚀');
      if (onSwitchToDownloads) {
        onSwitchToDownloads();
      }
    } finally {
      setIsAdding(null);
    }
  };

  const handleConfirmSchedule = async (scheduledAtMs: number) => {
    if (!pendingDownloadOption || !selectedGame) return;
    const { opt, idx } = pendingDownloadOption;
    const rawUrl = Array.isArray(opt.url) ? opt.url[0] : opt.url;
    if (!rawUrl) throw new Error('No download link available');

    setIsAdding(idx);
    try {
      await scheduleTorrent(rawUrl, selectedGame.title, scheduledAtMs, selectedGame.cover || currentDetails?.cover);
      const timeStr = new Date(scheduledAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      const dateStr = new Date(scheduledAtMs).toLocaleDateString([], { month: 'short', day: 'numeric' });
      toast.success(`Download scheduled for ${dateStr} at ${timeStr}! ⏰`, {
        description: `Added "${selectedGame.title}" to Downloads in Scheduled status.`,
      });
      if (onSwitchToDownloads) {
        onSwitchToDownloads();
      }
    } finally {
      setIsAdding(null);
    }
  };

  const currentDetails = selectedGame ? detailsLoaded[selectedGame.id] : null;

  // ─── GAME DETAIL PAGE ────────────────────────────────────────────────────────
  if (selectedGame) {
    const displayCover = selectedGame.cover || currentDetails?.cover || '';
    const displayRepackSize = exactSizes[selectedGame.id] ? formatSize(exactSizes[selectedGame.id]) : currentDetails?.repackSizeStr || selectedGame.repackSizeStr || selectedGame.size;
    const displayOriginalSize = currentDetails?.originalSizeStr || selectedGame.originalSizeStr;
    const screenshots = currentDetails?.screenshots || selectedGame.screenshots || [];

    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-y-auto">
        {/* Sticky Header */}
        <div className="p-4 px-6 border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between shadow-xs">
          <button
            onClick={() => setSelectedGame(null)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs border border-slate-200"
          >
            <ArrowLeft className={`w-4 h-4 ${selectedGame.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-600'}`} />
            <span>Back to Store Feed</span>
          </button>
          <span className={`text-xs border px-3.5 py-1 rounded-full font-bold ${
            selectedGame.siteBadge === 'EROLABS'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}>
            {selectedGame.siteBadge === 'EROLABS' ? 'EroLabs Game' : 'FitGirl Repack'}
          </span>
        </div>

        {/* Page Body */}
        <div className="max-w-6xl mx-auto w-full p-6 space-y-8">

          {/* Hero Card */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 flex flex-col md:flex-row gap-8 items-start shadow-md">
            {/* Cover */}
            <div className="w-full md:w-64 h-80 bg-slate-100 rounded-2xl p-2 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
              {displayCover ? (
                <img
                  src={displayCover}
                  alt={selectedGame.title}
                  className="max-h-full max-w-full object-contain rounded-xl shadow-md"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center">
                  <Gamepad2 className="w-12 h-12 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-600">Lossless Game Repack</span>
                </div>
              )}
            </div>

            {/* Meta + Actions */}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${selectedGame.siteBadge === 'EROLABS' ? 'bg-rose-600' : 'bg-emerald-600'} text-white text-[11px] font-black px-3 py-0.5 rounded-md uppercase tracking-wider shadow-xs`}>
                    {selectedGame.siteBadge || 'FITGIRL'}
                  </span>
                  {displayRepackSize && displayRepackSize !== 'Free' && displayRepackSize !== 'Windows Game' && (
                    <span className="text-xs bg-slate-100 text-slate-800 px-3 py-1 rounded-lg font-mono font-bold border border-slate-200">
                      {exactSizes[selectedGame.id] ? 'Download: ' : 'Site estimate: '}<strong className={selectedGame.siteBadge === 'EROLABS' ? 'text-rose-700' : 'text-emerald-700'}>{displayRepackSize}</strong>
                    </span>
                  )}
                  {displayOriginalSize && (
                    <span className="text-xs bg-slate-100/80 text-slate-500 px-3 py-1 rounded-lg font-mono line-through">
                      Original: {displayOriginalSize}
                    </span>
                  )}
                  {isMultiplayer(selectedGame, currentDetails) && (
                    <span className="text-xs bg-indigo-100 text-indigo-800 px-3 py-1 rounded-lg font-bold border border-indigo-200 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      Multiplayer
                    </span>
                  )}
                </div>

                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-snug">
                  {selectedGame.title}
                </h1>

                <div className="flex items-center gap-3 text-xs text-slate-600 font-medium">
                  <span>Category: <strong className="text-slate-900">{selectedGame.category || 'Game'}</strong></span>
                  <span>•</span>
                  <a
                    href={selectedGame.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:underline font-bold flex items-center gap-1"
                  >
                    {selectedGame.siteBadge === 'EROLABS' ? 'EroLabs Page' : 'FitGirl Page'} <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Download Link Section */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className={`w-4 h-4 ${selectedGame.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-600'}`} />
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    {selectedGame.siteBadge === 'EROLABS' ? 'Direct Download Link' : 'Magnet Download Link'}
                  </span>
                </div>

                {/* How to use tip */}
                {selectedGame.siteBadge === 'EROLABS' ? (
                  <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span>
                      Direct HTTP download from EroLabs. Click download to fetch it using the built-in engine.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                    <span>
                      Lossless compressed repack. Click download to fetch it using the built-in engine.
                    </span>
                  </div>
                )}

                {fetchingDetails && (
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-slate-600">
                    <Loader2 className={`w-5 h-5 animate-spin ${selectedGame.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-600'}`} />
                    <span className="text-xs font-semibold">
                      Fetching links from {selectedGame.siteBadge === 'EROLABS' ? 'EroLabs' : 'FitGirl'}...
                    </span>
                  </div>
                )}

                {!fetchingDetails && currentDetails && currentDetails.downloads.length === 0 && (
                  selectedGame.siteBadge === 'EROLABS' ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs space-y-1">
                      <p className="font-bold">⚠️ No direct download files available for this game.</p>
                      <p className="text-amber-700">This is a paid web-store game on EroLabs (requires coins). You can click the <strong>EroLabs Page</strong> link above to open it in your browser.</p>
                    </div>
                  ) : (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold">
                      ⚠️ No download links found for this game. Try opening the FitGirl page directly.
                    </div>
                  )
                )}

                {!fetchingDetails && currentDetails && currentDetails.downloads.length > 0 && (
                  <div className="space-y-3">
                    {currentDetails.downloads.map((opt, idx) => (
                      <div
                        key={idx}
                        className={`p-5 rounded-2xl bg-slate-50 border border-slate-200/90 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs ${
                          selectedGame.siteBadge === 'EROLABS' ? 'hover:border-rose-400' : 'hover:border-emerald-400'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-base">
                              {opt.label || 'Download'}
                            </span>
                            {selectedGame.siteBadge === 'EROLABS' ? (
                              <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-0.5 rounded border border-blue-200 flex items-center gap-1">
                                🪟 Windows
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded border border-emerald-200">
                                {opt.speedEstimate || 'Magnet Link'}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                          {(Array.isArray(opt.url) ? opt.url[0] : opt.url)?.startsWith('magnet:') && <button disabled={repairing || isAdding !== null} onClick={() => handleRepair(opt)}
                            title="Select the original repack folder or its parent. Must match this exact game version."
                            className="px-4 py-3 text-sm font-bold border border-emerald-300 rounded-xl text-emerald-800 disabled:opacity-50">
                            {repairing ? 'Finding game files…' : 'Repair files'}
                          </button>}
                          <button
                            onClick={() => handleOpenDownloadModal(opt, idx)}
                            disabled={isAdding === idx}
                            className={`px-8 py-3.5 font-extrabold text-sm rounded-xl text-white transition-all flex items-center gap-2 shadow-md w-full sm:w-auto justify-center cursor-pointer shrink-0 disabled:opacity-50 ${
                              selectedGame.siteBadge === 'EROLABS'
                                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                            }`}
                          >
                            {isAdding === idx ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Download className="w-5 h-5" />
                            )}
                            <span>{selectedGame.siteBadge === 'EROLABS' ? (opt.label || 'Download for Windows') : 'Download Repack'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                Screenshots ({screenshots.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {screenshots.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActivePreviewImage(imgUrl)}
                    className="group h-36 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 hover:border-emerald-500 cursor-pointer relative shadow-xs"
                  >
                    <img
                      src={imgUrl}
                      alt={`Screenshot ${idx + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-bold text-white">
                      Click to Enlarge
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {selectedGame.description && (
            <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-600" />
                Game Description
              </h3>
              <div className="text-sm text-slate-600 leading-relaxed font-medium">
                {selectedGame.description}
              </div>
            </div>
          )}
        </div>

        {/* Modal: Fullscreen Screenshot Preview */}
        {activePreviewImage && (
          <div
            onClick={() => setActivePreviewImage(null)}
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-800 relative">
              <img
                src={activePreviewImage}
                alt="Enlarged preview"
                className="max-h-[85vh] w-auto object-contain mx-auto"
              />
            </div>
          </div>
        )}

        {/* Modal: Pre-download inspect — seeder check + file list (FitGirl magnet only) */}
        {repairSelection && <RepairModal {...repairSelection} onClose={() => setRepairSelection(null)} onStarted={() => { setRepairSelection(null); toast.success('Repair started'); onSwitchToDownloads?.(); }} />}
        <PreDownloadInspectModal
          isOpen={!!pendingInspectOption}
          onClose={() => setPendingInspectOption(null)}
          gameTitle={selectedGame.title}
          downloadOption={pendingInspectOption?.opt || null}
          onInspected={data => { if (data.has_metadata && data.totalSize > 0) setExactSizes(prev => ({ ...prev, [selectedGame.id]: data.totalSize })); }}
          onProceedDownloadNow={handleInspectProceedNow}
          onProceedToSchedule={handleInspectProceedToSchedule}
        />

        {/* Modal: Download Now vs Schedule */}
        <ScheduleDownloadModal
          isOpen={!!pendingDownloadOption}
          onClose={() => setPendingDownloadOption(null)}
          gameTitle={selectedGame.title}
          downloadOption={pendingDownloadOption?.opt || null}
          siteBadge={selectedGame.siteBadge || (source === 'erolabs' ? 'EROLABS' : 'FITGIRL')}
          onConfirmNow={handleConfirmDownloadNow}
          onConfirmSchedule={handleConfirmSchedule}
        />
      </div>
    );
  }

  // ─── STORE FEED / GRID VIEW ─────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Search Bar */}
      <div className="pt-8 pb-6 px-6 border-b border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-sm flex flex-col items-center">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            {/* Source Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl border border-slate-200 shadow-inner">
              <button
                onClick={() => handleSwitchSource('fitgirl')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${
                  source === 'fitgirl'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                🎮 FitGirl Repacks
              </button>
              <button
                onClick={() => handleSwitchSource('erolabs')}
                className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all cursor-pointer ${
                  source === 'erolabs'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/25'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                🔥 EroLabs
              </button>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight text-center">
              Global Games Database
            </h1>
            <p className="text-sm text-slate-500 font-medium text-center">
              {source === 'erolabs'
                ? 'Browse EroLabs games → Click to download with built-in engine'
                : 'Browse FitGirl repacks → Click to download with built-in engine'}
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-3 w-full">
            <div className="relative flex-1 group">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
              <input
                type="text"
                placeholder="Search for any game title (e.g. Cyberpunk, GTA V, Elden Ring)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-5 py-3.5 bg-white border-2 border-slate-200 rounded-[16px] text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-semibold shadow-sm hover:shadow-md hover:border-slate-300"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-[16px] transition-all shadow-md shadow-emerald-600/20 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2 cursor-pointer shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <span>Search</span>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Grid Feed */}
      <div className="flex-1 overflow-y-auto p-6" onScroll={handleScroll}>
        <div className="max-w-7xl mx-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
              <p className="text-lg font-bold text-slate-800">Loading Games Feed...</p>
              <p className="text-xs text-slate-500 mt-1">Fetching from {source === 'erolabs' ? 'EroLabs' : 'FitGirl Repacks'}</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/90 text-rose-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6 shadow-xs">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-rose-900">
                    {isSourceUnavailable(error) ? `${sourceLabel} is temporarily unavailable` : 'Could not load this catalog'}
                  </p>
                  <p className="text-xs text-rose-700 mt-0.5">
                    {isSourceUnavailable(error)
                      ? 'The site server returned an error. Your PC and download engine are not the cause. Try again later.'
                      : error}
                  </p>
                  {isSourceUnavailable(error) && (
                    <p className="text-[11px] text-rose-600 mt-1 font-mono">Server response: {error}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => fetchFeed(searchQuery, 1, false, source)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all flex items-center gap-2 shadow-xs cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {!loading && !error && games.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Gamepad2 className="w-12 h-12 text-emerald-300 mx-auto mb-4" />
              <p className="text-lg font-bold text-slate-700">No games found</p>
              <p className="text-sm mt-1 text-slate-500">Try searching another title</p>
            </div>
          )}

          {!loading && games.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
                  <span>{searchQuery ? `Results for "${searchQuery}"` : source === 'erolabs' ? 'Hot EroLabs Games' : 'Top Popular Repacks'}</span>
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold font-mono">
                    {games.length} Games
                  </span>
                </h2>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {games.map((game) => (
                  <div
                    key={game.id}
                    onClick={() => handleOpenGameDetails(game)}
                    className={`group bg-white border border-slate-200/90 ${game.siteBadge === 'EROLABS' ? 'hover:border-rose-400' : 'hover:border-emerald-500'} rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 shadow-xs hover:shadow-md flex flex-col cursor-pointer`}
                  >
                    {/* Cover */}
                    <div className="relative h-64 bg-slate-100/90 p-3 flex items-center justify-center border-b border-slate-200 overflow-hidden">
                      {game.cover ? (
                        <img
                          src={game.cover}
                          alt={game.title}
                          className="max-h-full max-w-full object-contain rounded-lg shadow-sm group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center">
                          <Gamepad2 className="w-10 h-10 text-emerald-600" />
                          <span className="text-xs font-bold text-slate-600 line-clamp-2">{game.title}</span>
                        </div>
                      )}

                      {/* Source Badge (FITGIRL / EROLABS) */}
                      <div className={`absolute top-3 left-3 ${game.siteBadge === 'EROLABS' ? 'bg-rose-600' : 'bg-emerald-600'} text-white text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider shadow-sm`}>
                        {game.siteBadge || 'FITGIRL'}
                      </div>

                      {/* Multiplayer Badge */}
                      {isMultiplayer(game, detailsLoaded[game.id]) && (
                        <div className="absolute top-3 right-3 bg-indigo-600/95 backdrop-blur-md text-white text-[10px] font-extrabold px-2 py-1 rounded-md uppercase tracking-wider shadow-sm flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span>MULTIPLAYER</span>
                        </div>
                      )}

                      {/* Size Badge */}
                      {game.size && game.size !== 'Repack' && (
                        <div className="absolute bottom-3 right-3 bg-white/95 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200 backdrop-blur-md flex items-center gap-1.5 shadow-xs">
                          <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{exactSizes[game.id] ? formatSize(exactSizes[game.id]) : `Site estimate: ${game.size}`}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="p-4 flex-1 flex flex-col justify-between bg-white">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm line-clamp-2 group-hover:text-emerald-700 transition-colors leading-snug">
                          {game.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-2 line-clamp-1 font-medium">
                          {game.category || 'Lossless Repack'}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className={`${game.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-700'} font-bold flex items-center gap-1`}>
                          {game.siteBadge === 'EROLABS' ? (
                            <><HardDrive className="w-3.5 h-3.5" /><span>Windows Game</span></>
                          ) : (
                            <><Copy className="w-3.5 h-3.5" /><span>Magnet Link</span></>
                          )}
                        </span>
                        <div className="flex items-center gap-1 text-slate-700 group-hover:text-emerald-700 font-bold transition-colors">
                          <span>View Details</span>
                          <ExternalLink className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {loadingMore && (
                <div className="flex items-center justify-center gap-3 py-10 my-4 text-emerald-700 font-bold text-sm bg-emerald-50/60 rounded-2xl border border-emerald-200/80">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                  <span>Loading more games...</span>
                </div>
              )}

              {!hasMore && games.length > 0 && (
                <div className="text-center py-8 text-xs font-semibold text-slate-400">
                  ✓ End of results
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};