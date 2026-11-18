import axios from 'axios';
import * as cheerio from 'cheerio';
import { GameItem, GameDownloadOption } from '../types';

const BASE_URL = 'https://www.ero-labs.com';
const API_BASE = 'https://www.ero-labs.com/api/v2';
const SINGLE_GAME_API = 'https://www.ero-labs.com/api/getSingleHGame';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.ero-labs.com/en/games.html',
  'Origin': 'https://www.ero-labs.com',
};

// ─── EroLabs API Response types ──────────────────────────────────────────────

interface EroLabsGameListItem {
  gameId: number;
  gameType: number;
  indexIcon: string;
  name: string;
  brief: string;
  gameUrl: string;
  language: Array<{ id: number; name: string }>;
  gameGenre: Array<{ id: number; name: string }>;
  gameTags: Array<{ id: number; name: string }>;
  device: Array<{ id: number; name: string }>;
  isCollected: boolean;
  isRelease: boolean;
  isComingSoon: boolean;
  discount: number;
}

// In-memory cache for game details so we don't refetch repeatedly
const gameDetailsCache = new Map<number, any>();

async function getGameSingleData(gameId: number): Promise<any | null> {
  if (gameDetailsCache.has(gameId)) {
    return gameDetailsCache.get(gameId);
  }

  try {
    const formParams = new URLSearchParams();
    formParams.append('lang', 'en');
    formParams.append('id', String(gameId));

    const apiRes = await axios.post(SINGLE_GAME_API, formParams, {
      headers: {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': `${BASE_URL}/en/games.html`,
        'Origin': BASE_URL,
      },
      timeout: 8000,
    });

    if (apiRes.data && apiRes.data.data) {
      const g = Array.isArray(apiRes.data.data) ? apiRes.data.data[0] : apiRes.data.data;
      if (g) {
        gameDetailsCache.set(gameId, g);
        return g;
      }
    }
  } catch {
    // Ignore single failure
  }
  return null;
}

function extractWindowsSize(d: any): string {
  if (!d) return '';
  if (Array.isArray(d.fileSizes)) {
    const winObj = d.fileSizes.find((f: any) => f && f.type === 'windows_size');
    if (winObj && winObj.size) {
      return String(winObj.size);
    }
    const anySize = d.fileSizes.find((f: any) => f && f.size);
    if (anySize && anySize.size) return String(anySize.size);
  }
  return '';
}

// ─── Fetch game list from the official API ───────────────────────────────────

export async function fetchErolabsPopular(page: number = 1): Promise<GameItem[]> {
  try {
    // EroLabs API — games list (hotSort), PC/Windows device ID 5
    const url = new URL(`${API_BASE}/game/list`);
    url.searchParams.set('lang', 'en');
    url.searchParams.append('gameType[]', '0');  // 0 = all game types
    url.searchParams.set('gameSortType', 'hotSort');
    url.searchParams.append('gameDeviceIds[]', '5');
    
    // Page offset (each page = 30 games)
    if (page > 1) {
      url.searchParams.set('offset', String((page - 1) * 30));
    }

    const res = await axios.get(url.toString(), { headers: DEFAULT_HEADERS, timeout: 15000 });

    if (!res.data || res.data.status !== 'SUCCESS' || !res.data.data?.game) {
      return [];
    }

    const gameList: EroLabsGameListItem[] = res.data.data.game;

    // Filter strictly for games stating Windows support
    const windowsGames = gameList.filter((g) =>
      g.device && g.device.some((d) => d.id === 5 || d.name?.toLowerCase().includes('windows'))
    );

    // Verify Windows download availability and fetch file sizes in parallel
    const resolvedList = await Promise.all(
      windowsGames.map(async (g) => {
        const details = await getGameSingleData(g.gameId);
        // Only keep if game has an actual Windows download URL or demo URL
        const hasWindowsDownload = Boolean(
          (details?.windows_url && details.windows_url.trim()) ||
          (details?.windows_demo_url && details.windows_demo_url.trim())
        );

        if (!hasWindowsDownload) {
          return null;
        }

        const cleanUrlPath = g.gameUrl.replace(/^\/+/, '');
        const gamePageUrl = cleanUrlPath.startsWith('http') ? cleanUrlPath : `${BASE_URL}/en/${cleanUrlPath}`;
        const genres = g.gameGenre ? g.gameGenre.map((genre) => genre.name) : [];
        const winSize = extractWindowsSize(details);

        return {
          id: `ero-${g.gameId}`,
          title: g.name,
          cover: g.indexIcon || '',
          size: winSize || 'Windows Game',
          repackSizeStr: winSize,
          repacker: 'EROLABS',
          siteBadge: 'EROLABS',
          siteUrl: gamePageUrl,
          category: genres.join(', ') || 'Adult Game',
          description: g.brief || '',
          releaseDate: '',
          screenshots: g.indexIcon ? [g.indexIcon] : [],
          downloads: [],
        } as GameItem;
      })
    );

    return resolvedList.filter((item): item is GameItem => item !== null);
  } catch (err: any) {
    console.error('[EroLabs] Error fetching game list:', err.message);
    return [];
  }
}

// ─── Search games ─────────────────────────────────────────────────────────────

