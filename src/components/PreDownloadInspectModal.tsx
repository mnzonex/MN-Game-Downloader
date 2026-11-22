import React, { useState, useEffect } from 'react';
import {
  X, CheckCircle2, AlertCircle, Loader2, Users, FileText,
  HardDrive, Zap, Clock, ChevronDown, ChevronUp, ArrowRight, ShieldCheck
} from 'lucide-react';
import { inspectTorrent, formatSize } from '../services/downloadApi';
import type { GameDownloadOption, TorrentInspectResult } from '../types';

interface PreDownloadInspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameTitle: string;
  downloadOption: GameDownloadOption | null;
  onInspected?: (data: TorrentInspectResult) => void;
  onProceedToSchedule: (inspectData?: TorrentInspectResult) => void;
  onProceedDownloadNow: (inspectData?: TorrentInspectResult) => Promise<void>;
}

export const PreDownloadInspectModal: React.FC<PreDownloadInspectModalProps> = ({
  isOpen,
  onClose,
  gameTitle,
  downloadOption,
  onInspected,
  onProceedToSchedule,
  onProceedDownloadNow,
}) => {
  const [inspecting, setInspecting] = useState(true);
  const [inspectData, setInspectData] = useState<TorrentInspectResult | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [showFileList, setShowFileList] = useState(false);
  const [isStartingNow, setIsStartingNow] = useState(false);

  const rawUrl = downloadOption ? (Array.isArray(downloadOption.url) ? downloadOption.url[0] : downloadOption.url) : '';

  const runInspection = async () => {
    if (!rawUrl) return;
    setInspecting(true);
    setInspectError(null);
    setInspectData(null);

    try {
      const data = await inspectTorrent(rawUrl, 25);
      setInspectData(data);
      onInspected?.(data);
    } catch (err: any) {
      setInspectError(err.message || 'Inspection timed out or failed to reach peers');
    } finally {
      setInspecting(false);
    }
  };

  useEffect(() => {
    if (isOpen && rawUrl) {
      setShowFileList(false);
      setIsStartingNow(false);
      runInspection();
    }
  }, [isOpen, rawUrl]);

  if (!isOpen || !downloadOption) return null;

  const handleStartNow = async () => {
    setIsStartingNow(true);
    try {
      await onProceedDownloadNow(inspectData || undefined);
      onClose();
    } catch {
      setIsStartingNow(false);
    }
  };

  const handleSchedule = () => {
    onProceedToSchedule(inspectData || undefined);
    onClose();
  };

  const hasFiles = inspectData && inspectData.files && inspectData.files.length > 0;
  const availabilityKnown = inspectData?.availability_known !== false && inspectData?.has_metadata;
  const seedsCount = inspectData?.seeds ?? 0;
  const peersCount = inspectData?.peers ?? 0;
  const isHealthy = seedsCount > 0 || (inspectData?.has_metadata && peersCount > 0);

  return (
    <div className="mn-pre-download-backdrop fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="mn-pre-download-modal bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mn-pre-download-header p-5 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-emerald-50/70 via-slate-50 to-white">
          <div className="space-y-1 pr-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-600 text-white flex items-center gap-1 shadow-xs">
                <ShieldCheck className="w-3 h-3" />
                Availability Check
              </span>
              <span className="text-xs font-semibold text-slate-500">
                FitGirl Repack Swarm
              </span>
            </div>
            <h3 className="font-extrabold text-slate-900 text-base leading-snug line-clamp-1" title={gameTitle}>
              {gameTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[72vh]">
          {/* Status Steps */}
          <div className="mn-pre-download-steps space-y-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
            {/* Step 1: Metadata */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {inspecting ? (
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
                ) : inspectData?.has_metadata ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-800">
                  1. Swarm Connection & Metadata
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {inspecting
                  ? 'Connecting...'
                  : inspectData?.has_metadata
                  ? 'Resolved ✓'
                  : 'DHT search...'}
              </span>
            </div>

            {/* Step 2: Package & Files */}
            <div className="flex items-center justify-between border-t border-slate-200/60 pt-2.5">
              <div className="flex items-center gap-2.5">
                {inspecting ? (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                ) : hasFiles ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-800">
                  2. Repack Archive Contents
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500">
                {inspecting
                  ? 'Scanning files...'
                  : hasFiles
                  ? `${inspectData.filesCount} files (${formatSize(inspectData.totalSize)})`
                  : 'Pending metadata'}
              </span>
            </div>

            {/* Step 3: Seeders Availability */}
            <div className="flex items-center justify-between border-t border-slate-200/60 pt-2.5">
              <div className="flex items-center gap-2.5">
                {inspecting ? (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                ) : isHealthy ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-800">
                  3. Connected Seeders & Peers
                </span>
              </div>
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                {inspecting ? (
                  'Checking swarm...'
                ) : (
                  <>
                    <Users className="w-3 h-3 text-emerald-600" />
                    <span className={seedsCount > 0 ? 'text-emerald-700 font-bold' : 'text-amber-600'}>
                      {availabilityKnown ? `${seedsCount} connected seeders` : 'Seed count not confirmed'}
                    </span>
                    <span className="text-slate-400 font-normal">({inspectData?.availability_known === false ? 'live peers not checked' : `${peersCount} connected peers`})</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Inspection Completed Info Card */}
          {!inspecting && inspectData && (
            <div className="space-y-3">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    {inspectData.has_metadata ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
                    {inspectData.has_metadata ? 'Package metadata resolved' : 'Metadata still unavailable'}
                  </span>
                  {inspectData.totalSize > 0 && (
                    <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-lg text-[11px]">
                      {formatSize(inspectData.totalSize)}
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                  {hasFiles ? (
                    <>
                      Found <strong>{inspectData.filesCount}</strong> installation & repack files in this package. 
                      Integrity hash verification will automatically execute after download before files are finalized.
                    </>
                  ) : (
                    <>
                      File list and exact download size are not available yet. Availability depends on reachable peers.
                    </>
                  )}
                </p>

                {/* Collapsible File List Preview */}
                {hasFiles && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowFileList(!showFileList)}
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      <span>{showFileList ? 'Hide File List' : `View ${inspectData.files.length} Files Inside Repack`}</span>
                      {showFileList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {showFileList && (
                      <div className="mn-pre-download-file-list mt-2 p-2 bg-white/90 rounded-xl border border-emerald-200 max-h-40 overflow-y-auto space-y-1 text-[11px] font-mono shadow-inner">
                        {inspectData.files.map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-slate-700 py-0.5 border-b border-slate-100 last:border-0">
                            <span className="truncate pr-2" title={f.name}>{f.name}</span>
                            <span className="text-slate-400 shrink-0">{formatSize(f.size)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {inspectError && <p role="alert" className="text-xs text-red-700">{inspectError} <button onClick={runInspection} className="underline">Retry inspection</button></p>}
          {!inspecting && <button onClick={runInspection} className="text-xs font-bold text-emerald-700 underline">Refresh availability</button>}
          {/* Notice if seeds are low / timeout */}
          {!inspecting && (!inspectData?.has_metadata || seedsCount === 0) && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                Availability is still being discovered
              </p>
              <p className="text-[11px] text-amber-700 leading-normal">
                This is a short connection sample, not the total swarm count. Peers can supply pieces even when no complete seed is connected yet. Download Now continues discovery; counts can increase afterwards.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mn-pre-download-footer p-4 px-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isStartingNow}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSchedule}
              disabled={isStartingNow}
              className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-extrabold text-xs transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>Schedule</span>
            </button>

            <button
              type="button"
              onClick={handleStartNow}
              disabled={isStartingNow}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs text-white transition-all flex items-center gap-2 shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            >
              {isStartingNow ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Download Now</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};