import React from "react";
import { Wifi, WifiOff, Info } from "lucide-react";
import { AppVersionInfo } from "../types";

interface TitleBarProps {
  isOnline: boolean;
  versionInfo: AppVersionInfo | null;
  onOpenAboutModal: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isOnline,
  versionInfo,
  onOpenAboutModal,
}) => (
  <header className="mn-topbar h-[54px] shrink-0 flex items-center justify-between gap-3 px-5 select-none">
    <div className="flex items-center gap-3 min-w-0">
      <div className="mn-title-mark" aria-hidden="true">MN</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <strong className="text-[13px] font-bold tracking-tight truncate" style={{ color: "var(--mn-text)" }}>MN Game Downloader</strong>
          <span className="mn-version-pill">v{versionInfo?.currentVersion || "1.2.29"}</span>
        </div>
        <p className="text-[10px] leading-3 mt-0.5" style={{ color: "var(--mn-text-muted)" }}>Desktop game discovery & download manager</p>
      </div>
    </div>

    <div className="flex items-center gap-2">
      <div className={`mn-connectivity-pill ${isOnline ? "online" : "offline"}`} title={isOnline ? "Internet connection available" : "No internet connection"}>
        {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
        <span>{isOnline ? "Internet available" : "Offline"}</span>
      </div>
      <button type="button" onClick={onOpenAboutModal} className="mn-topbar-icon" aria-label="About MN Game Downloader" title="About">
        <Info className="w-4 h-4" />
      </button>
    </div>
  </header>
);