import React from 'react';
import { Search, Download, Gamepad2, Info, ShieldAlert, Cpu, PhoneCall } from 'lucide-react';

export type NavTab = 'search' | 'downloads' | 'library' | 'about';

interface NavigationSidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  activeDownloadsCount: number;
  completedGamesCount: number;
  isUpdateRequiredBlocked: boolean;
  isOnline: boolean;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  activeTab,
  setActiveTab,
  activeDownloadsCount,
  completedGamesCount,
  isUpdateRequiredBlocked
}) => {
  const navItems = [
    {
      id: 'search' as NavTab,
      label: 'Browse Games',
      badge: 'Popular',
      badgeColor: 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold',
      icon: Search
    },
    {
      id: 'downloads' as NavTab,
      label: 'Downloads Queue',
      badge: activeDownloadsCount > 0 ? `${activeDownloadsCount}` : undefined,
      badgeColor: 'bg-emerald-600 text-white font-bold',
      icon: Download
    },
    {
      id: 'library' as NavTab,
      label: 'Games Library',
      badge: completedGamesCount > 0 ? `${completedGamesCount}` : undefined,
      badgeColor: 'bg-slate-200 text-slate-800 font-bold',
      icon: Gamepad2
    },
    {
      id: 'about' as NavTab,
      label: 'About & Support',
      badge: 'MN Dev',
      icon: Info
    }
  ];

  return (
    <aside className="w-60 bg-white border-r border-slate-200/90 flex flex-col justify-between select-none shadow-xs">
      <div className="p-3.5 space-y-4">
        {/* Header Branding Panel */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="w-8.5 h-8.5 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-white text-sm shadow-sm shadow-emerald-500/20">
              MN
            </div>
            <div>
              <h1 className="font-extrabold text-slate-900 text-sm tracking-tight leading-tight">
                MN Downloader
              </h1>
              <p className="text-[11px] text-emerald-700 font-mono font-semibold">
                Downloader Engine v1.0
              </p>
            </div>
          </div>
          
          <div className="mt-2.5 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Dev:</span>
            <span className="text-slate-800 font-bold">H M MADHUSHA NIMSARA</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Navigation
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isDisabled = (item as any).disabled;

            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && setActiveTab(item.id)}
                disabled={isDisabled}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-xs'
                    : isDisabled
                    ? 'opacity-40 cursor-not-allowed text-slate-400'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge && !isDisabled && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.badgeColor || 'bg-slate-100 text-slate-600'}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info Box */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50/80 space-y-2.5">
        {isUpdateRequiredBlocked && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[10px] text-amber-800 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Update Pending</p>
              <p className="text-amber-700">Scraper disabled until app update is installed.</p>
            </div>
          </div>
        )}

        <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 text-[11px] space-y-1.5 shadow-xs">
          <div className="flex items-center justify-between text-slate-600">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-emerald-600" />
              <span>WebTorrent:</span>
            </span>
            <span className="text-emerald-700 font-mono font-bold">Engine Active</span>
          </div>
        </div>

        <a
          href="https://wa.me/94776941748"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
        >
          <PhoneCall className="w-3.5 h-3.5" />
          <span>WhatsApp Support</span>
        </a>
      </div>
    </aside>
  );
};

