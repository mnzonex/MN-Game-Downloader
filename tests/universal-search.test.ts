import assert from "node:assert/strict";
import {
  buildUniversalSearchRequests,
  mergeUniversalSourceResults,
  validateUniversalSourceGames,
} from "../src/services/universalSearch";
import type { GameItem } from "../src/types";
import type { SourceId } from "../src/sources/registry";

function makeGame(id: string, sourceId: SourceId, badge: string, title: string): GameItem {
  return {
    id,
    title,
    cover: "",
    size: "Direct download",
    repacker: sourceId,
    siteBadge: badge,
    sourceId,
    sourceAction: "built-in-download",
    siteUrl: "https://example.test/" + id,
    category: "Windows app / game",
    description: "",
    releaseDate: "",
    screenshots: [],
    downloads: [],
  };
}

const requests = buildUniversalSearchRequests("  Dota 2  ", 2);
assert.deepEqual(requests.map((item) => item.sourceId), [
  "fitgirl", "erolabs", "gog", "steam", "epic",
]);
assert.equal(requests.length, 5);
assert.ok(requests.every((item) => item.endpoint.includes("q=Dota%202&page=2")));
assert.deepEqual(requests.map((item) => item.endpoint), [
  "/api/fitgirl/search?q=Dota%202&page=2",
  "/api/erolabs/search?q=Dota%202&page=2",
  "/api/gog/search?q=Dota%202&page=2",
  "/api/steam/search?q=Dota%202&page=2",
  "/api/epic/search?q=Dota%202&page=2",
]);

const gogGame = makeGame("gog-dota", "gog", "GOG", "Dota Companion App");
const steamGame = makeGame("steam-dota", "steam", "STEAM", "Dota 2");
const batches = [
  { sourceId: "gog" as const, games: validateUniversalSourceGames("gog", [gogGame]), hasMore: false },
  { sourceId: "steam" as const, games: validateUniversalSourceGames("steam", [steamGame]), hasMore: true },
  { sourceId: "steam" as const, games: validateUniversalSourceGames("steam", [steamGame]), hasMore: true },
];
const merged = mergeUniversalSourceResults(batches);
assert.equal(merged.length, 2, "duplicates from the same source should be removed");
assert.deepEqual(merged.map((game) => game.sourceId), ["gog", "steam"]);
assert.throws(() =>
  validateUniversalSourceGames("steam", [makeGame("bad", "gog", "GOG", "Wrong source")]),
  /mismatched catalog items/,
);

console.log("Universal Search tests passed: five source endpoints, query pagination, per-source validation and duplicate merging.");