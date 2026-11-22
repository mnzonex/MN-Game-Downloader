import { RepairModal } from './RepairModal';
import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../services/api';
import { buildUniversalSearchRequests, mergeUniversalSourceResults, validateUniversalSourceGames } from '../services/universalSearch';
import { toast } from 'sonner';
import {
  Search, Loader2, Copy, ExternalLink, AlertCircle, HardDrive, Info,
  ArrowLeft, Gamepad2, RotateCcw, Link2, Users, Download,
  Package, Zap, Gift, Store, ChevronRight, ShieldCheck, CalendarClock, Image as ImageIcon, Globe2,
} from 'lucide-react';
import { GameItem, GameDownloadOption } from '../types';
import { GAME_SOURCES, SOURCE_PAGE_SIZE, type SourceId, getSource } from '../sources/registry';
import type { PerformanceMode } from './PerformanceBoostView';

function captureProductEvent(eventName: string, properties: Record<string, unknown> = {}) {
  try { (window as any).electron?.analytics?.capture(eventName, properties); } catch {}
}

interface LoadedDetails {
  downloads: GameDownloadOption[];
  partsCount: number;
  description?: string;
  developer?: string;
  releaseDate?: string;
  repackSizeStr?: string;
  originalSizeStr?: string;
  cover?: string;
  screenshots?: string[];
  publisher?: string;
  platforms?: string[];
  storeLink?: string;
  isFreeToPlay?: boolean;
  offerStatus?: "free-now" | "upcoming";
  offerStart?: string;
  offerEnd?: string;
}

