import React, { useState } from 'react';
import { Search, Info, Settings, Download, PanelLeftClose, PanelLeftOpen, MessageCircle } from 'lucide-react';

export type NavTab = 'search' | 'downloads' | 'settings' | 'about';

interface NavigationSidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  versionInfo?: { currentVersion: string } | null;
  activeDownloadCount?: number;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  setActiveTab,
  versionInfo,
  activeDownloadCount = 0,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mn_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('mn_sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  };

  const navItems: {
    id: NavTab;
    label: string;
    badge?: string;
    badgeColor?: string;
    icon: React.ElementType;
  }[] = [
    {
      id: 'search',
      label: 'Browse Games',
      badge: 'Popular',
      badgeColor: 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold',
      icon: Search,
    },
    {
      id: 'downloads',
      label: 'Downloads',
      badge: activeDownloadCount > 0 ? String(activeDownloadCount) : undefined,
      badgeColor: 'bg-blue-100 text-blue-800 border border-blue-200 font-bold animate-pulse',
      icon: Download,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
    },
    {
      id: 'about',
      label: 'About & Support',
      badge: 'MN Dev',
      badgeColor: 'bg-slate-100 text-slate-600 font-bold',
      icon: Info,
    },
  ];

  return (
    <aside
      className={`bg-white border-r border-slate-200/90 flex flex-col justify-between select-none shadow-xs transition-all duration-300 ${
        isCollapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      <div className="p-3 space-y-3">
        {/* Header Branding & Collapse Toggle */}
        <div className={`rounded-xl bg-slate-50 border border-slate-200/80 shadow-xs transition-all ${
          isCollapsed ? 'p-2 flex flex-col items-center gap-2' : 'p-3'
        }`}>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div
                onClick={isCollapsed ? toggleCollapse : undefined}
                className={`w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-white text-sm shadow-sm shadow-emerald-500/20 shrink-0 ${
                  isCollapsed ? 'cursor-pointer hover:bg-emerald-500 transition-colors' : ''
                }`}
                title={isCollapsed ? 'Click to expand sidebar' : undefined}
              >
                MN
              </div>
              {!isCollapsed && (
                <div className="overflow-hidden">
                  <h1 className="font-extrabold text-slate-900 text-sm tracking-tight leading-tight truncate">
                    MN Downloader
                  </h1>
                  <p className="text-[11px] text-emerald-700 font-mono font-semibold">
                    v{versionInfo?.currentVersion || '1.1.4'}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={toggleCollapse}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {!isCollapsed && (
            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Dev:</span>
              <span className="text-slate-800 font-bold truncate">H M MADHUSHA NIMSARA</span>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {!isCollapsed && (
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Navigation
            </div>
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <div key={item.id} className="relative group">
                <button
                  onClick={() => setActiveTab(item.id)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isCollapsed
                      ? 'justify-center p-2.5'
                      : 'justify-between px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  <div className={`flex items-center ${isCollapsed ? 'relative' : 'space-x-2.5'}`}>
                    <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-500'}`} />
                    {!isCollapsed && <span>{item.label}</span>}
                    {isCollapsed && item.badge && (
                      <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold shadow-xs">
                        {item.badge}
                      </span>
                    )}
                  </div>

                  {!isCollapsed && item.badge && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.badgeColor || 'bg-slate-100 text-slate-600'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>

                {/* Floating Tooltip in Collapsed Mode */}
                {isCollapsed && (
                  <div className="absolute left-full ml-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap flex items-center gap-1.5">
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500 text-slate-900 font-bold">
                        {item.badge}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className={`border-t border-slate-200 bg-slate-50/80 transition-all ${
        isCollapsed ? 'p-2 space-y-2' : 'p-3.5 space-y-2.5'
      }`}>
        {/* Engine info (expanded only) */}
        {!isCollapsed && (
          <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 text-[11px] space-y-1 shadow-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span>Engine:</span>
              </span>
              <span className="text-emerald-700 font-mono font-bold">Built-in</span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium leading-snug">
              DHT + uTP + LSD + UPnP active
            </p>
          </div>
        )}

        {/* WhatsApp Support Button */}
        <a
          href="https://wa.me/94776941748"
          target="_blank"
          rel="noopener noreferrer"
          title={isCollapsed ? 'WhatsApp Support' : undefined}
          className={`flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors shadow-sm cursor-pointer ${
            isCollapsed ? 'p-2.5' : 'w-full py-2.5'
          }`}
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span>WhatsApp Support</span>}
        </a>
      </div>
    </aside>
  );
};