import React from "react";
import {
  Activity, Check, Gamepad2, Gauge, MonitorCog, ShieldCheck, Zap,
} from "lucide-react";
import { toast } from "sonner";

export type PerformanceMode = "off" | "game" | "system";

interface PerformanceBoostViewProps {
  mode: PerformanceMode;
  onModeChange: (mode: PerformanceMode) => void;
}

const ModeCard: React.FC<{
  title: string;
  description: string;
  points: string[];
  icon: React.ElementType;
  active: boolean;
  actionLabel: string;
  onClick: () => void;
}> = ({ title, description, points, icon: Icon, active, actionLabel, onClick }) => (
  <section className={`mn-boost-card ${active ? "active" : ""}`}>
    <div className="mn-boost-card-top">
      <span className="mn-boost-icon"><Icon className="w-5 h-5" /></span>
      {active && <span className="mn-boost-active"><Check className="w-3.5 h-3.5" /> Active</span>}
    </div>
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    <ul>
      {points.map((point) => <li key={point}><Check className="w-3.5 h-3.5" />{point}</li>)}
    </ul>
    <button type="button" className={active ? "secondary" : "primary"} onClick={onClick}>
      {actionLabel}
    </button>
  </section>
);

export const PerformanceBoostView: React.FC<PerformanceBoostViewProps> = ({ mode, onModeChange }) => {
  const openWindowsGameMode = async () => {
    const bridge = (window as any).electron;
    if (typeof bridge?.openGameModeSettings !== "function") {
      toast.error("Windows Game Mode is only available in the installed desktop app.");
      return;
    }
    try {
      await bridge.openGameModeSettings();
      toast.success("Windows Game Mode settings opened.");
    } catch (error: any) {
      toast.error(error?.message || "Could not open Windows Game Mode settings.");
    }
  };

  return (
    <div className="mn-boost-page">
      <div className="mn-boost-content">
        <header className="mn-boost-header">
          <div>
            <div className="mn-eyebrow">PERFORMANCE</div>
            <h1>Game &amp; System Boost</h1>
            <p>Safe, reversible modes for reducing MN Game Downloader's own background work.</p>
          </div>
          <span className={`mn-boost-status ${mode === "off" ? "" : "on"}`}>
            <Activity className="w-3.5 h-3.5" /> {mode === "off" ? "Standard mode" : mode === "game" ? "Game focus active" : "System saver active"}
          </span>
        </header>

        <div className="mn-boost-grid">
          <ModeCard
            title="Game Focus"
            description="Keep the downloader quieter while you play. This changes only the app's visual effects and background cover lookups."
            points={["Reduces decorative animations", "Pauses automatic game-cover preloading", "Keeps downloads and upload activity unchanged"]}
            icon={Gamepad2}
            active={mode === "game"}
            actionLabel={mode === "game" ? "Turn off Game Focus" : "Enable Game Focus"}
            onClick={() => onModeChange(mode === "game" ? "off" : "game")}
          />
          <ModeCard
            title="System Saver"
            description="Use a lighter app interface and fewer non-essential status checks when you want to keep background activity low."
            points={["Reduces visual effects", "Pauses automatic cover lookups", "Refreshes the app's status indicators less often"]}
            icon={Gauge}
            active={mode === "system"}
            actionLabel={mode === "system" ? "Turn off System Saver" : "Enable System Saver"}
            onClick={() => onModeChange(mode === "system" ? "off" : "system")}
          />
        </div>

        <section className="mn-boost-windows">
          <span className="mn-boost-windows-icon"><MonitorCog className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <h2>Windows Game Mode</h2>
            <p>Windows controls game prioritisation. Open its own settings to check or enable Game Mode.</p>
          </div>
          <button type="button" onClick={() => void openWindowsGameMode()}>
            Open Windows settings <Zap className="w-3.5 h-3.5" />
          </button>
        </section>

        <section className="mn-boost-safety">
          <span><ShieldCheck className="w-5 h-5" /></span>
          <div>
            <h2>Downloads and your PC stay protected</h2>
            <p>These modes never clear physical RAM, close other apps, change Windows power plans, alter download speeds, pause or stop transfers, or delete files. Windows manages memory automatically; force-clearing it can make apps load more slowly.</p>
          </div>
        </section>

        {mode !== "off" && (
          <button type="button" className="mn-boost-reset" onClick={() => onModeChange("off")}>
            Restore standard app mode
          </button>
        )}
      </div>
    </div>
  );
};