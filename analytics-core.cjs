const SOURCE_IDS = new Set(["fitgirl", "erolabs", "gog", "steam", "epic"]);
const EVENT_PROPERTIES = Object.freeze({
  app_launched: ["app_version", "platform", "arch", "electron_version"],
  feature_used: ["feature"],
  game_source_viewed: ["source_id"],
  game_search: ["search_scope", "source_id"],
  download_started: ["game_name", "source_id", "download_type", "scheduled"],
  download_scheduled: ["game_name", "source_id", "download_type"],
  download_paused: ["game_name", "source_id", "download_type"],
  download_resumed: ["game_name", "source_id", "download_type"],
  download_retry: ["game_name", "source_id", "download_type"],
  download_cancelled: ["game_name", "source_id", "download_type", "bytes", "duration_ms"],
  download_completed: ["game_name", "source_id", "download_type", "bytes", "duration_ms"],
  download_failed: ["game_name", "source_id", "download_type", "bytes", "duration_ms", "error_category"],
});

function safeText(value, maxLength = 120) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
  const lower = text.toLowerCase();
  const isAbsolutePath = /^[a-z]:[\\/]/i.test(text) || text.startsWith("\\\\") || text.startsWith("/");
  if (!text || /https?:\/\//i.test(text) || lower.startsWith("magnet:") || isAbsolutePath) return undefined;
  return text;
}

function safeInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(Math.floor(number), max);
}

function sanitizeAnalyticsEvent(eventName, properties = {}) {
  if (typeof eventName !== "string" || !Object.prototype.hasOwnProperty.call(EVENT_PROPERTIES, eventName)) return null;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) properties = {};
  const result = {};
  for (const key of EVENT_PROPERTIES[eventName]) {
    const value = properties[key];
    if (key === "source_id") {
      if (typeof value === "string" && SOURCE_IDS.has(value)) result[key] = value;
    } else if (key === "game_name" || key === "feature" || key === "platform" || key === "arch" || key === "electron_version" || key === "app_version" || key === "download_type" || key === "search_scope" || key === "error_category") {
      const text = safeText(value, key === "game_name" ? 120 : 48);
      if (text && (!key.endsWith("_version") || /^[0-9A-Za-z.+-]{1,48}$/.test(text))) result[key] = text;
    } else if (key === "bytes" || key === "duration_ms") {
      const number = safeInteger(value, key === "duration_ms" ? 31536000000 : Number.MAX_SAFE_INTEGER);
      if (number !== undefined) result[key] = number;
    } else if (key === "scheduled") {
      if (typeof value === "boolean") result[key] = value;
    }
  }
  return { event: eventName, properties: result };
}

function classifyDownloadError(message) {
  const text = String(message || "").toLowerCase();
  if (/enospc|disk full|not enough space|no space left/.test(text)) return "disk_space";
  if (/eacces|eperm|permission|access is denied/.test(text)) return "permission";
  if (/timeout|timed out|timedout|econn|network|socket|dns|offline/.test(text)) return "network";
  if (/403|404|410|source unavailable|not found/.test(text)) return "source_unavailable";
  if (/hash|checksum|verify|corrupt/.test(text)) return "verification";
  if (/cancel|abort/.test(text)) return "cancelled";
  return "engine";
}

module.exports = { SOURCE_IDS, EVENT_PROPERTIES, sanitizeAnalyticsEvent, classifyDownloadError };