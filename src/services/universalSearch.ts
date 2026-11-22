import type { GameItem } from "../types";
import type { SourceId } from "../sources/registry";

export interface UniversalSearchRequest {
  sourceId: SourceId;
  endpoint: string;
}

export interface UniversalSourceBatch {
  sourceId: SourceId;
  games: GameItem[];
  hasMore: boolean;
}

const UNIVERSAL_SOURCES: readonly SourceId[] = [
  "fitgirl",
  "erolabs",
  "gog",
  "steam",
  "epic",
];

const EXPECTED_BADGES: Record<SourceId, string> = {
  fitgirl: "FITGIRL",
  erolabs: "EROLABS",
  gog: "GOG",
  steam: "STEAM",
  epic: "EPIC",
};

export function buildUniversalSearchRequests(query: string, page = 1): UniversalSearchRequest[] {
  const normalizedQuery = query.trim().slice(0, 100);
  const normalizedPage = Math.max(1, Math.min(50, Math.floor(page) || 1));
  const encoded = encodeURIComponent(normalizedQuery);

  return UNIVERSAL_SOURCES.map((sourceId) => ({
    sourceId,
    endpoint: "/api/" + sourceId + "/search?q=" + encoded + "&page=" + normalizedPage,
  }));
}

export function validateUniversalSourceGames(sourceId: SourceId, games: GameItem[]): GameItem[] {
  const valid = games.filter((game) =>
    game.siteBadge === EXPECTED_BADGES[sourceId]
    && (game.sourceId === undefined || game.sourceId === sourceId)
  );
  if (valid.length !== games.length) {
    throw new Error(sourceId + " returned mismatched catalog items.");
  }
  return valid.map((game) => ({ ...game, sourceId }));
}

export function mergeUniversalSourceResults(batches: UniversalSourceBatch[]): GameItem[] {
  const unique = new Map<string, GameItem>();
  for (const batch of batches) {
    for (const game of batch.games) {
      const key = batch.sourceId + ":" + game.id;
      if (!unique.has(key)) unique.set(key, { ...game, sourceId: batch.sourceId });
    }
  }
  return Array.from(unique.values());
}