const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const history = fs.readFileSync(path.join(root, 'src/components/DownloadHistory.tsx'), 'utf8');
const downloads = fs.readFileSync(path.join(root, 'src/components/DownloadsView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

for (const className of [
  'mn-download-history', 'mn-download-history-item', 'mn-download-history-name',
  'mn-download-history-status', 'mn-download-history-meta', 'mn-download-history-again',
]) {
  assert.ok(history.includes(className), 'History uses semantic theme-aware class ' + className);
}
assert.ok(!history.includes('bg-white/50'), 'History cards no longer force a semi-transparent white surface');

for (const className of [
  'mn-download-card', 'mn-download-status-', 'mn-download-repair-details',
  'mn-download-scheduled-banner', 'mn-delete-download-modal', 'mn-delete-download-copy',
]) {
  assert.ok(downloads.includes(className), 'Downloads uses semantic styling ' + className);
}

const preDownload = fs.readFileSync(path.join(root, 'src/components/PreDownloadInspectModal.tsx'), 'utf8');
const schedule = fs.readFileSync(path.join(root, 'src/components/ScheduleDownloadModal.tsx'), 'utf8');
const repair = fs.readFileSync(path.join(root, 'src/components/RepairModal.tsx'), 'utf8');
for (const [source, className] of [
  [preDownload, 'mn-pre-download-modal'],
  [preDownload, 'mn-pre-download-header'],
  [preDownload, 'mn-pre-download-steps'],
  [preDownload, 'mn-pre-download-file-list'],
  [preDownload, 'mn-pre-download-footer'],
  [schedule, 'mn-schedule-download-modal'],
  [schedule, 'mn-schedule-download-header'],
  [schedule, 'mn-schedule-download-footer'],
  [repair, 'mn-repair-modal'],
]) {
  assert.ok(source.includes(className), 'Download-related modal has semantic styling ' + className);
}
for (const selector of [
  'html[data-theme="dark"] .mn-pre-download-header',
  'html[data-theme="dark"] .mn-pre-download-steps',
  'html[data-theme="dark"] .mn-schedule-download-header',
  'html[data-theme="dark"] .mn-repair-modal .bg-red-50',
]) {
  assert.ok(css.includes(selector), 'Dark theme handles ' + selector);
}

for (const status of [
  'scheduled', 'queued', 'downloading', 'paused', 'moving',
  'verifying', 'repairing', 'completed', 'error',
]) {
  assert.ok(css.includes('html[data-theme="dark"] .mn-download-status-' + status),
    'Dark theme defines readable colors for ' + status + ' status badge');
}

for (const selector of [
  'html[data-theme="dark"] .mn-download-card.is-failed',
  'html[data-theme="dark"] .mn-download-card.is-moving',
  'html[data-theme="dark"] .mn-download-card.is-scheduled',
  'html[data-theme="dark"] .mn-download-card.is-queued',
  'html[data-theme="dark"] .mn-download-reconnect-overlay',
  'html[data-theme="dark"] .mn-download-repair-details',
  'html[data-theme="dark"] .mn-download-scheduled-banner',
  'html[data-theme="dark"] .mn-delete-download-icon',
]) {
  assert.ok(css.includes(selector), 'Dark theme handles ' + selector);
}

console.log('Download theme tests passed: History cards, text, action buttons, all status badges, repair/scheduled panels and delete confirmation have dark-mode styling.');