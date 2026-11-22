const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.cjs"), "utf8");
const settings = fs.readFileSync(path.join(root, "src", "components", "SettingsView.tsx"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const core = fs.readFileSync(path.join(root, "analytics-core.cjs"), "utf8");
const server = fs.readFileSync(path.join(root, "server.ts"), "utf8");

assert.match(main, /defaultOptIn:\s*true/, "desktop analytics must initialize as always-on");
assert.match(main, /async function startAnalytics\(/, "analytics should start with app startup");
assert.match(main, /await startAnalytics\(\)/, "app startup should initialize analytics before the window opens");
assert.doesNotMatch(main, /analytics:set-consent/, "there must be no consent-toggle IPC");
assert.doesNotMatch(preload, /setConsent/, "renderer bridge must not expose analytics opt-in/opt-out");
assert.doesNotMatch(settings, /type=["']checkbox["']|analytics_enabled|handleAnalyticsConsent/, "Settings must not expose an analytics checkbox or toggle");
assert.match(settings, /Always on/, "Settings must disclose that usage analytics are always on");
assert.match(settings, /solely to understand how MN Game Downloader is used and improve its features and reliability/, "Settings must explain analytics purpose");
assert.match(core, /magnet:/, "the analytics sanitizer must filter magnet links");
assert.match(core, /https\?:\\\/\\\//, "the analytics sanitizer must filter download URLs");
assert.match(core, /error_category/, "analytics must use categorized errors, not raw error details");
assert.match(server, /const cancellableStatuses = new Set\(\[\x27scheduled\x27, \x27queued\x27, \x27downloading\x27, \x27paused\x27\]\)/, "only active downloads should count as cancellations");
assert.match(server, /cancellableStatuses\.has\(row\.status\).*download_cancelled/, "deleting failed rows must not count as cancellations");
assert.doesNotMatch(server, /row && row\.status !== \x27completed\x27\) captureTrackedEvent\(\x27download_cancelled\x27/, "failed records must not be counted as cancelled");

console.log("Analytics policy tests passed: always-on startup, no toggle, clear disclosure, privacy filtering and accurate cancellation counts.");