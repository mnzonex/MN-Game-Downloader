const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.cjs"), "utf8");
const settings = fs.readFileSync(path.join(root, "src", "components", "SettingsView.tsx"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const core = fs.readFileSync(path.join(root, "analytics-core.cjs"), "utf8");

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

console.log("Analytics policy tests passed: always-on startup, no toggle, clear disclosure and privacy filtering.");