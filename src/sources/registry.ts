export type SourceId = "fitgirl" | "erolabs" | "gog" | "steam" | "epic";

export type SourceGroupId = "community" | "official";

export interface GameSourceDefinition {
  id: SourceId;
  label: string;
  shortLabel: string;
  group: SourceGroupId;
  description: string;
  kind: "repack" | "direct" | "store" | "giveaway";
  badgeColor: "emerald" | "rose" | "indigo" | "blue" | "violet";
  availability: "built-in-download" | "official-store";
  installNote: string;
}

export const GAME_SOURCES: readonly GameSourceDefinition[] = [
  {
    id: "fitgirl",
    label: "FitGirl Repacks",
    shortLabel: "FitGirl",
    group: "community",
    description: "Compressed game repacks delivered through the built-in torrent engine",
    kind: "repack",
    badgeColor: "emerald",
    availability: "built-in-download",
    installNote: "The built-in torrent engine handles the magnet download. Verify the downloaded files before running installers.",
  },
  {
    id: "erolabs",
    label: "EroLabs",
    shortLabel: "EroLabs",
    group: "community",
    description: "Direct Windows game downloads exposed by the source website",
    kind: "direct",
    badgeColor: "rose",
    availability: "built-in-download",
    installNote: "Only verified direct HTTP links are handed to the built-in download engine.",
  },
  {
    id: "gog",
    label: "GOG Free Games",
    shortLabel: "GOG",
    group: "official",
    description: "DRM-free store listings with public game information",
    kind: "store",
    badgeColor: "indigo",
    availability: "official-store",
    installNote: "Secure installers require your own GOG account authorization. Open the official store to claim and install.",
  },
  {
    id: "steam",
    label: "Steam Free-to-Play",
    shortLabel: "Steam",
    group: "official",
    description: "Official Steam games verified as free-to-play for Windows",
    kind: "store",
    badgeColor: "blue",
    availability: "official-store",
    installNote: "Steam account and Steam client are required to install. This app opens the official Steam store page.",
  },
  {
    id: "epic",
    label: "Epic Giveaways",
    shortLabel: "Epic",
    group: "official",
    description: "Current and upcoming time-limited free game promotions",
    kind: "giveaway",
    badgeColor: "violet",
    availability: "official-store",
    installNote: "Claim promotions through your own Epic Games account before the displayed offer period ends.",
  },
] as const;

export const SOURCE_GROUPS = [
  { id: "official" as const, label: "Official stores", sourceIds: ["gog", "steam", "epic"] as const },
  { id: "community" as const, label: "Community sources", sourceIds: ["fitgirl", "erolabs"] as const },
] as const;

export const SOURCE_PAGE_SIZE = 10;

export function getSource(sourceId: SourceId): GameSourceDefinition {
  return GAME_SOURCES.find((source) => source.id === sourceId) || GAME_SOURCES[0];
}