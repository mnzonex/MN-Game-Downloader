const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { init } = require('@posthog/electron/main');
const { sanitizeAnalyticsEvent } = require('../analytics-core.cjs');

const storageDirectory = path.resolve(__dirname, '..', '.test-data', 'posthog-offline-queue-smoke');
const resultFile = path.resolve(__dirname, '..', '.test-data', 'posthog-offline-queue-smoke-result.json');
const host = 'http://127.0.0.1:65534';

function findStateFile(directory) {
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === 'state.json') return candidate;
    if (entry.isDirectory()) {
      const nested = findStateFile(candidate);
      if (nested) return nested;
    }
  }
  return null;
}
function readQueue() {
  const file = findStateFile(storageDirectory);
  if (!file) return [];
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(state?.values?.queue) ? state.values.queue : [];
}
function makeClient() {
  return init({
    projectToken: 'phc_offline_queue_test_only',
    host,
    storageDirectory,
    defaultOptIn: false,
    personProfiles: 'never',
    disableGeoip: true,
    disableRemoteFeatureFlags: true,
    disableRemoteConfig: true,
    captureAppLifecycleEvents: false,
    enableExceptionAutocapture: false,
    maxQueueAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxQueueSize: 100,
    maxStorageBytes: 1024 * 1024,
    requestTimeout: 250,
    fetchRetryCount: 0,
    flushAt: 100,
    flushInterval: 60000,
    onError: () => {},
  });
}
function safeCapture(client, eventName, props) {
  const safe = sanitizeAnalyticsEvent(eventName, props);
  if (!safe) throw new Error('Sanitizer rejected test event');
  client.capture(safe.event, safe.properties);
}

app.whenReady().then(async () => {
  let report = { stage: 'start', storageDirectory, host, realNetworkUsed: false };
  try {
    fs.rmSync(storageDirectory, { recursive: true, force: true });
    fs.mkdirSync(storageDirectory, { recursive: true });

    const first = makeClient();
    await first.ready();
    const defaultOptedOut = first.hasOptedOutCapturing();
    safeCapture(first, 'feature_used', { feature: 'settings' });
    await new Promise(resolve => setTimeout(resolve, 200));
    const beforeConsentCount = readQueue().length;

    await first.optIn();
    safeCapture(first, 'download_started', {
      game_name: 'Offline Queue Test Game',
      source_id: 'fitgirl',
      download_type: 'torrent',
      scheduled: false,
      magnet: 'magnet:?secret=must-not-persist',
      file_path: 'C:\\\\private\\\\path',
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    await first.flush().catch(() => {});
    await first.shutdown(500).catch(() => {});
    const afterFirstRun = readQueue();

    const second = makeClient();
    await second.ready();
    const restoredCount = readQueue().length;
    safeCapture(second, 'download_completed', {
      game_name: 'Offline Queue Test Game',
      source_id: 'fitgirl',
      download_type: 'torrent',
      bytes: 4096,
      duration_ms: 12000,
      magnet: 'magnet:?must-not-persist',
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    await second.flush().catch(() => {});
    await second.shutdown(500).catch(() => {});
    const stateFile = findStateFile(storageDirectory);
    const afterSecondRun = readQueue();

    const eventNames = afterSecondRun.map(item => item.message.event);
    const serialized = JSON.stringify(afterSecondRun);
    report = {
      ok: defaultOptedOut
        && beforeConsentCount === 0
        && afterFirstRun.length >= 1
        && restoredCount >= 1
        && afterSecondRun.length >= 2
        && eventNames.includes('download_started')
        && eventNames.includes('download_completed')
        && !serialized.includes('must-not-persist')
        && !serialized.includes('magnet:?')
        && !serialized.includes('private\\\\path'),
      defaultConsentOff: defaultOptedOut,
      eventsBeforeConsent: beforeConsentCount,
      persistedAfterFirstShutdown: afterFirstRun.length,
      restoredOnSecondClientStart: restoredCount,
      persistedAfterSecondShutdown: afterSecondRun.length,
      events: eventNames,
      privacySecretsAbsent: !serialized.includes('must-not-persist') && !serialized.includes('magnet:?') && !serialized.includes('private\\\\path'),
      storageFileExists: !!stateFile,
      storageBytes: stateFile ? fs.statSync(stateFile).size : 0,
      realNetworkUsed: false,
      note: 'All requests targeted localhost port 65534, where no service is listening.'
    };
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\\n');
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    report.ok = false;
    report.error = String(error && error.stack || error);
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
    process.stderr.write(report.error + '\\n');
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});