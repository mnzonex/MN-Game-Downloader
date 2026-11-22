import axios from "axios";
import { load } from "cheerio";
import type { GameItem } from "../types";
import { SOURCE_PAGE_SIZE } from "../sources/registry";

const SEARCH_URL = "https://store.steampowered.com/search/results/";
const DETAILS_URL = "https://store.steampowered.com/api/appdetails";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json,text/html,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};
const RAW_BATCH_SIZE = 25;
const CACHE_TTL = 15 * 60_000;

interface SteamSearchRow {
  id: string;
  title: string;
  cover: string;
  released: string;
  reviewSummary: string;
  reviewPercent?: number;
  freeLabel: boolean;
}

interface SteamAppDetails {
  type?: string;
  name?: string;
  is_free?: boolean;
  short_description?: string;
  detailed_description?: string;
  about_the_game?: string;
  header_image?: string;
  developers?: string[];
  publishers?: string[];
  genres?: Array<{ id?: string; description?: string }>;
  categories?: Array<{ id?: number; description?: string }>;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  screenshots?: Array<{ path_full?: string; path_thumbnail?: string }>;
  release_date?: { coming_soon?: boolean; date?: string };
  website?: string | null;
  price_overview?: { final_formatted?: string };
}

interface FeedState {
  games: GameItem[];
  nextStart: number;
  exhausted: boolean;
  loading: Promise<void> | null;
  expiresAt: number;
}

