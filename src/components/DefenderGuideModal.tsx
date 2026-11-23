import React from 'react';
import { ShieldCheck, CheckCircle2, ArrowRight, X, AlertTriangle } from 'lucide-react';

interface DefenderGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToSettings: () => void;
}

export const DefenderGuideModal: React.FC<DefenderGuideModalProps> = ({
  isOpen,
  onClose,
  onGoToSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-white text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center mx-auto mb-3 shadow-inner ring-4 ring-white/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>

          <h2 className="text-lg font-black tracking-tight">
            Windows Security guidance
          </h2>
          <p className="text-xs text-blue-100 mt-1 leading-relaxed">
            Review antivirus settings only when you trust the downloaded files
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900 block mb-0.5">Important security note</span>
              Adding a Microsoft Defender exclusion reduces scanning for that location. MN Game Downloader does not add exclusions automatically or request administrator access for this.
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-600">
            <p className="font-bold text-slate-800">To review exclusions yourself:</p>
            <ol className="list-decimal pl-5 space-y-1.5 leading-relaxed">
              <li>Open Windows Security.</li>
              <li>Go to Virus &amp; threat protection, then Manage settings.</li>
              <li>Open Exclusions and choose Add or remove exclusions.</li>
              <li>Only add a specific folder after you have verified and trust its contents. Do not exclude an entire drive.</li>
            </ol>
            <div className="flex items-start gap-2 pt-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Downloads, temporary files and installers remain protected by Windows Security unless you explicitly change its settings.</span>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              onClick={onGoToSettings}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/20 cursor-pointer"
            >
              <span>View App Settings</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
