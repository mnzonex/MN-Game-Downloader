const SOURCE_IDS = new Set(["fitgirl", "erolabs", "gog", "steam", "epic"]);
const FEATURE_IDS = new Set(["search", "universal", "library", "downloads", "boost", "health", "settings", "about", "game_search", "game_details"]);
const SEARCH_SCOPES = new Set(["all_sources", "single_source"]);
const DOWNLOAD_TYPES = new Set(["torrent", "http"]);
const ERROR_CATEGORIES = new Set(["disk_space", "permission", "network", "source_unavailable", "verification", "cancelled", "engine"]);
const RESUME_STAGES = new Set(["startup_http", "startup_torrent", "http_response", "manual_http", "manual_torrent"]);
const ERROR_STAGES = new Set(["filesystem", "source_response", "network_request", "verification", "finalization", "request_start", "engine"]);
const COMPLETION_SOURCES = new Set(["http", "torrent"]);
const EVENT_PROPERTIES = Object.freeze({
  app_launched: ["app_version", "platform", "arch", "electron_version"],
  feature_used: ["feature"],
  game_source_viewed: ["source_id"],
  game_search: ["search_scope", "source_id"],
  download_started: ["attempt_id", "game_name", "source_id", "download_type", "scheduled"],
  download_scheduled: ["attempt_id", "game_name", "source_id", "download_type"],
  download_paused: ["attempt_id", "game_name", "source_id", "download_type"],
  download_resume_requested: ["attempt_id", "game_name", "source_id", "download_type", "resume_stage", "bytes", "duration_ms"],
  download_resumed: ["attempt_id", "game_name", "source_id", "download_type", "resume_stage", "partial_bytes", "bytes", "duration_ms"],
  download_resume_restarted: ["attempt_id", "game_name", "source_id", "download_type", "resume_stage", "partial_bytes", "bytes", "duration_ms"],
  download_interrupted: ["attempt_id", "game_name", "source_id", "download_type", "resume_stage", "partial_bytes", "bytes", "duration_ms"],
  download_resume_failed: ["attempt_id", "game_name", "source_id", "download_type", "resume_stage", "error_category", "error_stage", "partial_bytes", "bytes", "duration_ms"],
  download_retry: ["attempt_id", "game_name", "source_id", "download_type"],
  download_cancelled: ["attempt_id", "game_name", "source_id", "download_type", "bytes", "duration_ms"],
  download_completed: ["attempt_id", "game_name", "source_id", "download_type", "completion_source", "bytes", "duration_ms"],
  download_failed: ["attempt_id", "game_name", "source_id", "download_type", "bytes", "duration_ms", "error_category", "error_stage"],
});

function safeText(value, maxLength = 120) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
  const lower = text.toLowerCase();
  const isAbsolutePath = /^[a-z]:[\\/]/i.test(text) || text.startsWith("\\\\") || text.startsWith("/");
  if (!text || /https?:\/\//i.test(text) || lower.startsWith("magnet:") || isAbsolutePath) return undefined;
  return text;
}

function safeGameTitle(value) {
  const text = safeText(value, 120);
  if (!text) return undefined;
  if (/[\\/]/.test(text) || /@/.test(text)) return undefined;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return undefined;
  if (/\+?\d[\d\s().-]{7,}\d/.test(text)) return undefined;
  if (/\.(exe|dll|lnk|bat|cmd|zip|rar|7z|iso|torrent|url)$/i.test(text)) return undefined;
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
    if (key === "attempt_id") {
      if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) result[key] = value.toLowerCase();
    } else if (key === "resume_stage") {
      if (typeof value === "string" && RESUME_STAGES.has(value)) result[key] = value;
    } else if (key === "error_stage") {
      if (typeof value === "string" && ERROR_STAGES.has(value)) result[key] = value;
    } else if (key === "completion_source") {
      if (typeof value === "string" && COMPLETION_SOURCES.has(value)) result[key] = value;
    } else if (key === "partial_bytes") {
      const number = safeInteger(value, Number.MAX_SAFE_INTEGER);
      if (number !== undefined) result[key] = number;
    } else if (key === "source_id") {
      if (typeof value === "string" && SOURCE_IDS.has(value)) result[key] = value;
    } else if (key === "game_name") {
      const title = safeGameTitle(value);
      if (title) result[key] = title;
    } else if (key === "feature") {
      if (typeof value === "string" && FEATURE_IDS.has(value)) result[key] = value;
    } else if (key === "search_scope") {
      if (typeof value === "string" && SEARCH_SCOPES.has(value)) result[key] = value;
    } else if (key === "download_type") {
      if (typeof value === "string" && DOWNLOAD_TYPES.has(value)) result[key] = value;
    } else if (key === "error_category") {
      if (typeof value === "string" && ERROR_CATEGORIES.has(value)) result[key] = value;
    } else if (key === "platform") {
      if (value === "win32" || value === "darwin" || value === "linux") result[key] = value;
    } else if (key === "arch") {
      if (value === "x64" || value === "arm64" || value === "ia32" || value === "arm") result[key] = value;
    } else if (key === "electron_version" || key === "app_version") {
      const text = safeText(value, 48);
      if (text && /^[0-9A-Za-z.+-]{1,48}$/.test(text)) result[key] = text;
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

module.exports = { SOURCE_IDS, FEATURE_IDS, EVENT_PROPERTIES, sanitizeAnalyticsEvent, classifyDownloadError, RESUME_STAGES, ERROR_STAGES };