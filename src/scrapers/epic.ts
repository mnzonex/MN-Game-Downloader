import axios from "axios";
import type { GameItem } from "../types";
import { SOURCE_PAGE_SIZE } from "../sources/registry";

const PROMOTIONS_URL = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions";
const STORE_URL = "https://store.epicgames.com/en-US";
const HEADERS = {
  "User-Agent": "MN-Game-Downloader/1.2.10",
  "Accept": "application/json",
};

type EpicPromotion = {
  startDate?: string;
  endDate?: string;
  discountSetting?: { discountPercentage?: number };
};

type EpicElement = {
  id?: string;
  namespace?: string;
  title?: string;
  description?: string;
  offerType?: string;
  productSlug?: string;
  urlSlug?: string;
  offerMappings?: Array<{ pageSlug?: string }>;
  catalogNs?: { mappings?: Array<{ pageSlug?: string }> };
  keyImages?: Array<{ type?: string; url?: string }>;
  seller?: { name?: string };
  developer?: string;
  publisher?: string;
  categories?: Array<{ path?: string }>;
  genres?: Array<{ name?: string }>;
  releaseInfo?: Array<{ releaseDate?: string }>;
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number } };
  promotions?: {
    promotionalOffers?: Array<{ promotionalOffers?: EpicPromotion[] }>;
    upcomingPromotionalOffers?: Array<{ promotionalOffers?: EpicPromotion[] }>;
  };
};

