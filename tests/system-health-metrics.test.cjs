const assert = require('node:assert/strict');
const { summarizeAppMetrics } = require('../system-health-metrics.cjs');

const summary = summarizeAppMetrics([
  { type: 'Browser', workingSetKB: 204800, privateKB: 170000, cpuPercent: 0.8 },
  { type: 'Renderer', workingSetKB: 153600, privateKB: 140000, cpuPercent: 0.4 },
  { type: 'GPU', workingSetKB: 81920, privateKB: 60000, cpuPercent: 0.2 },
  { type: 'Utility', workingSetKB: 40960, privateKB: 32000, cpuPercent: 0.1 },
]);

assert.equal(summary.mainProcessWorkingSetMB, 200);
assert.equal(summary.helperProcessesWorkingSetMB, 270);
assert.equal(summary.totalWorkingSetMB, 470);
assert.equal(summary.processCount, 4);
assert.ok(Math.abs(summary.cpuPercent - 1.5) < 1e-9);

const empty = summarizeAppMetrics([]);
assert.equal(empty.mainProcessWorkingSetMB, 0);
assert.equal(empty.helperProcessesWorkingSetMB, 0);
assert.equal(empty.totalWorkingSetMB, 0);
assert.equal(empty.processCount, 0);

console.log('System health metrics tests passed: main process vs combined helper memory and empty metrics.');