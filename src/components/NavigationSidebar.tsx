import React, { useState } from "react";
import {
  Compass, Settings, Download, PanelLeftClose, PanelLeftOpen,
  Library, Activity, Info, Zap, Globe2,
} from "lucide-react";

export type NavTab = "search" | "universal" | "library" | "downloads" | "boost" | "health" | "settings" | "about";

interface NavigationSidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  versionInfo?: { currentVersion: string } | null;
  activeDownloadCount?: number;
}

const workspaceItems: Array<{ id: NavTab; label: string; icon: React.ElementType; description: string }> = [
  { id: "search", label: "Discover", icon: Compass, description: "Browse individual game sources" },
  { id: "universal", label: "Universal Search", icon: Globe2, description: "Search every connected game source at once" },
  { id: "library", label: "Game Library", icon: Library, description: "Your installed and saved games" },
  { id: "downloads", label: "Downloads", icon: Download, description: "Queue, transfers and history" },
];

const appItems: Array<{ id: NavTab; label: string; icon: React.ElementType; description: string }> = [
  { id: "boost", label: "Game & System Boost", icon: Zap, description: "Safe game focus and app saver modes" },
  { id: "health", label: "Performance", icon: Activity, description: "CPU, memory, storage and download status" },
  { id: "settings", label: "Settings", icon: Settings, description: "App preferences" },
];

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  setActiveTab,
  versionInfo,
  activeDownloadCount = 0,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("mn_sidebar_collapsed") === "true"; } catch { return false; }
  });

  const toggleCollapse = () => setIsCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem("mn_sidebar_collapsed", String(next)); } catch {}
    return next;
  });

  const collapseButton = (
    <button
      type="button"
      onClick={toggleCollapse}
      className="mn-sidebar-collapse"
      title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
      aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
    >
      {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
    </button>
  );

  const renderItem = (item: (typeof workspaceItems)[number]) => {
    const Icon = item.icon;
    const selected = activeTab === item.id;
    const badge = item.id === "downloads" && activeDownloadCount > 0 ? activeDownloadCount : null;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setActiveTab(item.id)}
        title={isCollapsed ? item.description : undefined}
        aria-current={selected ? "page" : undefined}
        className={`mn-sidebar-link ${selected ? "active" : ""} ${isCollapsed ? "collapsed" : ""}`}
      >
        <span className="mn-sidebar-link-icon"><Icon className="w-[19px] h-[19px]" strokeWidth={1.9} /></span>
        {!isCollapsed && <span className="min-w-0 flex-1">{item.label}</span>}
        {!isCollapsed && badge !== null && <span className="mn-sidebar-count">{badge}</span>}
        {isCollapsed && badge !== null && <span className="mn-sidebar-count-dot">{badge > 99 ? "99+" : badge}</span>}
      </button>
    );
  };

  const renderTool = (item: (typeof appItems)[number]) => {
    const Icon = item.icon;
    const selected = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setActiveTab(item.id)}
        title={isCollapsed ? item.description : undefined}
        aria-current={selected ? "page" : undefined}
        className={`mn-sidebar-link ${selected ? "active" : ""} ${isCollapsed ? "collapsed" : ""}`}
      >
        <span className="mn-sidebar-link-icon"><Icon className="w-[19px] h-[19px]" strokeWidth={1.9} /></span>
        {!isCollapsed && <span className="min-w-0 flex-1">{item.label}</span>}
      </button>
    );
  };

  return (
    <aside className={`mn-sidebar flex flex-col shrink-0 ${isCollapsed ? "collapsed" : ""}`}>
      <div className="mn-sidebar-top">
        <div className={`mn-sidebar-brand ${isCollapsed ? "is-collapsed" : ""}`}>
          <div className="mn-brand-mark" aria-hidden="true">MN</div>
          {!isCollapsed ? (
            <div className="mn-sidebar-brand-copy">
              <div className="mn-sidebar-brand-title-row">
                <strong>MN ZONEX</strong>
                {collapseButton}
              </div>
              <div className="mn-sidebar-brand-meta">
                <span>GAME WORKSPACE</span>
                <span className="mn-sidebar-version">v{versionInfo?.currentVersion || "1.2.29"}</span>
              </div>
            </div>
          ) : collapseButton}
        </div>

        <nav className="mn-sidebar-nav" aria-label="Workspace">
          {!isCollapsed && <div className="mn-sidebar-section-label">WORKSPACE</div>}
          {workspaceItems.map(renderItem)}
        </nav>

        <nav className="mn-sidebar-nav" aria-label="System tools">
          {!isCollapsed && <div className="mn-sidebar-section-label">SYSTEM</div>}
          {appItems.map(renderTool)}
        </nav>
      </div>

      <div className="mn-sidebar-bottom">
        <button
          type="button"
          onClick={() => setActiveTab("about")}
          aria-current={activeTab === "about" ? "page" : undefined}
          title={isCollapsed ? "About & Support" : undefined}
          className={`mn-sidebar-link ${activeTab === "about" ? "active" : ""} ${isCollapsed ? "collapsed" : ""}`}
        >
          <span className="mn-sidebar-link-icon"><Info className="w-[19px] h-[19px]" strokeWidth={1.9} /></span>
          {!isCollapsed && <span className="flex-1">About & Support</span>}
        </button>

      </div>
    </aside>
  );
};