export async function searchErolabs(query: string, page: number = 1): Promise<GameItem[]> {
  if (!query || !query.trim()) {
    return fetchErolabsPopular(page);
  }

  try {
    const url = new URL(`${API_BASE}/game/list`);
    url.searchParams.set('lang', 'en');
    url.searchParams.append('gameType[]', '0');
    url.searchParams.set('gameSortType', 'hotSort');
    url.searchParams.append('gameDeviceIds[]', '5');
    url.searchParams.set('keyword', query.trim());

    const res = await axios.get(url.toString(), { headers: DEFAULT_HEADERS, timeout: 15000 });

    if (!res.data || res.data.status !== 'SUCCESS' || !res.data.data?.game) {
      return [];
    }

    const gameList: EroLabsGameListItem[] = res.data.data.game;
    const windowsGames = gameList.filter((g) =>
      g.device && g.device.some((d) => d.id === 5 || d.name?.toLowerCase().includes('windows'))
    );

    const resolvedList = await Promise.all(
      windowsGames.map(async (g) => {
        const details = await getGameSingleData(g.gameId);
        const hasWindowsDownload = Boolean(
          (details?.windows_url && details.windows_url.trim()) ||
          (details?.windows_demo_url && details.windows_demo_url.trim())
        );

        if (!hasWindowsDownload) {
          return null;
        }

        const cleanUrlPath = g.gameUrl.replace(/^\/+/, '');
        const gamePageUrl = cleanUrlPath.startsWith('http') ? cleanUrlPath : `${BASE_URL}/en/${cleanUrlPath}`;
        const genres = g.gameGenre ? g.gameGenre.map((genre) => genre.name) : [];
        const winSize = extractWindowsSize(details);

        return {
          id: `ero-${g.gameId}`,
          title: g.name,
          cover: g.indexIcon || '',
          size: winSize || 'Windows Game',
          repackSizeStr: winSize,
          repacker: 'EROLABS',
          siteBadge: 'EROLABS',
          siteUrl: gamePageUrl,
          category: genres.join(', ') || 'Adult Game',
          description: g.brief || '',
          releaseDate: '',
          screenshots: g.indexIcon ? [g.indexIcon] : [],
          downloads: [],
        } as GameItem;
      })
    );

    return resolvedList.filter((item): item is GameItem => item !== null);
  } catch (err: any) {
    console.error('[EroLabs] Error searching games:', err.message);
    return [];
  }
}

// ─── Fetch game details using Official EroLabs API (getSingleHGame) ───────────

export async function fetchErolabsGameDetails(siteUrl: string): Promise<{
  downloads: GameDownloadOption[];
  description: string;
  developer: string;
  releaseDate: string;
  platforms: string[];
  screenshots: string[];
  tags: string[];
  cover: string;
  repackSizeStr?: string;
  size?: string;
}> {
  const fallback = {
    downloads: [] as GameDownloadOption[],
    description: '',
    developer: '',
    releaseDate: '',
    platforms: [] as string[],
    screenshots: [] as string[],
    tags: [] as string[],
    cover: '',
    repackSizeStr: '',
    size: '',
  };

  try {
    // 1. Resolve game ID from URL
    let gameId: string | null = null;
    const urlMatch = siteUrl.match(/[?&]id=(\d+)/i) || siteUrl.match(/\/game\/(\d+)/i);
    if (urlMatch) {
      gameId = urlMatch[1];
    } else {
      const pageRes = await axios.get(siteUrl, {
        headers: {
          'User-Agent': DEFAULT_HEADERS['User-Agent'],
          'Referer': `${BASE_URL}/en/games.html`,
        },
        timeout: 8000,
      });

      const $ = cheerio.load(pageRes.data);
      gameId = $('meta[name="id"]').attr('content') || null;
    }

    if (!gameId) {
      console.warn('[EroLabs] Could not find gameId for:', siteUrl);
      return fallback;
    }

    // 2. Query or get from cache
    const g = await getGameSingleData(parseInt(gameId, 10));
    if (!g) return fallback;

    // 3. Extract direct download links - ONLY Windows, NO Android APK!
    const downloads: GameDownloadOption[] = [];

    if (g.windows_url && g.windows_url.trim()) {
      downloads.push({
        type: 'direct',
        label: 'Download for Windows',
        url: g.windows_url.trim(),
        speedEstimate: 'Windows Full',
      });
    }

    if (g.windows_demo_url && g.windows_demo_url.trim()) {
      downloads.push({
        type: 'direct',
        label: 'Download Windows Demo',
        url: g.windows_demo_url.trim(),
        speedEstimate: 'Windows Demo',
      });
    }

    // 4. Extract screenshots
    const screenshots: string[] = [];
    if (Array.isArray(g.imgList)) {
      for (const item of g.imgList) {
        if (item && item.file) {
          screenshots.push(item.file);
        }
      }
    }

    // 5. Clean description & extract size
    let description = g.brief || g.intro || '';
    description = description.replace(/<[^>]*>?/gm, '').trim();
    const winSize = extractWindowsSize(g);

    return {
      downloads,
      description,
      developer: g.developer || '',
      releaseDate: g.release_date || '',
      platforms: ['windows'],
      screenshots: screenshots.slice(0, 8),
      tags: Array.isArray(g.labelList) ? g.labelList.map((l: any) => l.name) : [],
      cover: g.index_icon || '',
      repackSizeStr: winSize,
      size: winSize,
    };
  } catch (err: any) {
    console.error('[EroLabs] Error fetching game details via official API:', err.message);
    return fallback;
  }
}
