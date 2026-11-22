import React, { useCallback, useEffect, useState } from "react";
import {
  Activity, Cpu, MemoryStick, HardDrive, RefreshCw, AlertCircle,
  Loader2, Server, CheckCircle2, XCircle,
} from "lucide-react";
import { apiFetch } from "../services/api";

interface NativeHealth {
  sampledAt: string;
  cpu: { percent: number | null; logicalCores: number; model?: string };
  memory: { totalBytes: number; availableBytes: number; usedBytes: number };
  app: {
    mainProcessWorkingSetMB: number;
    helperProcessesWorkingSetMB: number;
    totalWorkingSetMB: number;
    totalPrivateMB: number;
    processCount: number;
    cpuPercent: number;
  };
}
interface ServiceHealth {
  sampledAt: string;
  downloadDisk: { volume?: string; totalBytes: number; freeBytes: number; usedBytes: number } | null;
  downloadPathAvailable: boolean;
  api: { status: string };
  torrentEngine: { status: "online" | "unavailable"; responseMs: number | null };
}
interface CombinedHealth { native: NativeHealth; services: ServiceHealth; }

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function formatAppMemory(value: number): string {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(0)} MB` : "—";
}
function pct(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
function displayPercent(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—";
}

const MetricCard: React.FC<{
  title: string;
  icon: React.ElementType;
  value: string;
  detail: string;
  progress?: number | null;
  tone?: "green" | "blue";
}> = ({ title, icon: Icon, value, detail, progress, tone = "green" }) => (
  <section className="mn-health-card">
    <div className="mn-health-card-heading">
      <span className={`mn-health-card-icon ${tone}`}><Icon className="w-[18px] h-[18px]" /></span>
      <span>{title}</span>
    </div>
    <div className="mn-health-card-value">{value}</div>
    <p>{detail}</p>
    {typeof progress === "number" && (
      <div className="mn-health-progress"><span className={tone} style={{ width: `${pct(progress)}%` }} /></div>
    )}
  </section>
);

const ServiceStatus: React.FC<{ title: string; online: boolean; detail: string }> = ({ title, online, detail }) => (
  <div className="mn-health-service">
    <span className={`mn-health-service-icon ${online ? "online" : "offline"}`}>
      {online ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
    </span>
    <div className="min-w-0 flex-1">
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
    <span className={`mn-health-service-state ${online ? "online" : "offline"}`}>
      {online ? "Running" : "Not running"}
    </span>
  </div>
);

export const SystemHealthView: React.FC<{ active: boolean }> = ({ active }) => {
  const [health, setHealth] = useState<CombinedHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const bridge = (window as any).electron;

  const loadHealth = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      if (typeof bridge?.getSystemHealth !== "function") {
        throw new Error("Open this screen in the installed desktop app.");
      }
      const [native, response] = await Promise.all([
        bridge.getSystemHealth() as Promise<NativeHealth>,
        apiFetch("/api/system/health"),
      ]);
      if (!response.ok) throw new Error("Could not read local download service status.");
      const services = await response.json() as ServiceHealth;
      setHealth({ native, services });
      setLastError(null);
    } catch (error: any) {
      setLastError(error?.message || "Performance information is unavailable.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (!active) return;
    void loadHealth(true);
    const timer = window.setInterval(() => { void loadHealth(true); }, 10000);
    return () => window.clearInterval(timer);
  }, [active, loadHealth]);

  const memoryPercent = health?.native.memory.totalBytes
    ? (health.native.memory.usedBytes / health.native.memory.totalBytes) * 100 : null;
  const diskPercent = health?.services.downloadDisk?.totalBytes
    ? (health.services.downloadDisk.usedBytes / health.services.downloadDisk.totalBytes) * 100 : null;
  const allServicesOnline = !!health
    && health.services.api.status === "online"
    && health.services.torrentEngine.status === "online";

  if (loading && !health) {
    return (
      <div className="mn-health-loading">
        <Loader2 className="w-5 h-5 animate-spin" /> Checking this PC…
      </div>
    );
  }

  return (
    <div className="mn-health-page">
      <div className="mn-health-content">
        <header className="mn-health-header">
          <div>
            <div className="mn-eyebrow">YOUR PC</div>
            <h1>Performance</h1>
            <p>Live CPU, memory, storage and download service status.</p>
          </div>
          <button type="button" onClick={() => void loadHealth()} disabled={refreshing} className="mn-health-refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {lastError && (
          <div className="mn-health-error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{lastError}</span>
            <button type="button" onClick={() => void loadHealth()}>Retry</button>
          </div>
        )}

        {health && (
          <>
            <div className="mn-health-grid">
              <MetricCard
                title="System CPU"
                icon={Cpu}
                value={displayPercent(health.native.cpu.percent)}
                detail={`${health.native.cpu.logicalCores} logical cores`}
                progress={health.native.cpu.percent}
                tone="blue"
              />
              <MetricCard
                title="System RAM"
                icon={MemoryStick}
                value={formatBytes(health.native.memory.usedBytes)}
                detail={`${formatBytes(health.native.memory.availableBytes)} available of ${formatBytes(health.native.memory.totalBytes)}`}
                progress={memoryPercent}
              />
              <MetricCard
                title="App main process"
                icon={Activity}
                value={formatAppMemory(health.native.app.mainProcessWorkingSetMB)}
                detail={`All ${health.native.app.processCount} app processes: ${formatAppMemory(health.native.app.totalWorkingSetMB)}`}
                tone="blue"
              />
              <MetricCard
                title="Download storage"
                icon={HardDrive}
                value={health.services.downloadDisk ? formatBytes(health.services.downloadDisk.freeBytes) : "Unavailable"}
                detail={health.services.downloadDisk
                  ? `${health.services.downloadDisk.volume || "Drive"} · free of ${formatBytes(health.services.downloadDisk.totalBytes)}`
                  : "Download location could not be read"}
                progress={diskPercent}
              />
            </div>

            <section className="mn-health-services-card">
              <div className="mn-health-services-header">
                <div>
                  <h2>Download services</h2>
                  <p>Required services running on this PC.</p>
                </div>
                <span className={`mn-health-overall ${allServicesOnline ? "online" : "offline"}`}>
                  <span /> {allServicesOnline ? "All systems ready" : "Attention needed"}
                </span>
              </div>
              <div className="mn-health-services-list">
                <ServiceStatus
                  title="Local app service"
                  online={health.services.api.status === "online"}
                  detail="Connects the app to your local downloads and library"
                />
                <ServiceStatus
                  title="Download engine"
                  online={health.services.torrentEngine.status === "online"}
                  detail={health.services.torrentEngine.responseMs !== null
                    ? `Responded in ${health.services.torrentEngine.responseMs} ms`
                    : "Waiting for the download engine"}
                />
              </div>
            </section>

            <div className="mn-health-footnote">
              <span>Metrics are read directly from Windows and refresh every 10 seconds.</span>
              <span>Last updated {new Date(health.native.sampledAt).toLocaleTimeString()}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};