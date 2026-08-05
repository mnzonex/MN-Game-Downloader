import React, { useState } from 'react';
import { MessageSquare, ExternalLink, Cpu, CheckCircle, Code, RefreshCw, Sparkles } from 'lucide-react';
import { AppVersionInfo } from '../types';

interface AboutAndSupportViewProps {
  versionInfo: AppVersionInfo | null;
  onOpenUpdateModal: () => void;
  onOpenDonateModal: () => void;
}

export const AboutAndSupportView: React.FC<AboutAndSupportViewProps> = ({
  versionInfo,
  onOpenUpdateModal,
  onOpenDonateModal
}) => {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      
      if (data.isUpdateAvailable) {
        onOpenUpdateModal();
      } else {
        setToastMessage(`You are running the latest version (v${data.currentVersion}).`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (e) {
      console.error(e);
      setToastMessage("Failed to check for updates. Try again later.");
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 text-slate-900 overflow-y-auto p-6 space-y-6 relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="bg-slate-900 text-white px-5 py-2.5 rounded-full text-xs shadow-xl font-bold border border-slate-700">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Developer Hero Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-md relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-600 flex items-center justify-center font-black text-white text-2xl shadow-md shadow-emerald-600/20">
              MN
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  MN Game Downloader
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold">
                  v{versionInfo?.currentVersion || '1.0.0'}
                </span>
              </div>

              <p className="text-xs text-slate-500 font-medium mt-1">
                Resilient Desktop Game Downloader, Multi-Site Scraper & Auto 7-Zip Extractor
              </p>

              <div className="mt-2 text-xs flex flex-wrap items-center gap-3">
                <span className="text-slate-600 font-medium">Developer: <strong className="text-slate-900 font-bold">H M MADHUSHA NIMSARA</strong></span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-600 font-medium">Handle: <strong className="text-emerald-700 font-bold">MN ZONEX Dev</strong></span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {/* WhatsApp Direct Action Button */}
            <a
              href="https://wa.me/94776941748"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-6 py-3 rounded-xl text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 group cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 fill-white" />
              <span>Report Bug / Request Game</span>
              <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </a>
            
            <button
              onClick={onOpenDonateModal}
              className="bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 font-extrabold px-6 py-3 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Donate (Support Development)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Developer Metadata & Direct Contact Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Official Developer Details */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Code className="w-4 h-4 text-emerald-600" />
            <span>Publisher & Author Metadata</span>
          </h3>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Official Publisher Name:</span>
              <span className="text-slate-900 font-bold">H M MADHUSHA NIMSARA</span>
            </div>

            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Developer Nickname:</span>
              <span className="text-emerald-700 font-mono font-bold">MN ZONEX Dev</span>
            </div>

            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500 font-medium">WhatsApp Support Line:</span>
              <span className="text-slate-900 font-mono font-bold">0776941748 (+94 77 694 1748)</span>
            </div>

            <div className="flex justify-between py-1">
              <span className="text-slate-500 font-medium">Direct Link:</span>
              <a
                href="https://wa.me/94776941748"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 hover:underline font-mono font-bold flex items-center gap-1"
              >
                https://wa.me/94776941748
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Card 2: Core System Specifications */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-600" />
            <span>Engine & Architecture Rules</span>
          </h3>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs text-slate-700 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span><strong>Antivirus Exclusion:</strong> Auto-executes PowerShell command for <code>%AppData%\MN Game Downloader</code></span>
            </div>

            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span><strong>Network Resilience:</strong> Infinite retry loop for internet drops without losing byte offset progress</span>
            </div>

            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span><strong>Direct Scraper Engine:</strong> FitGirl Repacks fast multi-part download mirror parsing</span>
            </div>

            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span><strong>7-Zip Unpacking:</strong> Bundled background ZIP/RAR extractor for seamless one-click launch</span>
            </div>
          </div>
        </div>
      </div>

      {/* Version & Update Action Card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm">System Version & Update Enforcement</h3>
            <p className="text-xs text-slate-500 font-medium">Current version: v{versionInfo?.currentVersion || '1.0.0'}</p>
          </div>

          <button
            onClick={handleCheckUpdate}
            disabled={isCheckingUpdate}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors flex items-center gap-2 shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            {isCheckingUpdate ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isCheckingUpdate ? 'Checking...' : 'Check for App Updates'}</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium space-y-1 pt-1 border-t border-slate-100">
          <p>• Mandatory update rule: Outdated app versions disable Scraper and Search functions while keeping Local Library active.</p>
          <p>• Reconnection listener monitors online events to resume downloads automatically.</p>
        </div>
      </div>
    </div>
  );
};

