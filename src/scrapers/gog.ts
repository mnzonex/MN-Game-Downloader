import axios from "axios";
import { load } from "cheerio";
import type { GameDownloadOption, GameItem } from "../types";
import { SOURCE_PAGE_SIZE } from "../sources/registry";

const CATALOG_URL = "https://catalog.gog.com/v1/catalog";
const API_URL = "https://api.gog.com";
const STORE_URL = "https://www.gog.com";
const HEADERS = {
  "User-Agent": "MN-Game-Downloader/1.2.10",
  "Accept": "application/json",
};

type GogTag = { name?: string; slug?: string };
type GogProduct = {
  id?: number | string;
  title?: string;
  slug?: string;
  productType?: string;
  operatingSystems?: string[];
  coverHorizontal?: string;
  coverVertical?: string;
  screenshots?: string[];
  releaseDate?: string;
  storeReleaseDate?: string;
  storeLink?: string;
  genres?: Array<{ name?: string; slug?: string } | string>;
  tags?: GogTag[];
  developers?: string[];
  publishers?: string[];
  ratings?: Array<{ name?: string; ageRating?: string | number }>;
  price?: { final?: string };
};

type CatalogState = {
  games: GameItem[];
  nextRawPage: number;
  rawPageCount: number;
  exhausted: boolean;
  loading: Promise<void> | null;
  expiresAt: number;
};