export interface SteamCatalogPage {
  games: GameItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const feeds = new Map<string, FeedState>();
const detailCache = new Map<string, { expiresAt: number; value: SteamAppDetails | null }>();

function safeSteamStoreUrl(appId: string): string {
  if (!/^[0-9]{1,12}$/.test(appId)) throw new Error("Invalid Steam app ID.");
  return `https://store.steampowered.com/app/${appId}/`;
}

function parseSearchRows(html: string): SteamSearchRow[] {
  const $ = load(html);
  return $("a.search_result_row").map((_, element) => {
    const row = $(element);
    const id = String(row.attr("data-ds-appid") || "").split(",")[0];
    const text = row.text().replace(/\s+/g, " ").trim();
    const priceText = row.find(".search_price, .discount_final_price, .search_price_discount_combined")
      .text().replace(/\s+/g, " ").trim();
    const freeText = `${priceText} ${text}`;
    const reviewHtml = row.find(".search_review_summary").attr("data-tooltip-html") || "";
    const reviewSummary = load(reviewHtml).text().replace(/\s+/g, " ").trim();
    const percentMatch = reviewSummary.match(/(\d{1,3})%/);
    return {
      id,
      title: row.find(".title").first().text().trim(),
      cover: row.find(".search_capsule img").attr("src") || "",
      released: row.find(".search_released").text().trim(),
      reviewSummary,
      reviewPercent: percentMatch ? Number(percentMatch[1]) : undefined,
      freeLabel: /\bfree\b/i.test(freeText) && !/free weekend|free trial/i.test(freeText),
    };
  }).get().filter((row) => /^[0-9]{1,12}$/.test(row.id) && !!row.title && row.freeLabel);
}

async function fetchVerifiedDetails(appId: string): Promise<SteamAppDetails | null> {
  const cached = detailCache.get(appId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await axios.get(DETAILS_URL, {
      params: { appids: appId, cc: "US", l: "en" },
      headers: HEADERS,
      timeout: 12000,
      maxRedirects: 2,
      maxContentLength: 8 * 1024 * 1024,
    });
    const wrapper = response.data?.[appId];
    const details = wrapper?.success && wrapper?.data ? wrapper.data as SteamAppDetails : null;
    detailCache.set(appId, { expiresAt: Date.now() + CACHE_TTL, value: details });
    return details;
  } catch {
    return null;
  }
}

function isVerifiedWindowsFreeGame(details: SteamAppDetails | null): details is SteamAppDetails {
  return !!details
    && details.type === "game"
    && details.is_free === true
    && details.platforms?.windows === true;
}

function toGameItem(row: SteamSearchRow, details: SteamAppDetails): GameItem {
  const appId = row.id;
  const genres = (details.genres || [])
    .map((genre) => genre.description || "")
    .filter((genre) => genre && genre.toLowerCase() !== "free to play");
  const description = load(String(details.short_description || details.about_the_game || details.detailed_description || ""))
    .text().replace(/\s+/g, " ").trim();
  const storeUrl = safeSteamStoreUrl(appId);
  return {
    id: `steam-${appId}`,
    title: details.name || row.title,
    cover: details.header_image || row.cover,
    size: "Free-to-play",
    repackSizeStr: "",
    developer: Array.isArray(details.developers) ? details.developers.join(", ") : "",
    publisher: Array.isArray(details.publishers) ? details.publishers.join(", ") : "",
    repacker: "Steam",
    siteBadge: "STEAM",
    sourceId: "steam",
    sourceAction: "official-store",
    siteUrl: storeUrl,
    category: genres.slice(0, 3).join(", ") || "Free-to-play game",
    description: description.slice(0, 1200),
    releaseDate: details.release_date?.date || row.released || "",
    screenshots: (details.screenshots || [])
      .map((screenshot) => screenshot.path_full || screenshot.path_thumbnail || "")
      .filter((url) => url.startsWith("https://"))
      .slice(0, 8),
    downloads: [],
    isFreeToPlay: true,
    reviewSummary: row.reviewSummary,
    reviewPercent: row.reviewPercent,
  };
}

function getFeedState(query: string): FeedState {
  const key = query.toLowerCase();
  const existing = feeds.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing;
  const state: FeedState = {
    games: [],
    nextStart: 0,
    exhausted: false,
    loading: null,
    expiresAt: Date.now() + CACHE_TTL,
  };
  feeds.set(key, state);
  return state;
}

async function fetchRawSteamSearch(start: number, query: string): Promise<{ rows: SteamSearchRow[]; rawCount: number }> {
  const response = await axios.get(SEARCH_URL, {
    params: {
      // Steam Store search/results uses "term"; "query" is silently ignored
      // and returns the general catalogue instead of matching the user's search.
      term: query,
      start,
      count: RAW_BATCH_SIZE,
      dynamic_data: "",
      sort_by: "_ASC",
      filter: "free_to_play",
      snr: "1_7_7_230_7",
      infinite: 1,
    },
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 2,
    maxContentLength: 5 * 1024 * 1024,
  });

  const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
  if (payload?.success !== 1 || typeof payload?.results_html !== "string") {
    throw new Error("Steam Store did not return a valid free-to-play search response.");
  }
  const rows = parseSearchRows(payload.results_html);
  const $ = load(payload.results_html);
  const rawCount = $("a.search_result_row").length;
  return { rows, rawCount };
}

async function ensureSteamBatch(query: string, requestedPage: number): Promise<FeedState> {
  const state = getFeedState(query);
  const targetCount = requestedPage * SOURCE_PAGE_SIZE;
  let rawBatchesFetched = 0;

  while (state.games.length < targetCount && !state.exhausted && rawBatchesFetched < 8) {
    if (state.loading) {
      await state.loading;
      continue;
    }

    const start = state.nextStart;
    state.loading = (async () => {
      const response = await fetchRawSteamSearch(start, query);
      state.nextStart = start + Math.max(response.rawCount, RAW_BATCH_SIZE);
      if (response.rawCount === 0) state.exhausted = true;

      const knownIds = new Set(state.games.map((game) => game.id));
      const candidateRows = response.rows.filter((row) => !knownIds.has(`steam-${row.id}`));
      const verified = await Promise.all(candidateRows.map(async (row) => ({
        row,
        details: await fetchVerifiedDetails(row.id),
      })));

      for (const item of verified) {
        if (!isVerifiedWindowsFreeGame(item.details)) continue;
        const game = toGameItem(item.row, item.details);
        if (!knownIds.has(game.id)) {
          knownIds.add(game.id);
          state.games.push(game);
        }
      }
      if (response.rawCount < RAW_BATCH_SIZE) state.exhausted = true;
    })();

    try {
      await state.loading;
    } finally {
      state.loading = null;
    }
    rawBatchesFetched++;
  }

  return state;
}

async function getSteamBatch(query: string, page: number): Promise<SteamCatalogPage> {
  const normalizedPage = Math.max(1, Math.min(50, Math.floor(page) || 1));
  const normalizedQuery = query.trim().slice(0, 100);
  const state = await ensureSteamBatch(normalizedQuery, normalizedPage);
  const start = (normalizedPage - 1) * SOURCE_PAGE_SIZE;
  const games = state.games.slice(start, start + SOURCE_PAGE_SIZE);
  return {
    games,
    page: normalizedPage,
    pageSize: SOURCE_PAGE_SIZE,
    hasMore: state.games.length > start + games.length || !state.exhausted,
  };
}

export async function fetchSteamFreeGames(page = 1): Promise<SteamCatalogPage> {
  return getSteamBatch("", page);
}

export async function searchSteamFreeGames(query: string, page = 1): Promise<SteamCatalogPage> {
  return getSteamBatch(query, page);
}

export async function fetchSteamGameDetails(appId: string): Promise<{
  description: string;
  developer: string;
  publisher: string;
  releaseDate: string;
  platforms: string[];
  screenshots: string[];
  cover: string;
  storeLink: string;
  isFreeToPlay: boolean;
}> {
  if (!/^[0-9]{1,12}$/.test(appId)) throw new Error("Invalid Steam app ID.");
  const details = await fetchVerifiedDetails(appId);
  if (!isVerifiedWindowsFreeGame(details)) throw new Error("Steam no longer marks this title as a free Windows game.");

  const genres = (details.genres || []).map((genre) => genre.description || "");
  return {
    description: load(String(details.detailed_description || details.about_the_game || details.short_description || ""))
      .text().replace(/\s+/g, " ").trim(),
    developer: (details.developers || []).join(", "),
    publisher: (details.publishers || []).join(", "),
    releaseDate: details.release_date?.date || "",
    platforms: Object.entries(details.platforms || {})
      .filter(([, enabled]) => enabled === true)
      .map(([platform]) => platform),
    screenshots: (details.screenshots || [])
      .map((screenshot) => screenshot.path_full || screenshot.path_thumbnail || "")
      .filter((url) => url.startsWith("https://"))
      .slice(0, 8),
    cover: details.header_image || "",
    storeLink: safeSteamStoreUrl(appId),
    isFreeToPlay: genres.some((genre) => genre.toLowerCase() === "free to play") || details.is_free === true,
  };
}