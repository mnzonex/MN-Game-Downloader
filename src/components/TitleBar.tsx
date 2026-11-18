import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Sparkles, ExternalLink, Minus, Square, X } from 'lucide-react';
import { AppVersionInfo } from '../types';

interface TitleBarProps {
  isOnline: boolean;
  versionInfo: AppVersionInfo | null;
  onOpenAboutModal: () => void;
  onOpenDonateModal: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isOnline,
  versionInfo,
  onOpenAboutModal,
  onOpenDonateModal,
}) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="bg-white text-slate-800 border-b border-slate-200/90 flex items-center justify-between px-3.5 py-2 select-none text-xs sticky top-0 z-50 shadow-xs">
      {/* App Branding & Window Title */}
      <div className="flex items-center space-x-2.5">
        <div className="w-5.5 h-5.5 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-white text-[11px] shadow-sm shadow-emerald-500/30">
          MN
        </div>
        <span className="font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
          MN Game Downloader
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono font-semibold border border-slate-200">
            v{versionInfo?.currentVersion || '1.1.4'}
          </span>
        </span>
        <span className="hidden sm:inline-block text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
          MN ZONEX
        </span>
      </div>

      {/* Middle Status Indicators */}
      <div className="flex items-center space-x-3">
        {/* Real-time System Clock */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] px-3 py-0.5 rounded-lg font-mono font-bold border text-slate-700 bg-slate-50 border-slate-200 shadow-sm">
          {formatTime(time)}
        </div>

        {/* Network Online Status */}
        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-[11px] font-medium ${
          isOnline 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
            : 'bg-rose-50 border-rose-200 text-rose-700 font-semibold animate-pulse'
        }`}>
          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          <span>{isOnline ? 'Online' : 'No Internet'}</span>
        </div>
      </div>

      {/* Window Controls & Support */}
      <div className="flex items-center space-x-2">
        <a
          href="https://wa.me/94776941748"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold transition-colors"
          title="Direct WhatsApp Support: 0776941748"
        >
          <span>Support</span>
          <ExternalLink className="w-3 h-3" />
        </a>

        <button 
          onClick={onOpenDonateModal}
          className="hidden sm:flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
        >
          <span>Donate</span>
        </button>

        <button 
          onClick={onOpenAboutModal}
          className="px-2.5 py-0.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium transition-colors text-[11px] cursor-pointer"
        >
          About
        </button>

        {/* Window Controls */}
        <div className="flex items-center space-x-1 pl-2 border-l border-slate-200">
          <button className="p-1 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-900">
            <Minus className="w-3 h-3" />
          </button>
          <button className="p-1 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-900">
            <Square className="w-2.5 h-2.5" />
          </button>
          <button className="p-1 hover:bg-rose-100 rounded-md text-slate-500 hover:text-rose-600">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};