export interface EpicCatalogPage {
  games: GameItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

let cache: { expiresAt: number; games: GameItem[] } | null = null;

function getPromotions(groups?: Array<{ promotionalOffers?: EpicPromotion[] }>): EpicPromotion[] {
  return (groups || []).flatMap((group) => group.promotionalOffers || []);
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function safeStoreUrl(element: EpicElement): string {
  const mapping = element.offerMappings?.find((item) => item.pageSlug)?.pageSlug
    || element.catalogNs?.mappings?.find((item) => item.pageSlug)?.pageSlug
    || element.productSlug
    || element.urlSlug;
  if (typeof mapping === "string" && /^[a-z0-9-]{2,120}$/i.test(mapping)) {
    return `${STORE_URL}/p/${encodeURIComponent(mapping)}`;
  }
  return `${STORE_URL}/free-games`;
}

function chooseCover(element: EpicElement): string {
  const images = element.keyImages || [];
  const preferred = ["OfferImageWide", "DieselStoreFrontWide", "VaultClosed", "Thumbnail"];
  for (const type of preferred) {
    const match = images.find((image) => image.type === type && typeof image.url === "string" && image.url.startsWith("https://"));
    if (match?.url) return match.url;
  }
  return images.find((image) => typeof image.url === "string" && image.url.startsWith("https://"))?.url || "";
}

function mapOffer(element: EpicElement, offer: EpicPromotion, status: "free-now" | "upcoming"): GameItem {
  const siteUrl = safeStoreUrl(element);
  const categories = (element.categories || []).map((item) => item.path || "").filter(Boolean);
  const genres = (element.genres || []).map((item) => item.name || "").filter(Boolean);
  const start = offer.startDate || "";
  const end = offer.endDate || "";
  return {
    id: `epic-${String(element.id || element.namespace || element.title).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${status}`,
    title: element.title || "Epic free game",
    cover: chooseCover(element),
    size: status === "free-now" ? (end ? `Free until ${formatDate(end)}` : "Free now") : (start ? `Free from ${formatDate(start)}` : "Upcoming free offer"),
    repackSizeStr: "",
    developer: element.developer || element.seller?.name || "",
    publisher: element.publisher || element.seller?.name || "",
    repacker: "Epic Games Store",
    siteBadge: "EPIC",
    sourceId: "epic",
    sourceAction: "official-store",
    siteUrl,
    category: genres.slice(0, 3).join(", ") || categories.slice(0, 2).join(", ") || "Epic Games Store offer",
    description: String(element.description || "Official Epic Games Store free-game promotion. Claim it through your own Epic Games account during the offer period."),
    releaseDate: formatDate(element.releaseInfo?.[0]?.releaseDate),
    screenshots: (element.keyImages || []).map((image) => image.url || "").filter((url) => url.startsWith("https://")).slice(0, 8),
    downloads: [],
    isFreeToPlay: false,
    offerStatus: status,
    offerStart: start,
    offerEnd: end,
  };
}

async function loadOffers(): Promise<GameItem[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.games;

  const response = await axios.get(PROMOTIONS_URL, {
    params: { locale: "en-US", country: "US", allowCountries: "US" },
    headers: HEADERS,
    timeout: 25000,
    maxRedirects: 2,
    maxContentLength: 8 * 1024 * 1024,
  });

  const elements: EpicElement[] = Array.isArray(response.data?.data?.Catalog?.searchStore?.elements)
    ? response.data.data.Catalog.searchStore.elements
    : [];

  const mapped: GameItem[] = [];
  const seen = new Set<string>();
  const now = Date.now();

  for (const element of elements) {
    if (element.offerType !== "BASE_GAME" || !element.title) continue;
    const current = getPromotions(element.promotions?.promotionalOffers).find((offer) =>
      offer.discountSetting?.discountPercentage === 0 &&
      (!offer.endDate || new Date(offer.endDate).getTime() > now)
    );
    const upcoming = getPromotions(element.promotions?.upcomingPromotionalOffers).find((offer) =>
      offer.discountSetting?.discountPercentage === 0 &&
      !!offer.startDate && new Date(offer.startDate).getTime() > now
    );

    if (current) {
      const game = mapOffer(element, current, "free-now");
      if (!seen.has(game.id)) { seen.add(game.id); mapped.push(game); }
    } else if (upcoming && Number(element.price?.totalPrice?.discountPrice || 0) > 0) {
      const game = mapOffer(element, upcoming, "upcoming");
      if (!seen.has(game.id)) { seen.add(game.id); mapped.push(game); }
    }
  }

  mapped.sort((a, b) => {
    if (a.offerStatus !== b.offerStatus) return a.offerStatus === "free-now" ? -1 : 1;
    return new Date(a.offerStart || "").getTime() - new Date(b.offerStart || "").getTime();
  });
  cache = { expiresAt: Date.now() + 5 * 60_000, games: mapped };
  return mapped;
}

export async function fetchEpicFreeGames(page = 1): Promise<EpicCatalogPage> {
  const all = await loadOffers();
  const normalizedPage = Math.max(1, Math.floor(page) || 1);
  const start = (normalizedPage - 1) * SOURCE_PAGE_SIZE;
  return {
    games: all.slice(start, start + SOURCE_PAGE_SIZE),
    page: normalizedPage,
    pageSize: SOURCE_PAGE_SIZE,
    hasMore: all.length > start + SOURCE_PAGE_SIZE,
  };
}

export async function searchEpicFreeGames(query: string, page = 1): Promise<EpicCatalogPage> {
  const all = await loadOffers();
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? all.filter((game) => `${game.title} ${game.category} ${game.description}`.toLowerCase().includes(normalizedQuery))
    : all;
  const normalizedPage = Math.max(1, Math.floor(page) || 1);
  const start = (normalizedPage - 1) * SOURCE_PAGE_SIZE;
  return {
    games: filtered.slice(start, start + SOURCE_PAGE_SIZE),
    page: normalizedPage,
    pageSize: SOURCE_PAGE_SIZE,
    hasMore: filtered.length > start + SOURCE_PAGE_SIZE,
  };
}


export async function fetchEpicGameDetails(offerId: string): Promise<{
  downloads: [];
  description: string;
  developer: string;
  publisher: string;
  releaseDate: string;
  screenshots: string[];
  cover: string;
  storeLink: string;
  offerStatus: "free-now" | "upcoming";
  offerStart: string;
  offerEnd: string;
}> {
  if (!/^epic-[a-z0-9-]+$/i.test(offerId)) throw new Error("Invalid Epic offer ID.");
  const games = await loadOffers();
  const game = games.find((item) => item.id === offerId);
  if (!game) throw new Error("This Epic offer is no longer available. Refresh the catalog.");
  return {
    downloads: [],
    description: game.description,
    developer: game.developer || "",
    publisher: game.publisher || "",
    releaseDate: game.releaseDate || "",
    screenshots: game.screenshots || [],
    cover: game.cover || "",
    storeLink: game.siteUrl,
    offerStatus: game.offerStatus || "free-now",
    offerStart: game.offerStart || "",
    offerEnd: game.offerEnd || "",
  };
}