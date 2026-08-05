import React, { useState } from 'react';
import { Sparkles, Download, X, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { AppVersionInfo } from '../types';

interface UpdateModalProps {
  versionInfo: AppVersionInfo;
  onCloseModal: () => void;
  onAcceptUpdate: () => void;
  onDeferUpdate: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  versionInfo,
  onCloseModal,
  onAcceptUpdate,
  onDeferUpdate
}) => {
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  const handleStartUpdate = () => {
    setUpdating(true);
    setUpdateProgress(100);
    setTimeout(() => {
      onAcceptUpdate();
    }, 500);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-600/20">
              <Sparkles className="w-5 h-5" />
            </div>

            <div>
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <span>Update Available: v{versionInfo.latestVersion}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                  {versionInfo.updateSize}
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                MN Game Downloader Official Release
              </p>
            </div>
          </div>

          <button
            onClick={onCloseModal}
            className="text-slate-400 hover:text-slate-700 text-xs p-1 hover:bg-slate-100 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mandatory Enforcement Warning Banner */}
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Update Enforcement Policy:</span>
          </div>
          <p className="text-amber-800 pl-5 text-[11px] font-medium">
            Deferring this update allows you to play local library games, but strictly disables Game Scraper and Search functions until updated.
          </p>
        </div>

        {/* Changelog Items */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Changelog & Improvements:
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-xs text-slate-700 max-h-40 overflow-y-auto font-medium">
            {versionInfo.changelog.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Developer Info */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 font-medium">
          <span>Publisher: <strong className="text-slate-900">{versionInfo.developer}</strong></span>
          <span>({versionInfo.nickname})</span>
        </div>

        {/* Updating Progress state */}
        {updating ? (
          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs font-mono font-bold text-emerald-700">
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                <span>Downloading Update Package...</span>
              </span>
              <span>{updateProgress}%</span>
            </div>

            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-emerald-600 transition-all duration-200"
                style={{ width: `${updateProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleStartUpdate}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-colors shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Update Now ({versionInfo.updateSize})</span>
            </button>

            <button
              onClick={onDeferUpdate}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Update Later
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

