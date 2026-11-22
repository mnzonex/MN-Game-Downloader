function summarizeAppMetrics(metrics) {
  const items = Array.isArray(metrics) ? metrics : [];
  const normalized = items.map((item) => ({
    type: String(item?.type || 'Unknown'),
    workingSetKB: Math.max(0, Number(item?.workingSetKB) || 0),
    privateKB: Math.max(0, Number(item?.privateKB) || 0),
    cpuPercent: Math.max(0, Number(item?.cpuPercent) || 0),
  }));
  const main = normalized.find((item) => item.type.toLowerCase() === 'browser') || normalized[0] || null;
  const totalWorkingSetKB = normalized.reduce((sum, item) => sum + item.workingSetKB, 0);
  const helperWorkingSetKB = Math.max(0, totalWorkingSetKB - (main?.workingSetKB || 0));
  return {
    mainProcessWorkingSetMB: (main?.workingSetKB || 0) / 1024,
    helperProcessesWorkingSetMB: helperWorkingSetKB / 1024,
    totalWorkingSetMB: totalWorkingSetKB / 1024,
    totalPrivateMB: normalized.reduce((sum, item) => sum + item.privateKB, 0) / 1024,
    processCount: normalized.length,
    cpuPercent: normalized.reduce((sum, item) => sum + item.cpuPercent, 0),
  };
}

module.exports = { summarizeAppMetrics };