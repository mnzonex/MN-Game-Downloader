const assert = require("node:assert/strict");
const { sanitizeAnalyticsEvent, classifyDownloadError } = require("../analytics-core.cjs");

const accepted = sanitizeAnalyticsEvent("download_completed", {
  game_name: "Example Game",
  source_id: "fitgirl",
  download_type: "torrent",
  bytes: 1024,
  duration_ms: 1200,
  magnet: "magnet:?xt=secret",
  file_path: "C:\\Users\\Someone\\Downloads\\game",
  url: "https://private.example/file",
  username: "private-user",
  email: "person@example.com",
  error_message: "secret raw error",
});
assert.deepEqual(accepted, {
  event: "download_completed",
  properties: {
    game_name: "Example Game",
    source_id: "fitgirl",
    download_type: "torrent",
    bytes: 1024,
    duration_ms: 1200,
  },
});

assert.equal(sanitizeAnalyticsEvent("unapproved_event", {}), null);
assert.equal(sanitizeAnalyticsEvent("download_started", { source_id: "unknown" }).properties.source_id, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "C:\\Users\\User\\game.exe" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "magnet:?xt=secret" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "https://private.example/game" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "Game/With/Slashes" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "game.iso" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "person@example.com" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { game_name: "+94 771234567" }).properties.game_name, undefined);
assert.equal(sanitizeAnalyticsEvent("feature_used", { feature: "settings", password: "never" }).properties.password, undefined);
assert.equal(sanitizeAnalyticsEvent("feature_used", { feature: "unknown-feature" }).properties.feature, undefined);
assert.equal(sanitizeAnalyticsEvent("game_search", { search_scope: "single_source", source_id: "steam", query: "private search" }).properties.source_id, "steam");
assert.equal(sanitizeAnalyticsEvent("game_search", { search_scope: "raw search term", source_id: "unknown" }).properties.search_scope, undefined);
assert.equal(sanitizeAnalyticsEvent("download_started", { download_type: "file:///private" }).properties.download_type, undefined);
assert.equal(classifyDownloadError("ENOSPC: no space left on device"), "disk_space");
assert.equal(classifyDownloadError("connect ETIMEDOUT"), "network");
assert.equal(classifyDownloadError("HTTP 404"), "source_unavailable");
assert.equal(classifyDownloadError("hash verification failed"), "verification");

console.log("Analytics privacy/sanitization tests passed.");