export interface GogCatalogPage {
  games: GameItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const catalogStates = new Map<string, CatalogState>();
const detailsCache = new Map<string, { expiresAt: number; value: ReturnTypeDetails }>();
const CATALOG_TTL = 10 * 60_000;
const MAX_RAW_PAGES_PER_REQUEST = 8;

function safeStoreUrl(value: unknown, slug?: string): string {
  const fallback = `${STORE_URL}/game/${encodeURIComponent(slug || "")}`;
  try {
    const url = new URL(typeof value === "string" ? value : fallback);
    if (url.protocol !== "https:" || !["gog.com", "www.gog.com"].includes(url.hostname.toLowerCase())) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function formatGogDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function normalizedTag(tag: GogTag | string): string {
  return (typeof tag === "string" ? tag : tag.slug || tag.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isEligibleFreeWindowsGame(product: GogProduct): boolean {
  if (!product.id || !product.title || product.productType !== "game") return false;
  if (!Array.isArray(product.operatingSystems) || !product.operatingSystems.includes("windows")) return false;

  const title = product.title.trim();
  if (/^(test|testing)\b|\b(demo|editor|redkit|sdk|toolkit)\b/i.test(title)) return false;

  const tags = (product.tags || []).map(normalizedTag);
  const isTaggedFree = tags.includes("freegame") || tags.includes("free");
  const restrictedContent = tags.some((tag) =>
    /demo|adult|sexualcontent|nudity|nsfw|hentai|erotic|mature|testbuild/.test(tag)
  );
  const adultsOnly = (product.ratings || []).some((rating) => {
    const value = Number.parseInt(String(rating.ageRating || ""), 10);
    return Number.isFinite(value) && value >= 18;
  });

  return isTaggedFree && !restrictedContent && !adultsOnly;
}

function toGameItem(product: GogProduct): GameItem {
  const id = String(product.id);
  const genres = (product.genres || [])
    .map((genre) => typeof genre === "string" ? genre : genre.name || "")
    .filter(Boolean);

  return {
    id: `gog-${id}`,
    title: product.title || "Unknown GOG game",
    cover: product.coverVertical || product.coverHorizontal || "",
    size: "Free game",
    repackSizeStr: "",
    developer: Array.isArray(product.developers) ? product.developers.join(", ") : "",
    publisher: Array.isArray(product.publishers) ? product.publishers.join(", ") : "",
    repacker: "GOG",
    siteBadge: "GOG",
    sourceId: "gog",
    sourceAction: "official-store",
    siteUrl: safeStoreUrl(product.storeLink, product.slug),
    category: genres.slice(0, 3).join(", ") || "Free PC Game",
    description: "Official GOG free-game listing. Secure installers are available through your own GOG account.",
    releaseDate: formatGogDate(product.releaseDate || product.storeReleaseDate),
    screenshots: Array.isArray(product.screenshots)
      ? product.screenshots.filter((url) => typeof url === "string" && url.startsWith("https://")).slice(0, 8)
      : [],
    downloads: [],
    isFreeToPlay: false,
  };
}

function getCatalogState(query: string): CatalogState {
  const key = query.toLowerCase();
  const existing = catalogStates.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing;

  const state: CatalogState = {
    games: [],
    nextRawPage: 1,
    rawPageCount: 1,
    exhausted: false,
    loading: null,
    expiresAt: Date.now() + CATALOG_TTL,
  };
  catalogStates.set(key, state);
  return state;
}

async function fetchRawCatalogPage(page: number, query: string): Promise<{ products: GogProduct[]; pages: number }> {
  const url = new URL(CATALOG_URL);
  url.searchParams.set("limit", "48");
  url.searchParams.set("page", String(page));
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("locale", "en-US");
  url.searchParams.set("currencyCode", "USD");
  url.searchParams.set("price", "between:0,0");
  url.searchParams.set("productType", "in:game");
  url.searchParams.set("tags", "like:freegame");
  if (query) url.searchParams.set("query", `like:${query}`);

  const response = await axios.get(url.toString(), {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 0,
    maxContentLength: 8 * 1024 * 1024,
  });

  return {
    products: Array.isArray(response.data?.products) ? response.data.products as GogProduct[] : [],
    pages: Math.max(1, Number(response.data?.pages || 1)),
  };
}

async function ensureCatalogPage(query: string, requestedPage: number): Promise<CatalogState> {
  const state = getCatalogState(query);
  const targetCount = requestedPage * SOURCE_PAGE_SIZE;
  let rawPagesFetched = 0;

  while (state.games.length < targetCount && !state.exhausted && rawPagesFetched < MAX_RAW_PAGES_PER_REQUEST) {
    if (state.loading) {
      await state.loading;
      continue;
    }

    // GOG's first raw catalog pages contain many demos and non-Windows items.
    // Fetch a small, bounded batch in parallel, then preserve provider page order
    // when adding eligible games to the cached catalog.
    const remaining = targetCount - state.games.length;
    const batchSize = state.nextRawPage === 1
      ? Math.min(4, MAX_RAW_PAGES_PER_REQUEST - rawPagesFetched)
      : Math.min(3, Math.max(1, Math.ceil(remaining / 4)), MAX_RAW_PAGES_PER_REQUEST - rawPagesFetched);
    const firstRawPage = state.nextRawPage;
    const rawPages = Array.from({ length: batchSize }, (_, index) => firstRawPage + index)
      .filter((page) => page <= Math.max(state.rawPageCount, firstRawPage + batchSize - 1));

    if (rawPages.length === 0) {
      state.exhausted = true;
      break;
    }

    state.loading = (async () => {
      const responses = await Promise.all(rawPages.map((rawPage) => fetchRawCatalogPage(rawPage, query)));
      const knownIds = new Set(state.games.map((game) => game.id));

      for (const response of responses) {
        state.rawPageCount = Math.max(state.rawPageCount, response.pages);
        for (const product of response.products) {
          if (!isEligibleFreeWindowsGame(product)) continue;
          const game = toGameItem(product);
          if (knownIds.has(game.id)) continue;
          knownIds.add(game.id);
          state.games.push(game);
        }
      }

      state.nextRawPage = rawPages[rawPages.length - 1] + 1;
      if (state.nextRawPage > state.rawPageCount) state.exhausted = true;
    })();

    try {
      await state.loading;
    } finally {
      state.loading = null;
    }
    rawPagesFetched += rawPages.length;
  }

  return state;
}

async function getCatalogBatch(query: string, page: number): Promise<GogCatalogPage> {
  const normalizedPage = Math.max(1, Math.min(50, Math.floor(page) || 1));
  const normalizedQuery = query.trim().slice(0, 100);
  const state = await ensureCatalogPage(normalizedQuery, normalizedPage);
  const start = (normalizedPage - 1) * SOURCE_PAGE_SIZE;
  const games = state.games.slice(start, start + SOURCE_PAGE_SIZE);
  const hasMore = state.games.length > start + games.length || !state.exhausted;
  return { games, page: normalizedPage, pageSize: SOURCE_PAGE_SIZE, hasMore };
}

export async function fetchGogFreeGames(page = 1): Promise<GogCatalogPage> {
  return getCatalogBatch("", page);
}

export async function searchGogFreeGames(query: string, page = 1): Promise<GogCatalogPage> {
  return getCatalogBatch(query, page);
}

export async function fetchGogGameDetails(productId: string): Promise<{
  downloads: GameDownloadOption[];
  description: string;
  developer: string;
  publisher: string;
  releaseDate: string;
  platforms: string[];
  screenshots: string[];
  tags: string[];
  cover: string;
  size: string;
  storeLink: string;
  requiresGogAccount: boolean;
}> {
  if (!/^[0-9]{5,15}$/.test(productId)) throw new Error("Invalid GOG product ID.");
  const cached = detailsCache.get(productId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [productResponse, gameResponse] = await Promise.all([
    axios.get(
      `${API_URL}/products/${productId}?locale=en_US&expand=downloads,screenshots,videos,changelog`,
      { headers: HEADERS, timeout: 12000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024 }
    ),
    axios.get(
      `${API_URL}/v2/games/${productId}?locale=en-US`,
      { headers: HEADERS, timeout: 12000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024 }
    ).catch(() => null),
  ]);

  const product = productResponse.data || {};
  const game = gameResponse?.data || {};
  const downloads = product.downloads?.installers || [];
  const windowsInstaller = downloads.find((item: any) => item?.os === "windows");
  const screenshots = Array.isArray(product.screenshots)
    ? product.screenshots.map((item: any) => {
        if (typeof item === "string") return item;
        const formatted = Array.isArray(item?.formatted_images) ? item.formatted_images : [];
        return formatted.find((image: any) => image?.image_url)?.image_url
          || item?.formatter_template_url?.replace("{formatter}", "ggvgt")
          || item?.image || item?.url;
      }).filter((value: unknown) => typeof value === "string" && value.startsWith("https://")).slice(0, 8)
    : [];
  const images = product.images || {};
  const description = load(String(game.description || product.description || product.description_long || product.description_short || ""))
    .text().replace(/\s+/g, " ").trim();

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = bytes, unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
    return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const result = {
    // GOG exposes installer metadata publicly, but resolving signed downlinks requires a GOG bearer token.
    // Do not forward unresolved/private installer metadata to the built-in HTTP engine.
    downloads: [] as GameDownloadOption[],
    description,
    developer: Array.isArray(product.developers) ? product.developers.join(", ") : (typeof product.developer === "string" ? product.developer : ""),
    publisher: Array.isArray(product.publishers) ? product.publishers.join(", ") : "",
    releaseDate: formatGogDate(product.release_date || game.releaseDate),
    platforms: Object.entries(product.content_system_compatibility || {})
      .filter(([, enabled]) => enabled === true)
      .map(([platform]) => platform),
    screenshots,
    tags: [],
    cover: typeof (images.icon || images.logo2x) === "string"
      ? ((images.icon || images.logo2x).startsWith("//") ? `https:${images.icon || images.logo2x}` : (images.icon || images.logo2x))
      : "",
    size: windowsInstaller?.total_size ? formatBytes(Number(windowsInstaller.total_size)) : "",
    storeLink: safeStoreUrl(product.links?.product_card || product.purchase_link, product.slug),
    requiresGogAccount: true,
  };

  detailsCache.set(productId, { expiresAt: Date.now() + CATALOG_TTL, value: result });
  return result;
}

type ReturnTypeDetails = Awaited<ReturnType<typeof fetchGogGameDetails>>;