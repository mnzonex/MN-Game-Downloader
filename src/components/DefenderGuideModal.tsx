import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, ArrowRight, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { addDefenderExclusion } from '../services/downloadApi';

interface DefenderGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToSettings: () => void;
  onExclusionApplied: () => void;
}

export const DefenderGuideModal: React.FC<DefenderGuideModalProps> = ({
  isOpen,
  onClose,
  onGoToSettings,
  onExclusionApplied,
}) => {
  const [applying, setApplying] = useState(false);

  if (!isOpen) return null;

  const handleApplyNow = async () => {
    setApplying(true);
    try {
      const res = await addDefenderExclusion();
      if (res.ok) {
        toast.success('Windows Defender exclusions applied successfully! 🛡️', {
          description: 'Downloads and game setup files are now protected from false-positive locks.',
        });
        onExclusionApplied();
        onClose();
      } else {
        toast.error(res.error || 'Failed to apply exclusion');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply exclusion');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header with visual shield icon */}
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
            Recommended Action: Antivirus Setup
          </h2>
          <p className="text-xs text-blue-100 mt-1 leading-relaxed">
            Prevent download freezing and corrupt archive errors
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          <div className="bg-blue-50/70 border border-blue-200/70 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <span className="font-bold text-slate-900 block mb-0.5">Why is this required?</span>
              Windows Defender often locks FitGirl repack files (such as <code className="bg-blue-100 font-mono text-[11px] px-1 py-0.5 rounded text-blue-800">unarc.dll</code> or game setups) during download, causing 100% freezing and installation failures.
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-600">
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <span>What this will whitelist:</span>
            </p>
            <div className="space-y-1.5 pl-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Your chosen <strong>Downloads Folder</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Temporary Download Cache (<code className="font-mono text-[10px]">.mn-temp</code>)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>App Engine &amp; Data Directory</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-2">
            <button
              onClick={handleApplyNow}
              disabled={applying}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{applying ? 'Requesting Permission...' : 'Allow Defender Exclusion (1-Click)'}</span>
            </button>

            <button
              onClick={onGoToSettings}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>View in Settings</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>

          <p className="text-[11px] text-center text-slate-400">
            A standard Windows UAC prompt will appear asking for confirmation.
          </p>
        </div>
      </div>
    </div>
  );
};