import React, { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';
import { toast } from 'sonner';
import { Clock, Search, Loader2, Download, ExternalLink, AlertCircle, FileArchive, HardDrive, Info, ArrowLeft, Image as ImageIcon, Sparkles, X, Gamepad2, RotateCcw } from 'lucide-react';
import { GameItem, GameDownloadOption } from '../types';

interface SearchScraperViewProps {
  onStartDownload: (game: GameItem, selectedOption: GameDownloadOption) => void;
  isUpdateRequiredBlocked?: boolean;
}

interface LoadedDetails {
  downloads: GameDownloadOption[];
  partsCount: number;
  description?: string;
  repackSizeStr?: string;
  originalSizeStr?: string;
  cover?: string;
  screenshots?: string[];
}

export const SearchScraperView: React.FC<SearchScraperViewProps> = ({ onStartDownload, isUpdateRequiredBlocked }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
  const [fetchingDetails, setFetchingDetails] = useState(false);

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleOption, setScheduleOption] = useState<GameDownloadOption | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledTimeString, setScheduledTimeString] = useState('');
  
  // Real-time clock for modal
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    if (!scheduleModalOpen) return;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [scheduleModalOpen]);

  const [detailsLoaded, setDetailsLoaded] = useState<Record<string, LoadedDetails>>({});
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);

  // Auto fetch Top Popular Repacks on startup
  useEffect(() => {
    if (!isUpdateRequiredBlocked) {
      fetchFeed('', 1, false);
    }
  }, [isUpdateRequiredBlocked]);

  // Auto-fetch cover images for search result items if missing
  useEffect(() => {
    if (games.length === 0) return;

    const gamesWithoutCover = games.filter(g => !g.cover && !detailsLoaded[g.id]);
    if (gamesWithoutCover.length === 0) return;

    gamesWithoutCover.slice(0, 10).forEach(async (game) => {
      try {
        const res = await fetch(`/api/fitgirl/details?siteUrl=${encodeURIComponent(game.siteUrl)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.cover) {
            setGames(prev => prev.map(item => item.id === game.id ? { ...item, cover: data.cover } : item));
            setDetailsLoaded(prev => ({
              ...prev,
              [game.id]: {
                downloads: data.downloads || [],
                partsCount: data.partsCount || 0,
                description: data.description,
                repackSizeStr: data.repackSizeStr,
                originalSizeStr: data.originalSizeStr,
                cover: data.cover,
                screenshots: data.screenshots || []
              }
            }));
          }
        }
      } catch {
        // ignore background fetch error
      }
    });
  }, [games]);

  const fetchFeed = async (query: string, pageNum: number = 1, append: boolean = false) => {
    if (pageNum === 1) {
      setLoading(true);
      setHasMore(true);
      setPage(1);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const endpoint = query.trim() 
        ? `/api/fitgirl/search?q=${encodeURIComponent(query.trim())}&page=${pageNum}`
        : `/api/fitgirl/popular?page=${pageNum}`;

      const res = await apiFetch(endpoint);
      if (!res.ok) throw new Error('Failed to load games list');
      const data = await res.json();
      const newGames: GameItem[] = data.games || [];

      if (newGames.length === 0) {
        setHasMore(false);
      } else {
        if (append) {
          setGames(prev => {
            const existingUrls = new Set(prev.map(g => g.siteUrl));
            const filteredNew = newGames.filter(g => !existingUrls.has(g.siteUrl));
            if (filteredNew.length === 0) setHasMore(false);
            return [...prev, ...filteredNew];
          });
        } else {
          setGames(newGames);
        }
      }
    } catch (err: any) {
      console.error('Error fetching games:', err);
      setError(err.message || 'Failed to fetch games feed');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFeed(searchQuery, 1, false);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 350 && hasMore && !loadingMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchFeed(searchQuery, nextPage, true);
    }
  };

  const handleOpenGameDetails = async (game: GameItem) => {
    setSelectedGame(game);
    if (detailsLoaded[game.id]) return;

    setFetchingDetails(true);
    try {
      const res = await apiFetch(`/api/fitgirl/details?siteUrl=${encodeURIComponent(game.siteUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.cover) {
          setGames(prev => prev.map(item => item.id === game.id ? { ...item, cover: data.cover } : item));
        }
        setDetailsLoaded(prev => ({
          ...prev,
          [game.id]: {
            downloads: data.downloads || [],
            partsCount: data.partsCount || 0,
            description: data.description,
            repackSizeStr: data.repackSizeStr,
            originalSizeStr: data.originalSizeStr,
            cover: data.cover,
            screenshots: data.screenshots || []
          }
        }));
      }
    } catch (err) {
      console.error('Failed to fetch details:', err);
    } finally {
      setFetchingDetails(false);
    }
  };

  const currentDetails = selectedGame ? detailsLoaded[selectedGame.id] : null;

  // --------------------------------------------------------------------------
  // DEDICATED FULL PAGE VIEW FOR SELECTED GAME
  // --------------------------------------------------------------------------
  if (selectedGame) {
    const displayCover = currentDetails?.cover || selectedGame.cover;
    const displayRepackSize = currentDetails?.repackSizeStr || selectedGame.repackSizeStr || selectedGame.size;
    const displayOriginalSize = currentDetails?.originalSizeStr || selectedGame.originalSizeStr;
    const screenshotsList = currentDetails?.screenshots || selectedGame.screenshots || [];

    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-y-auto">
        {/* Top Sticky Header */}
        <div className="p-4 px-6 border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between shadow-xs">
          <button
            onClick={() => setSelectedGame(null)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs border border-slate-200"
          >
            <ArrowLeft className="w-4 h-4 text-emerald-600" />
            <span>Back to Store Feed</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 px-3.5 py-1 rounded-full font-bold">
              FitGirl Repack
            </span>
          </div>
        </div>

        {/* Full Dedicated Game Page Body */}
        <div className="max-w-6xl mx-auto w-full p-6 space-y-8">
          {/* Hero Banner Header Card */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 flex flex-col md:flex-row gap-8 items-start shadow-md relative overflow-hidden">
            {/* Cover Image Container */}
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

            {/* Title & Metadata */}
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-emerald-600 text-white text-[11px] font-black px-3 py-0.5 rounded-md uppercase tracking-wider shadow-xs">
                    FITGIRL
                  </span>
                  {displayRepackSize && (
                    <span className="text-xs bg-slate-100 text-slate-800 px-3 py-1 rounded-lg font-mono font-bold border border-slate-200">
                      Repack Size: <strong className="text-emerald-700">{displayRepackSize}</strong>
                    </span>
                  )}
                  {displayOriginalSize && (
                    <span className="text-xs bg-slate-100/80 text-slate-500 px-3 py-1 rounded-lg font-mono line-through">
                      Original: {displayOriginalSize}
                    </span>
                  )}
                </div>

                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-snug">
                  {selectedGame.title}
                </h1>

                <div className="flex items-center gap-3 text-xs text-slate-600 font-medium">
                  <span>Category: <strong className="text-slate-900">{selectedGame.category || 'Lossless Repack'}</strong></span>
                  <span>•</span>
                  <a
                    href={selectedGame.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:underline font-bold flex items-center gap-1"
                  >
                    FitGirl Web Page <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Direct Download Action Section */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Download className="w-4 h-4 text-emerald-600" /> Aria2 Torrent Download Engine
                  </span>
                </div>

                {fetchingDetails && (
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-slate-600">
                    <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                    <span className="text-xs font-semibold">Fetching .torrent file & download mirrors...</span>
                  </div>
                )}

                {!fetchingDetails && currentDetails && currentDetails.downloads.length === 0 && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold">
                    No Torrent download links parsed for this item.
                  </div>
                )}

                {!fetchingDetails && currentDetails && currentDetails.downloads.length > 0 && (
                  <div className="space-y-3">
                    {currentDetails.downloads.map((opt, idx) => (
                      <div
                        key={idx}
                        className="p-5 rounded-2xl bg-slate-50 border border-slate-200/90 hover:border-emerald-500 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-base">{opt.label || 'Torrent Download'}</span>
                            <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded border border-emerald-200">
                              {opt.speedEstimate || 'High Speed Torrent'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            Fast and direct P2P Torrent download engine.
                          </p>
                        </div>

                        <button
                          onClick={() => { setScheduleOption(opt); setScheduleModalOpen(true); }}
                          className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm rounded-xl transition-all flex items-center gap-2 shadow-md shadow-emerald-600/20 w-full sm:w-auto justify-center cursor-pointer"
                        >
                          <Download className="w-5 h-5" />
                          <span>Download Torrent</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Screenshots Gallery Section */}
          {screenshotsList.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                Game Screenshots ({screenshotsList.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {screenshotsList.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActivePreviewImage(imgUrl)}
                    className="group h-36 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 hover:border-emerald-500 cursor-pointer relative shadow-xs"
                  >
                    <img
                      src={imgUrl}
                      alt={`Screenshot ${idx + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-bold text-white">
                      Click to Enlarge
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description & Overview */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600" />
              Game Description & Features
            </h3>
            <div className="p-6 rounded-2xl bg-white border border-slate-200 text-xs text-slate-700 leading-relaxed space-y-3 whitespace-pre-line shadow-xs">
              {currentDetails?.description || selectedGame.description || 'No description available for this repack.'}
            </div>
          </div>
        </div>

        {/* Image Fullscreen Lightbox Modal */}
        {activePreviewImage && (
          <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
            <button
              onClick={() => setActivePreviewImage(null)}
              className="absolute top-6 right-6 p-2 bg-white text-slate-800 hover:bg-slate-100 rounded-xl text-lg cursor-pointer shadow-lg"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={activePreviewImage}
              alt="Preview"
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-2xl border border-slate-200 shadow-2xl"
            />
          </div>
        )}

        {/* Schedule Confirmation Modal */}
        {scheduleModalOpen && selectedGame && scheduleOption && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-600" />
                  Confirm Download
                </h3>
                <button 
                  onClick={() => setScheduleModalOpen(false)}
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 flex flex-col gap-5">
                <div className="flex gap-4 items-start bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <img src={displayCover || 'https://via.placeholder.com/60'} alt="Cover" className="w-16 h-20 object-cover rounded-md shadow-sm" />
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 line-clamp-2">{selectedGame.title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">{selectedGame.siteBadge}</span>
                      <span className="text-slate-500 font-semibold">{displayRepackSize}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-600">Current System Time:</span>
                    <span className="text-sm font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 font-mono">
                      {currentTime.toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-3 mt-2">
                    <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${scheduleMode === 'immediate' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                      <input 
                        type="radio" 
                        name="scheduleMode" 
                        checked={scheduleMode === 'immediate'} 
                        onChange={() => setScheduleMode('immediate')}
                        className="w-4 h-4 text-indigo-600 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-slate-900">Immediate Download</div>
                        <div className="text-xs text-slate-500 font-medium">Start downloading right now</div>
                      </div>
                    </label>

                    <label className={`flex flex-col gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${scheduleMode === 'scheduled' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                      <div className="flex items-center gap-3">
                        <input 
                          type="radio" 
                          name="scheduleMode" 
                          checked={scheduleMode === 'scheduled'} 
                          onChange={() => setScheduleMode('scheduled')}
                          className="w-4 h-4 text-indigo-600 cursor-pointer"
                        />
                        <div>
                          <div className="font-bold text-slate-900">Scheduled Time</div>
                          <div className="text-xs text-slate-500 font-medium">Pick a future time to start</div>
                        </div>
                      </div>
                      {scheduleMode === 'scheduled' && (
                        <div className="pl-7 pt-2">
                          <input 
                            type="datetime-local" 
                            value={scheduledTimeString}
                            onChange={(e) => setScheduledTimeString(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                          />
                        </div>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (scheduleMode === 'immediate') {
                      onStartDownload(selectedGame, scheduleOption);
                      setScheduleModalOpen(false);
                    } else {
                      if (!scheduledTimeString) return alert('Please select a valid future time.');
                      const targetTime = new Date(scheduledTimeString).getTime();
                      if (targetTime <= Date.now()) return alert('Scheduled time must be in the future.');
                      
                      fetch('/api/downloads/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: `dl-${Date.now()}`,
                          title: selectedGame.title,
                          url: scheduleOption.url,
                          cover: displayCover || selectedGame.cover,
                          repacker: selectedGame.repacker,
                          siteBadge: selectedGame.siteBadge,
                          size: displayRepackSize || selectedGame.size,
                          scheduledTime: targetTime
                        })
                      }).then(res => res.json()).then(data => {
                        if (data.error) throw new Error(data.error);
                        toast.success(`Download scheduled for ${new Date(targetTime).toLocaleString()}!`);
                        alert(`Download scheduled for ${new Date(targetTime).toLocaleString()}!`);
                        setScheduleModalOpen(false);
                        window.dispatchEvent(new CustomEvent('refresh-scheduled-queue'));
                      }).catch(err => {
                        toast.error(err.message || 'Failed to schedule download.');
                        alert(err.message || 'Failed to schedule download.');
                      });
                    }
                  }}
                  className="px-6 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
                >
                  {scheduleMode === 'immediate' ? 'Confirm & Start' : 'Schedule Task'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  // --------------------------------------------------------------------------
  // STORE LIST / FEED GRID VIEW
  // --------------------------------------------------------------------------
  if (isUpdateRequiredBlocked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 mb-2">Update Required</h2>
        <p className="text-slate-600 max-w-md font-medium mb-6">
          The game scraper and search engine are disabled because you deferred a mandatory update. 
          Please update the application to restore online features.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Top Search Bar */}
      <div className="pt-8 pb-6 px-6 border-b border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-sm flex flex-col items-center">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 text-emerald-600 font-bold tracking-widest text-xs uppercase">
              <Sparkles className="w-4 h-4" />
              <span>Premium Collection</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight text-center">
              Global Games Database
            </h1>
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
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-[16px] transition-all shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2 cursor-pointer shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                  <span>Searching...</span>
                </>
              ) : (
                <span>Search Library</span>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Main Grid Feed */}
      <div className="flex-1 overflow-y-auto p-6" onScroll={handleScroll}>
        <div className="max-w-7xl mx-auto">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
              <p className="text-lg font-bold text-slate-800">Loading Games Feed...</p>
              <p className="text-xs text-slate-500 mt-1">Fetching popular games and search results from FitGirl</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/90 text-rose-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6 shadow-xs">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-rose-900">Connection Error / Failed to Fetch</p>
                  <p className="text-xs text-rose-700 mt-0.5">{error}. Please check your connection and try again.</p>
                </div>
              </div>
              <button
                onClick={() => fetchFeed(searchQuery, 1, false)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all flex items-center gap-2 shadow-xs cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry (නැවත උත්සාහ කරන්න)</span>
              </button>
            </div>
          )}

          {!loading && !error && games.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <p className="text-lg font-bold text-slate-700">No games found</p>
              <p className="text-sm mt-1 text-slate-500">Try searching for another game title like "Cyberpunk", "GTA V", or "Elden Ring"</p>
            </div>
          )}

          {!loading && games.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
                  <span>{searchQuery ? `Search Results for "${searchQuery}"` : 'Top 50 Popular Repacks of the Month'}</span>
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold font-mono">
                    {games.length} Games Loaded
                  </span>
                </h2>
              </div>

              {/* Game Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {games.map((game) => (
                  <div
                    key={game.id}
                    onClick={() => handleOpenGameDetails(game)}
                    className="group bg-white border border-slate-200/90 hover:border-emerald-500 rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 shadow-xs hover:shadow-md flex flex-col cursor-pointer"
                  >
                    {/* Cover Thumbnail Container */}
                    <div className="relative h-64 bg-slate-100/90 p-3 flex items-center justify-center border-b border-slate-200 overflow-hidden">
                      {game.cover ? (
                        <img
                          src={game.cover}
                          alt={game.title}
                          className="max-h-full max-w-full object-contain rounded-lg shadow-sm group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center">
                          <Gamepad2 className="w-10 h-10 text-emerald-600" />
                          <span className="text-xs font-bold text-slate-600 line-clamp-2">{game.title}</span>
                          <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            FitGirl Repack
                          </span>
                        </div>
                      )}

                      {/* Repacker Badge */}
                      <div className="absolute top-3 left-3 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider shadow-sm">
                        FITGIRL
                      </div>

                      {/* Size Badge */}
                      {game.size && (
                        <div className="absolute bottom-3 right-3 bg-white/95 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200 backdrop-blur-md flex items-center gap-1.5 shadow-xs">
                          <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{game.size}</span>
                        </div>
                      )}
                    </div>

                    {/* Game Metadata Card Content */}
                    <div className="p-4 flex-1 flex flex-col justify-between bg-white">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm line-clamp-2 group-hover:text-emerald-700 transition-colors leading-snug">
                          {game.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-2 line-clamp-2 font-medium">
                          {game.category || 'Lossless Repack'}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span className="text-emerald-700 font-bold flex items-center gap-1">
                          <Download className="w-3.5 h-3.5" />
                          <span>Torrent Engine</span>
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

              {/* Bottom Loading / Infinite Scroll Status */}
              {loadingMore && (
                <div className="flex items-center justify-center gap-3 py-10 my-4 text-emerald-700 font-bold text-sm bg-emerald-50/60 rounded-2xl border border-emerald-200/80">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                  <span>Loading additional games for page {page}...</span>
                </div>
              )}

              {!hasMore && games.length > 0 && (
                <div className="text-center py-8 text-xs font-semibold text-slate-400">
                  <span>✓ You've reached the end of the results feed</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