interface SourceFeed {
  games: GameItem[];
  bufferedGames: GameItem[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  error: string | null;
}

const emptyFeed = (): SourceFeed => ({
  games: [], bufferedGames: [], page: 1, hasMore: true,
  loading: false, loadingMore: false, loaded: false, error: null,
});

const sourceTone: Record<string, string> = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  indigo: "bg-indigo-500",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
};

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
  active?: boolean;
  performanceMode?: PerformanceMode;
  onSwitchToDownloads?: () => void;
  mode?: "source" | "universal";
}> = ({ active = true, performanceMode = 'off', onSwitchToDownloads, mode = "source" }) => {
  const isUniversalSearch = mode === "universal";
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

  const [source, setSource] = useState<SourceId>("fitgirl");
  const sourceRef = useRef<SourceId>("fitgirl");
  const autoLoadSentinelRef = useRef<HTMLDivElement>(null);
  sourceRef.current = source;
  const requestIdRef = React.useRef<Record<SourceId, number>>({
    fitgirl: 0, erolabs: 0, gog: 0, steam: 0, epic: 0,
  });
  const controllersRef = React.useRef<Record<SourceId, AbortController | null>>({
    fitgirl: null, erolabs: null, gog: null, steam: null, epic: null,
  });
  const [feeds, setFeeds] = useState<Record<SourceId, SourceFeed>>({
    fitgirl: emptyFeed(), erolabs: emptyFeed(), gog: emptyFeed(), steam: emptyFeed(), epic: emptyFeed(),
  });
  const [universalFeed, setUniversalFeed] = useState<SourceFeed>(() => ({ ...emptyFeed(), hasMore: false }));
  const [universalUnavailableSources, setUniversalUnavailableSources] = useState<string[]>([]);
  const universalRequestIdRef = useRef(0);
  const universalControllerRef = useRef<AbortController | null>(null);
  const currentSource = getSource(source);
  const sourceLabel = isUniversalSearch ? "all sources" : currentSource.label;
  const activeFeed = isUniversalSearch ? universalFeed : feeds[source];
  const { games, bufferedGames, loading, loadingMore, page, hasMore, error } = activeFeed;

  useEffect(() => {
    if (!active || isUniversalSearch) return;
    const activeSource = sourceRef.current;
    captureProductEvent('game_source_viewed', { source_id: activeSource });
    const currentFeed = feeds[activeSource];
    if (!currentFeed.loaded && !currentFeed.loading) void fetchFeed('', 1, false, activeSource);
  }, [active, isUniversalSearch]);

  const handleSwitchSource = (newSource: SourceId) => {
    if (newSource === source) return;
    captureProductEvent('game_source_viewed', { source_id: newSource });
    setSource(newSource);
    setSearchQuery('');
    setSelectedGame(null);
    const feed = feeds[newSource];
    if (!feed.loaded && !feed.loading) void fetchFeed('', 1, false, newSource);
  };

  // Auto-fetch cover images for visible FitGirl cards
  useEffect(() => {
    if (!active || isUniversalSearch || performanceMode !== 'off' || games.length === 0) return;
    const withoutCover = games.filter(g => !g.cover && !detailsLoaded[g.id]);
    if (withoutCover.length === 0) return;

    withoutCover.slice(0, 10).forEach(async (game) => {
      try {
        if (game.sourceId !== 'fitgirl' && game.siteBadge !== 'FITGIRL') return;

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
  }, [games, active, performanceMode, isUniversalSearch]);

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
        bufferedGames: pageNum === 1 ? [] : prev[activeSource].bufferedGames,
        hasMore: pageNum === 1 ? true : prev[activeSource].hasMore,
        loading: pageNum === 1,
        loadingMore: pageNum > 1,
        error: null,
      },
    }));

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      let endpoint: string;
      if (activeSource === "erolabs") {
        endpoint = query.trim()
          ? `/api/erolabs/search?q=${encodedQuery}&page=${pageNum}`
          : `/api/erolabs/popular?page=${pageNum}`;
      } else if (activeSource === "gog") {
        endpoint = query.trim() ? `/api/gog/search?q=${encodedQuery}&page=${pageNum}` : `/api/gog/free?page=${pageNum}`;
      } else if (activeSource === "steam") {
        endpoint = query.trim() ? `/api/steam/search?q=${encodedQuery}&page=${pageNum}` : `/api/steam/free?page=${pageNum}`;
      } else if (activeSource === "epic") {
        endpoint = query.trim() ? `/api/epic/search?q=${encodedQuery}&page=${pageNum}` : `/api/epic/free?page=${pageNum}`;
      } else {
        endpoint = query.trim()
          ? `/api/fitgirl/search?q=${encodedQuery}&page=${pageNum}`
          : `/api/fitgirl/popular?page=${pageNum}`;
      }

      const timeout = AbortSignal.timeout(30000);
      const res = await apiFetch(endpoint, { signal: AbortSignal.any([controller.signal, timeout]) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load ${getSource(activeSource).label} (${res.status})`);

      const expectedBadge: Record<SourceId, string> = {
        fitgirl: "FITGIRL", erolabs: "EROLABS", gog: "GOG", steam: "STEAM", epic: "EPIC",
      };
      const responseGames = Array.isArray(data.games) ? data.games as GameItem[] : [];
      const validGames = responseGames.filter((game) =>
        game.siteBadge === expectedBadge[activeSource] &&
        (game.sourceId === undefined || game.sourceId === activeSource)
      );
      if (responseGames.length > 0 && validGames.length !== responseGames.length) {
        throw new Error("This source returned games from another catalog. Please retry.");
      }

      if (reqId !== requestIdRef.current[activeSource]) return;
      const firstBatch = validGames.slice(0, SOURCE_PAGE_SIZE);
      const buffered = validGames.slice(SOURCE_PAGE_SIZE);
      const upstreamHasMore = typeof data.hasMore === "boolean"
        ? data.hasMore
        : validGames.length >= SOURCE_PAGE_SIZE;

      setFeeds(prev => {
        const current = prev[activeSource];
        const existingIds = new Set(current.games.map(game => game.id));
        const additions = firstBatch.filter(game => !existingIds.has(game.id));
        return {
          ...prev,
          [activeSource]: {
            ...current,
            games: append ? [...current.games, ...additions] : firstBatch,
            bufferedGames: append ? [...current.bufferedGames, ...buffered] : buffered,
            page: Number(data.page || pageNum),
            hasMore: buffered.length > 0 || upstreamHasMore,
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
          error: err.message || "Failed to fetch games",
        },
      }));
    } finally {
      if (controllersRef.current[activeSource] === controller) controllersRef.current[activeSource] = null;
    }
  };

  const fetchUniversalFeed = async (query: string, pageNum: number = 1, append = false) => {
    const normalizedQuery = query.trim().slice(0, 100);
    if (!normalizedQuery) {
      setUniversalFeed((prev) => ({ ...prev, error: "Enter a game or app name to search across all sources." }));
      return;
    }
    if (pageNum === 1) universalControllerRef.current?.abort();
    const controller = new AbortController();
    universalControllerRef.current = controller;
    const requestId = ++universalRequestIdRef.current;

    if (pageNum === 1) setUniversalUnavailableSources([]);
    setUniversalFeed((prev) => ({
      ...prev,
      page: pageNum === 1 ? 1 : prev.page,
      bufferedGames: [],
      hasMore: pageNum === 1 ? true : prev.hasMore,
      loading: pageNum === 1,
      loadingMore: pageNum > 1,
      error: null,
    }));

    const requests = buildUniversalSearchRequests(normalizedQuery, pageNum);

    try {
      const timeout = AbortSignal.timeout(35000);
      const outcomes = await Promise.allSettled(requests.map(async ({ sourceId, endpoint }) => {
        const response = await apiFetch(endpoint, {
          signal: AbortSignal.any([controller.signal, timeout]),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || getSource(sourceId).label + " returned HTTP " + response.status);
        }

        const rawGames = Array.isArray(data.games) ? data.games as GameItem[] : [];
        const sourceGames = validateUniversalSourceGames(sourceId, rawGames);
        return {
          sourceId,
          games: sourceGames,
          hasMore: typeof data.hasMore === "boolean"
            ? data.hasMore
            : sourceGames.length >= SOURCE_PAGE_SIZE,
        };
      }));

      if (requestId !== universalRequestIdRef.current || controller.signal.aborted) return;
      const successful = outcomes
        .filter((outcome): outcome is PromiseFulfilledResult<{ sourceId: SourceId; games: GameItem[]; hasMore: boolean }> => outcome.status === "fulfilled")
        .map((outcome) => outcome.value);
      const failedSourceIds = outcomes
        .map((outcome, index) => outcome.status === "rejected" ? requests[index].sourceId : null)
        .filter((sourceId): sourceId is SourceId => sourceId !== null);
      const failedLabels = failedSourceIds.map((sourceId) => getSource(sourceId).shortLabel);
      setUniversalUnavailableSources(failedLabels);

      if (!successful.length) {
        throw new Error("All search sources are currently unavailable. " + failedLabels.join(", "));
      }

      const additions = mergeUniversalSourceResults(successful);
      setUniversalFeed((prev) => {
        const existing = new Set(append ? prev.games.map((game) => (game.sourceId || "unknown") + ":" + game.id) : []);
        const nextBatch = additions.filter((game) => !existing.has((game.sourceId || "unknown") + ":" + game.id));
        return {
          ...prev,
          games: append ? [...prev.games, ...nextBatch] : nextBatch,
          bufferedGames: [],
          page: pageNum,
          hasMore: successful.some((result) => result.hasMore),
          loading: false,
          loadingMore: false,
          loaded: true,
          error: null,
        };
      });
    } catch (err: any) {
      if (requestId !== universalRequestIdRef.current || controller.signal.aborted) return;
      setUniversalFeed((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        loaded: true,
        error: err.message || "Universal Search failed.",
      }));
    } finally {
      if (universalControllerRef.current === controller) universalControllerRef.current = null;
    }
  };

  const handleLoadMore = () => {
    if (!active || loading || loadingMore || !hasMore) return;
    if (isUniversalSearch) {
      void fetchUniversalFeed(searchQuery, page + 1, true);
      return;
    }
    if (bufferedGames.length > 0) {
      const batch = bufferedGames.slice(0, SOURCE_PAGE_SIZE);
      const remaining = bufferedGames.slice(SOURCE_PAGE_SIZE);
      setFeeds(prev => {
        const current = prev[source];
        const existingIds = new Set(current.games.map(game => game.id));
        return {
          ...prev,
          [source]: {
            ...current,
            games: [...current.games, ...batch.filter(game => !existingIds.has(game.id))],
            bufferedGames: remaining,
            hasMore: remaining.length > 0 || current.hasMore,
          },
        };
      });
      return;
    }
    void fetchFeed(searchQuery, page + 1, true, source);
  };

  // Load the next batch as the user approaches the end of the current feed.
  useEffect(() => {
    if (!active || !hasMore || loading || loadingMore || !autoLoadSentinelRef.current) return;
    const target = autoLoadSentinelRef.current;
    const root = target.closest('.mn-browser-feed');
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) handleLoadMore();
    }, { root, rootMargin: '0px 0px 180px 0px', threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, source, searchQuery, page, games.length, hasMore, loading, loadingMore, bufferedGames.length]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      captureProductEvent('game_search', {
        search_scope: isUniversalSearch ? 'all_sources' : 'single_source',
        source_id: isUniversalSearch ? undefined : source,
      });
      captureProductEvent('feature_used', { feature: 'game_search' });
    }
    if (isUniversalSearch) {
      void fetchUniversalFeed(searchQuery, 1, false);
    } else {
      void fetchFeed(searchQuery, 1, false, source);
    }
  };

  const handleOpenGameDetails = async (game: GameItem) => {
    captureProductEvent('feature_used', { feature: 'game_details' });
    setSelectedGame(game);
    if (detailsLoaded[game.id]) return;

    setFetchingDetails(true);
    try {
      const gameSource: SourceId = game.sourceId ||
        (game.siteBadge === "EROLABS" || game.id.startsWith("ero-") ? "erolabs" :
         game.siteBadge === "GOG" || game.id.startsWith("gog-") ? "gog" :
         game.siteBadge === "STEAM" || game.id.startsWith("steam-") ? "steam" :
         game.siteBadge === "EPIC" || game.id.startsWith("epic-") ? "epic" : "fitgirl");
      const detailsId = game.id.replace(/^(gog|steam)-/, "");
      const detailEndpoint = gameSource === "erolabs"
        ? `/api/erolabs/details?siteUrl=${encodeURIComponent(game.siteUrl)}`
        : gameSource === "gog"
          ? `/api/gog/details?id=${encodeURIComponent(detailsId)}`
          : gameSource === "steam"
            ? `/api/steam/details?id=${encodeURIComponent(detailsId)}`
            : gameSource === "epic"
              ? `/api/epic/details?id=${encodeURIComponent(game.id)}`
              : `/api/fitgirl/details?siteUrl=${encodeURIComponent(game.siteUrl)}`;

      const res = await apiFetch(detailEndpoint);
      if (!res.ok) throw new Error(`Details service returned HTTP ${res.status}`);
      {
        const data = await res.json();
        // Do NOT overwrite existing clean cover images!
        if (data.cover && !game.cover) {
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
            description: data.description || game.description,
            developer: data.developer || game.developer,
            publisher: data.publisher || game.publisher,
            releaseDate: data.releaseDate || game.releaseDate,
            platforms: data.platforms || [],
            storeLink: data.storeLink || game.siteUrl,
            isFreeToPlay: data.isFreeToPlay ?? game.isFreeToPlay,
            offerStatus: data.offerStatus || game.offerStatus,
            offerStart: data.offerStart || game.offerStart,
            offerEnd: data.offerEnd || game.offerEnd,
            repackSizeStr: data.repackSizeStr,
            originalSizeStr: data.originalSizeStr,
            cover: game.cover || data.cover || '',
            screenshots: Array.isArray(data.screenshots) && data.screenshots.length ? data.screenshots : (game.screenshots || []),
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
    if (selectedGame?.sourceAction === 'official-store' || ['GOG', 'STEAM', 'EPIC'].includes(selectedGame?.siteBadge || '')) {
      toast.info('This title is installed through its official store. Use the Open Store action on its details page.');
      return;
    }
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
      await addTorrent(rawUrl, selectedGame.title, selectedGame.cover || currentDetails?.cover, selectedGame.sourceId || source);
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
      await addTorrent(rawUrl, selectedGame.title, selectedGame.cover || currentDetails?.cover, selectedGame.sourceId || source);
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
      await scheduleTorrent(rawUrl, selectedGame.title, scheduledAtMs, selectedGame.cover || currentDetails?.cover, selectedGame.sourceId || source);
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
    const selectedSourceId: SourceId = selectedGame.sourceId ||
      (selectedGame.siteBadge === "EROLABS" ? "erolabs" : selectedGame.siteBadge === "GOG" ? "gog" : selectedGame.siteBadge === "STEAM" ? "steam" : selectedGame.siteBadge === "EPIC" ? "epic" : "fitgirl");
    const selectedSource = getSource(selectedSourceId);
    const isOfficialStore = selectedSource.availability === "official-store";
    const displayCover = selectedGame.cover || currentDetails?.cover || '';
    const displayRepackSize = isOfficialStore ? '' : exactSizes[selectedGame.id] ? formatSize(exactSizes[selectedGame.id]) : currentDetails?.repackSizeStr || selectedGame.repackSizeStr || selectedGame.size;
    const displayOriginalSize = currentDetails?.originalSizeStr || selectedGame.originalSizeStr;
    const screenshots = currentDetails?.screenshots?.length ? currentDetails.screenshots : selectedGame.screenshots || [];
    const offerStatus = currentDetails?.offerStatus || selectedGame.offerStatus;
    const offerStart = currentDetails?.offerStart || selectedGame.offerStart;
    const offerEnd = currentDetails?.offerEnd || selectedGame.offerEnd;
    const formatOfferDate = (value?: string) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
    const storeLabel = selectedSourceId === "gog" ? "Open on GOG" : selectedSourceId === "steam" ? "Open on Steam" : selectedSourceId === "epic" ? "Open on Epic Games" : selectedSource.label;

    return (
      <div className="mn-detail-page flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-y-auto">
        {/* Sticky Header */}
        <div className="p-4 px-6 border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between shadow-xs">
          <button
            onClick={() => setSelectedGame(null)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs border border-slate-200"
          >
            <ArrowLeft className={`w-4 h-4 ${selectedGame.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-600'}`} />
            <span>Back to Store Feed</span>
          </button>
          <span className="text-xs border px-3.5 py-1.5 rounded-lg font-bold" style={{background:"var(--mn-accent-soft)",color:"var(--mn-accent-strong)",borderColor:"var(--mn-accent-border)"}}>
            {selectedSource.label}
          </span>
        </div>

        {/* Page Body */}
        <div className="max-w-6xl mx-auto w-full p-6 space-y-8">

          {/* Hero Card */}
          <div className={`mn-detail-hero p-6 rounded-3xl bg-white border border-slate-200/90 flex flex-col md:flex-row gap-8 items-start shadow-md ${selectedSourceId === 'fitgirl' ? 'mn-detail-hero-fitgirl' : ''}`}>
            {/* Cover */}
            <div className={`mn-detail-cover w-full md:w-64 h-80 bg-slate-100 rounded-2xl p-2 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden shadow-inner ${selectedSourceId === 'fitgirl' ? 'mn-detail-cover-fitgirl' : ''}`}>
              {displayCover ? (
                <img
                  src={displayCover}
                  alt={selectedGame.title}
                  className={`max-h-full max-w-full object-contain rounded-xl shadow-md ${selectedSourceId === 'fitgirl' ? 'mn-detail-cover-image-fitgirl' : ''}`}
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

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-medium">
                  <span>Category: <strong style={{color:"var(--mn-text)"}}>{selectedGame.category || "Game"}</strong></span>
                  {(currentDetails?.developer || selectedGame.developer) && <span>Developer: <strong style={{color:"var(--mn-text)"}}>{currentDetails?.developer || selectedGame.developer}</strong></span>}
                  {(currentDetails?.publisher || selectedGame.publisher) && <span>Publisher: <strong style={{color:"var(--mn-text)"}}>{currentDetails?.publisher || selectedGame.publisher}</strong></span>}
                  {(currentDetails?.releaseDate || selectedGame.releaseDate) && <span>Released: <strong style={{color:"var(--mn-text)"}}>{currentDetails?.releaseDate || selectedGame.releaseDate}</strong></span>}
                  {(currentDetails?.platforms || []).length > 0 && <span>Platforms: <strong style={{color:"var(--mn-text)"}}>{currentDetails?.platforms?.join(", ")}</strong></span>}
                  <a href={currentDetails?.storeLink || selectedGame.siteUrl} target="_blank" rel="noopener noreferrer" className="font-bold flex items-center gap-1" style={{color:"var(--mn-accent)"}}>
                    {storeLabel} <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Download Link Section */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className={`w-4 h-4 ${selectedGame.siteBadge === 'EROLABS' ? 'text-rose-600' : 'text-emerald-600'}`} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{color:"var(--mn-text-secondary)"}}>
                    {isOfficialStore ? selectedSource.kind === "giveaway" ? "Official giveaway availability" : "Official store availability" : selectedSource.kind === "direct" ? "Direct download" : selectedSource.kind === "repack" ? "Torrent download" : "Download"}
                  </span>
                </div>

                {/* How to use tip */}
                {isOfficialStore ? (
                  <div className="rounded-xl p-4 text-xs space-y-2" style={{background:"var(--mn-accent-soft)",border:"1px solid var(--mn-accent-border)",color:"var(--mn-text)"}}>
                    <div className="flex items-center gap-2 font-bold">
                      <ShieldCheck className="w-4 h-4" style={{color:"var(--mn-accent-strong)"}}/>
                      {selectedSourceId === "epic" ? offerStatus === "upcoming" ? "Upcoming free offer" : "Free giveaway — claim before it ends" : selectedSourceId === "steam" ? "Free-to-play on Steam" : "Official GOG listing"}
                    </div>
                    {selectedSourceId === "epic" && (
                      <div className="space-y-1">
                        {offerStart && <p>{offerStatus === "upcoming" ? "Starts" : "Started"}: <strong>{formatOfferDate(offerStart)}</strong></p>}
                        {offerEnd && <p>Offer ends: <strong>{formatOfferDate(offerEnd)}</strong></p>}
                      </div>
                    )}
                    <p style={{color:"var(--mn-text-secondary)"}}>{selectedSource.installNote}</p>
                    <a href={currentDetails?.storeLink || selectedGame.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-bold text-white" style={{background:"var(--mn-accent)"}}>
                      {storeLabel} <ExternalLink className="w-3.5 h-3.5"/>
                    </a>
                  </div>
                ) : selectedGame.siteBadge === 'EROLABS' ? (
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
                  isOfficialStore ? (
                    <div className="rounded-xl p-4 space-y-2" style={{background:"var(--mn-panel)",border:"1px solid var(--mn-border)"}}>
                      <p className="text-xs font-bold" style={{color:"var(--mn-text)"}}>{selectedSource.kind === "giveaway" ? "Claim through the Epic Games Store" : selectedSource.kind === "store" ? "Install through the official store" : "Official store installation"}</p>
                      <p className="text-xs leading-5" style={{color:"var(--mn-text-secondary)"}}>{selectedSource.installNote}</p>
                      {selectedSourceId === "epic" && offerEnd && <p className="text-xs font-semibold" style={{color:"var(--mn-accent-strong)"}}>Claim deadline: {formatOfferDate(offerEnd)}</p>}
                      <a href={currentDetails?.storeLink || selectedGame.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white" style={{background:"var(--mn-accent)"}}>{storeLabel}<ExternalLink className="w-3.5 h-3.5"/></a>
                    </div>
                  ) : selectedGame.siteBadge === 'GOG' ? (
                    <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-900 text-xs space-y-2">
                      <p className="font-bold">GOG account authorization is required for the installer.</p>
                      <p>We can show the free-game listing and full public details here. To claim the title and access its signed installer link, open the official GOG store page and use your own GOG account.</p>
                      <a href={selectedGame.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-bold px-4 py-2">Open on GOG <ExternalLink className="w-3.5 h-3.5" /></a>
                    </div>
                  ) : selectedGame.siteBadge === 'EROLABS' ? (
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
                {currentDetails?.description || selectedGame.description}
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
          siteBadge={selectedGame.siteBadge || (source === 'erolabs' ? 'EROLABS' : source === 'gog' ? 'GOG' : 'FITGIRL')}
          onConfirmNow={handleConfirmDownloadNow}
          onConfirmSchedule={handleConfirmSchedule}
        />
      </div>
    );
  }

  // ─── STORE FEED / GRID VIEW ─────────────────────────────────────────────────
  return (
    <div className="mn-browser-layout">
      <div className="mn-browser-main">
      {/* Search Bar */}
      <div className="mn-browser-toolbar">
        <div className="mn-discover-header">
          <div className="mn-discover-heading">
            <div>
              <p className="mn-eyebrow">{isUniversalSearch ? "ALL SOURCES · ONE SEARCH" : "GAME DISCOVERY"}</p>
              <h1>{isUniversalSearch ? "Universal Search" : "Discover games"}</h1>
            </div>
          </div>

          {!isUniversalSearch && <div className="mn-source-switcher">
            <div className="mn-source-switcher-heading">
              <span>Browse by source</span>
              <span className="mn-source-switcher-group">{currentSource.group === "official" ? "Official stores" : "Community catalogs"}</span>
            </div>
            <div className="mn-source-tabs" role="group" aria-label="Choose game catalog">
              {GAME_SOURCES.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  className={`mn-source-tab ${source === definition.id ? "active" : ""}`}
                  onClick={() => handleSwitchSource(definition.id)}
                  aria-pressed={source === definition.id}
                >
                  <span className={`mn-source-tab-icon ${source === definition.id ? sourceTone[definition.badgeColor] : ""}`}>
                    {definition.id === "fitgirl" ? <Package className="w-4 h-4" /> :
                     definition.id === "erolabs" ? <Download className="w-4 h-4" /> :
                     definition.id === "epic" ? <Gift className="w-4 h-4" /> :
                     <Store className="w-4 h-4" />}
                  </span>
                  <span className="mn-source-tab-label">{definition.shortLabel}</span>
                  <span className="mn-source-tab-check" aria-hidden="true">✓</span>
                </button>
              ))}
            </div>
          </div>}

          {isUniversalSearch && (
            <div className="mn-universal-sources" aria-label="Sources searched">
              {GAME_SOURCES.map((definition) => (
                <span className="mn-universal-source-chip" key={definition.id}>
                  <span className={`mn-universal-source-dot ${sourceTone[definition.badgeColor] || "bg-slate-500"}`} />
                  {definition.shortLabel}
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSearchSubmit} className="mn-search-row">
            <div className="mn-search-field">
              <Search className="w-5 h-5 shrink-0" />
              <input
                type="search"
                placeholder={isUniversalSearch ? "Search games across every connected source…" : `Search ${currentSource.shortLabel} games…`}
                aria-label={isUniversalSearch ? "Search all connected game sources" : `Search games in ${currentSource.label}`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="mn-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
            <button type="submit" disabled={loading} className="mn-button-primary mn-search-submit">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>{loading ? "Searching" : "Search"}</span>
            </button>
          </form>

        </div>
      </div>

      {/* Grid Feed */}
      <div className="mn-browser-feed">
        <div className="mn-discover-results max-w-7xl mx-auto">
          {isUniversalSearch && universalUnavailableSources.length > 0 && universalFeed.loaded && !loading && (
            <div className="mn-universal-partial-notice" role="status">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Some sources could not be reached: {universalUnavailableSources.join(", ")}. Results from the other sources are still available.</span>
            </div>
          )}
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
              <p className="text-sm font-semibold text-slate-600">Loading games…</p>
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
                onClick={() => isUniversalSearch ? fetchUniversalFeed(searchQuery, 1, false) : fetchFeed(searchQuery, 1, false, source)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all flex items-center gap-2 shadow-xs cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {!loading && !error && games.length === 0 && (isUniversalSearch ? universalFeed.loaded : true) && (
            <div className="text-center py-20 text-slate-500">
              <Gamepad2 className="w-12 h-12 text-emerald-300 mx-auto mb-4" />
              <p className="text-lg font-bold text-slate-700">{isUniversalSearch ? "No matching games found" : "No games found"}</p>
              <p className="text-sm mt-1 text-slate-500">Try another title or a shorter search phrase</p>
            </div>
          )}
          {!loading && !error && isUniversalSearch && !universalFeed.loaded && games.length === 0 && (
            <div className="mn-universal-empty">
              <div className="mn-universal-empty-icon"><Globe2 className="w-7 h-7" /></div>
              <h2>One search. Every source.</h2>
              <p>Search every connected game catalog from one place.</p>
              <div className="mn-universal-empty-sources">
                {GAME_SOURCES.map((item) => <span key={item.id}>{item.shortLabel}</span>)}
              </div>
            </div>
          )}

          {!loading && games.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-slate-900">
                  {searchQuery ? `Results for "${searchQuery}"` : isUniversalSearch ? "Universal results" : source === "epic" ? "Current and upcoming giveaways" : source === "steam" ? "Free-to-play games" : source === "gog" ? "Free games" : "Popular games"}
                </h2>
              </div>

              {/* Cards Grid */}
              <div className={`mn-games-grid ${!isUniversalSearch && ['fitgirl', 'gog'].includes(source) ? 'mn-games-grid-provider' : ''}`} key={isUniversalSearch ? "universal" : source}>
                {games.map((game, index) => (
                  <button
                    type="button"
                    key={game.id}
                    onClick={() => handleOpenGameDetails(game)}
                    aria-label={`Open details for ${game.title}`}
                    className="mn-game-card mn-game-card-enter group flex flex-col text-left cursor-pointer w-full"
                    style={{ "--mn-card-index": Math.min(index, 9) } as React.CSSProperties}
                  >
                    {/* Cover */}
                    <div className="mn-game-cover relative">
                      {game.cover ? (
                        <img
                          src={game.cover}
                          alt={game.title}
                          loading="lazy"
                          decoding="async"
                          className="mn-game-cover-image"
                          onLoad={(e) => {
                            const image = e.currentTarget;
                            const hasNaturalSize = image.naturalWidth > 0 && image.naturalHeight > 0;
                            const ratio = hasNaturalSize
                              ? (['fitgirl', 'gog'].includes(game.sourceId || source)
                                  ? image.naturalWidth / image.naturalHeight
                                  : Math.min(1.85, Math.max(0.58, image.naturalWidth / image.naturalHeight)))
                              : 0.72;
                            if (image.parentElement && Number.isFinite(ratio) && ratio > 0) {
                              image.parentElement.style.aspectRatio = `${ratio.toFixed(4)} / 1`;
                            }
                          }}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center">
                          <Gamepad2 className="w-10 h-10 text-emerald-600" />
                          <span className="text-xs font-bold text-slate-600 line-clamp-2">{game.title}</span>
                        </div>
                      )}

                      <div className={`mn-card-source-badge absolute top-3 left-3 ${sourceTone[getSource(game.sourceId || source).badgeColor] || "bg-slate-600"} text-white text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider shadow-sm`}>
                        {game.siteBadge || "FITGIRL"}
                      </div>

                      {/* Multiplayer Badge */}
                      {isMultiplayer(game, detailsLoaded[game.id]) && (
                        <div className="mn-card-multiplayer-badge absolute top-3 right-3 bg-indigo-600/95 backdrop-blur-md text-white text-[10px] font-extrabold px-2 py-1 rounded-md uppercase tracking-wider shadow-sm flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span>MULTIPLAYER</span>
                        </div>
                      )}

                      {game.sourceAction === "official-store" ? (
                        <div className="mn-card-meta-pill absolute bottom-3 right-3 rounded-lg border px-2.5 py-1 text-[10px] font-bold shadow-sm" style={{background:"var(--mn-panel)",borderColor:"var(--mn-border)",color:"var(--mn-accent-strong)"}}>
                          {game.siteBadge === "EPIC" ? game.offerStatus === "upcoming" ? "UPCOMING OFFER" : "FREE NOW" : game.siteBadge === "STEAM" ? "FREE-TO-PLAY" : "FREE GAME"}
                        </div>
                      ) : game.size && game.size !== "Repack" && (
                        <div className="mn-card-meta-pill absolute bottom-3 right-3 rounded-lg border px-2.5 py-1 text-[10px] font-bold shadow-sm" style={{background:"var(--mn-panel)",borderColor:"var(--mn-border)",color:"var(--mn-text-secondary)"}}>
                          <HardDrive className="w-3.5 h-3.5 inline mr-1.5" />
                          {exactSizes[game.id] ? formatSize(exactSizes[game.id]) : game.size}
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="mn-card-body flex-1">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm line-clamp-2 group-hover:text-emerald-700 transition-colors leading-snug">
                          {game.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-2 line-clamp-1 font-medium">
                          {game.category || 'Lossless Repack'}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t flex items-center justify-between gap-2 text-[11px]" style={{borderColor:"var(--mn-border)"}}>
                        <span className="font-semibold flex items-center gap-1.5 min-w-0" style={{color:"var(--mn-text-secondary)"}}>
                          {game.sourceAction === "official-store" ? <Store className="w-3.5 h-3.5 shrink-0"/> : game.siteBadge === "EROLABS" ? <HardDrive className="w-3.5 h-3.5 shrink-0"/> : <Copy className="w-3.5 h-3.5 shrink-0"/>}
                          <span className="truncate">
                            {game.siteBadge === "EROLABS" ? "Direct download" : game.siteBadge === "FITGIRL" ? "Torrent repack" : game.siteBadge === "GOG" ? "GOG store" : game.siteBadge === "STEAM" ? "Steam client" : game.offerStatus === "upcoming" ? "Upcoming giveaway" : "Claim on Epic"}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 font-bold shrink-0" style={{color:"var(--mn-accent)"}}>
                          <span>Details</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div ref={autoLoadSentinelRef} className="mn-auto-load-sentinel" aria-live="polite">
                {loadingMore && <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading more games" />}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};