const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const db = read("src/engine/db.ts");
const http = read("src/engine/HttpEngine.ts");
const torrent = read("src/engine/TorrentEngine.ts");
const scheduler = read("src/engine/DownloadScheduler.ts");
const server = read("server.ts");
const main = read("main.cjs");
const library = read("src/engine/Library.ts");
const analytics = require("../analytics-core.cjs");

const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const interrupted = analytics.sanitizeAnalyticsEvent("download_interrupted", {
  attempt_id: attemptId, resume_stage: "startup_http", partial_bytes: 4096,
  magnet: "magnet:?secret", file_path: "C:\\private\\game",
});
assert.deepEqual(interrupted, {
  event: "download_interrupted",
  properties: { attempt_id: attemptId, resume_stage: "startup_http", partial_bytes: 4096 },
});
assert.equal(analytics.sanitizeAnalyticsEvent("download_interrupted", {
  attempt_id: "not-an-id", resume_stage: "startup_http", partial_bytes: 10,
}).properties.attempt_id, undefined);
assert.equal(analytics.sanitizeAnalyticsEvent("download_resume_failed", {
  attempt_id: attemptId, resume_stage: "bad-stage", error_stage: "raw exception path",
}).properties.resume_stage, undefined);
assert.equal(analytics.sanitizeAnalyticsEvent("download_resume_failed", {
  attempt_id: attemptId, resume_stage: "startup_http", error_stage: "network_request",
}).properties.error_stage, "network_request");
const restarted = analytics.sanitizeAnalyticsEvent("download_resume_restarted", {
  attempt_id: attemptId, resume_stage: "startup_http", partial_bytes: 4096,
});
assert.deepEqual(restarted.properties, {
  attempt_id: attemptId, resume_stage: "startup_http", partial_bytes: 4096,
});
assert.ok(analytics.EVENT_PROPERTIES.download_cancelled.includes("attempt_id"));
assert.ok(analytics.EVENT_PROPERTIES.download_failed.includes("attempt_id"));
assert.ok(analytics.EVENT_PROPERTIES.download_resume_restarted.includes("partial_bytes"));
assert.ok(!analytics.EVENT_PROPERTIES.download_cancelled.includes("error_category"));
assert.ok(!analytics.EVENT_PROPERTIES.download_failed.includes("resume_stage"));

assert.match(db, /ALTER TABLE torrents ADD COLUMN attempt_id TEXT/);
assert.match(db, /crypto\.randomUUID\(\)/);
assert.match(db, /export function dbCaptureDownloadEvent/);
assert.match(db, /patch\.status === 'error' && existing\.status !== 'error'/);

assert.match(http, /async shutdown\(\): Promise<void>/);
assert.match(http, /item\.abortController\.abort\(\)/);
assert.match(http, /writer\.once\('close'/);
assert.match(http, /download_interrupted/);
assert.match(http, /download_resumed/);
assert.match(http, /download_resume_restarted/);
assert.match(http, /download_resume_failed/);
assert.match(http, /resumeAttemptedBytes/);
assert.match(http, /resumeBytesObserved/);
assert.match(http, /activeItem\.isRestore \|\| activeItem\.isManualResume/);
assert.match(http, /isManualResume/);
assert.match(http, /this\.startDownload\(id, row\.magnet, row\.name, tempDir, destPath, false, true\)/);
const shutdownBlock = http.slice(http.indexOf("async shutdown(): Promise<void>"), http.indexOf("private async finalizeDownload"));
assert.doesNotMatch(shutdownBlock, /dbMarkError|status:\s*'paused'/, "graceful app shutdown must not mark HTTP downloads failed or user-paused");
assert.match(http, /\.part/);
assert.match(http, /headers\['Range'\]/);

assert.match(torrent, /download_interrupted/);
assert.match(torrent, /download_resumed/);
assert.match(torrent, /download_resume_failed/);
assert.match(scheduler, /attempt_id: row\.attempt_id/);

const shutdownRoute = server.slice(server.indexOf("app.post('/api/engine/shutdown'"), server.indexOf("// Vite middleware"));
assert.ok(shutdownRoute.indexOf("await httpEngine.shutdown()") < shutdownRoute.indexOf("await engine.shutdown()"));
assert.match(server, /download_resume_requested/);
assert.match(server, /download_resume_failed/);
assert.match(server, /resume_stage: 'manual_torrent'/);
assert.match(server, /attempt_id: crypto\.randomUUID\(\), started_at: retryStartedAt/);
assert.match(main, /await startAnalytics\(\);\s+if \(app\.isPackaged\) startServer\(\);/);
assert.match(library, /capture\('download_completed'/);
assert.match(library, /attempt_id: row\.attempt_id/);
assert.match(library, /completion_source:/);

console.log("Download lifecycle tests passed: privacy, cancellation/failure separation, attempt IDs, verified resume vs restart, startup recovery and completion telemetry.");
