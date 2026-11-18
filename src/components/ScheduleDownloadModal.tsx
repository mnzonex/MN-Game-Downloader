import React, { useState, useEffect } from 'react';
import {
  Calendar, Clock, Download, X, Sparkles, AlertCircle,
  Zap, CheckCircle2, Loader2, ArrowRight, Moon
} from 'lucide-react';
import { GameDownloadOption } from '../types';

interface ScheduleDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameTitle: string;
  downloadOption: GameDownloadOption | null;
  siteBadge?: string;
  onConfirmNow: () => Promise<void>;
  onConfirmSchedule: (scheduledAtMs: number) => Promise<void>;
}

export const ScheduleDownloadModal: React.FC<ScheduleDownloadModalProps> = ({
  isOpen,
  onClose,
  gameTitle,
  downloadOption,
  siteBadge = 'FITGIRL',
  onConfirmNow,
  onConfirmSchedule,
}) => {
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isErolabs = siteBadge === 'EROLABS';

  // Helper to format Date to 'YYYY-MM-DDTHH:mm' for datetime-local input
  const formatForInput = (d: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Initialize with a default of +30 minutes when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode('now');
      setValidationError(null);
      setIsSubmitting(false);

      const defaultTime = new Date(Date.now() + 30 * 60 * 1000);
      setScheduledDateTime(formatForInput(defaultTime));
    }
  }, [isOpen]);

  if (!isOpen || !downloadOption) return null;

  // Preset time offsets in minutes
  const applyPresetMinutes = (minutes: number) => {
    const target = new Date(Date.now() + minutes * 60 * 1000);
    setScheduledDateTime(formatForInput(target));
    setValidationError(null);
  };

  // Preset for upcoming Midnight (12:00 AM) — exact start of night time data
  const applyPresetMidnight = () => {
    const d = new Date();
    // Midnight belongs to the next calendar date at 00:00:00 (12:00 AM)
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    setScheduledDateTime(formatForInput(d));
    setValidationError(null);
  };

  // Preset for specific hour (e.g. 1 AM, 2 AM, 11 PM)
  const applyPresetHour = (targetHour: number, isTomorrow: boolean = false) => {
    const d = new Date();
    if (isTomorrow) {
      d.setDate(d.getDate() + 1);
    } else {
      // If hour already passed today, push to tomorrow
      if (d.getHours() >= targetHour) {
        d.setDate(d.getDate() + 1);
      }
    }
    d.setHours(targetHour, 0, 0, 0);
    setScheduledDateTime(formatForInput(d));
    setValidationError(null);
  };

  // Calculate human-friendly description of selected schedule
  const getScheduleSummary = () => {
    if (!scheduledDateTime) return null;
    const target = new Date(scheduledDateTime);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();

    if (isNaN(target.getTime())) return null;
    if (diffMs <= 0) return { error: 'Please choose a future time.' };

    const diffMins = Math.round(diffMs / (60 * 1000));
    const diffHours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;

    let relativeText = '';
    if (diffMins < 60) {
      relativeText = `in ${diffMins} minute${diffMins === 1 ? '' : 's'}`;
    } else if (remMins === 0) {
      relativeText = `in ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    } else {
      relativeText = `in ${diffHours}h ${remMins}m`;
    }

    const formattedDate = target.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const formattedTime = target.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const isMidnight = target.getHours() === 0 && target.getMinutes() === 0;

    return {
      text: isMidnight
        ? `Starts ${formattedDate} at 12:00 AM Midnight (${relativeText}) — 🌙 Night Time Data`
        : `Starts ${formattedDate} at ${formattedTime} (${relativeText})`,
      targetMs: target.getTime(),
      isMidnight,
    };
  };

  const scheduleInfo = getScheduleSummary();

  const handleConfirm = async () => {
    if (mode === 'now') {
      setIsSubmitting(true);
      try {
        await onConfirmNow();
        onClose();
      } catch (err: any) {
        setValidationError(err.message || 'Failed to start download');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (!scheduleInfo || scheduleInfo.error || !scheduleInfo.targetMs) {
        setValidationError(scheduleInfo?.error || 'Please select a valid future date & time');
        return;
      }

      setIsSubmitting(true);
      try {
        await onConfirmSchedule(scheduleInfo.targetMs);
        onClose();
      } catch (err: any) {
        setValidationError(err.message || 'Failed to schedule download');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const minDateTime = formatForInput(new Date(Date.now() + 60 * 1000));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="space-y-1 pr-4">
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md text-white ${
                  isErolabs ? 'bg-rose-600' : 'bg-emerald-600'
                }`}
              >
                {siteBadge}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {downloadOption.label || (isErolabs ? 'Direct HTTP' : 'Magnet Link')}
              </span>
            </div>
            <h3 className="font-extrabold text-slate-900 text-lg leading-snug line-clamp-1" title={gameTitle}>
              {gameTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Mode Selector Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Option 1: Download Now */}
            <button
              type="button"
              onClick={() => {
                setMode('now');
                setValidationError(null);
              }}
              className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                mode === 'now'
                  ? isErolabs
                    ? 'border-rose-500 bg-rose-50/50 shadow-sm'
                    : 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    mode === 'now'
                      ? isErolabs
                        ? 'bg-rose-500 text-white'
                        : 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Zap className="w-5 h-5" />
                </div>
                {mode === 'now' && (
                  <CheckCircle2
                    className={`w-5 h-5 ${isErolabs ? 'text-rose-600' : 'text-emerald-600'}`}
                  />
                )}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-sm">Download Now</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Start downloading immediately</p>
              </div>
            </button>

            {/* Option 2: Schedule */}
            <button
              type="button"
              onClick={() => {
                setMode('schedule');
                setValidationError(null);
              }}
              className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                mode === 'schedule'
                  ? isErolabs
                    ? 'border-rose-500 bg-rose-50/50 shadow-sm'
                    : 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    mode === 'schedule'
                      ? isErolabs
                        ? 'bg-rose-500 text-white'
                        : 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Clock className="w-5 h-5" />
                </div>
                {mode === 'schedule' && (
                  <CheckCircle2
                    className={`w-5 h-5 ${isErolabs ? 'text-rose-600' : 'text-emerald-600'}`}
                  />
                )}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-sm">Schedule</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Pick date & time to auto-start</p>
              </div>
            </button>
          </div>

          {/* Schedule Configuration (shown when mode === 'schedule') */}
          {mode === 'schedule' && (
            <div className="space-y-4 pt-1 animate-in fade-in duration-200">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Select Start Date & Time
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    min={minDateTime}
                    value={scheduledDateTime}
                    onChange={(e) => {
                      setScheduledDateTime(e.target.value);
                      setValidationError(null);
                    }}
                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-slate-900 font-semibold text-sm focus:outline-none focus:border-emerald-500 focus:bg-white transition-all shadow-inner"
                  />
                </div>
              </div>

              {/* Quick Preset Chips */}
              <div className="space-y-3 pt-1">
                {/* Night-time Data Presets */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1">
                    <Moon className="w-3.5 h-3.5 text-indigo-600" />
                    Night Time Data Presets (රාත්‍රී Data පැකේජ සඳහා):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={applyPresetMidnight}
                      className="px-3 py-2 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-md shadow-indigo-600/25 flex items-center gap-2 cursor-pointer border border-indigo-700"
                    >
                      <Moon className="w-4 h-4 fill-current text-indigo-200" />
                      <span>Midnight (12:00 AM)</span>
                      <span className="bg-indigo-800/90 text-[10px] px-2 py-0.5 rounded-lg text-indigo-100 uppercase tracking-wide font-bold">
                        Night Data
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetHour(1, true)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Moon className="w-3 h-3 text-indigo-500" />
                      <span>1:00 AM</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetHour(2, true)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Moon className="w-3 h-3 text-indigo-500" />
                      <span>2:00 AM</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetHour(23, false)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                    >
                      Tonight (11:00 PM)
                    </button>
                  </div>
                </div>

                {/* Quick Time Offsets */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Quick Timer Offsets:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyPresetMinutes(15)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border border-slate-200"
                    >
                      +15 min
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetMinutes(30)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border border-slate-200"
                    >
                      +30 min
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetMinutes(60)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border border-slate-200"
                    >
                      +1 hour
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPresetMinutes(120)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border border-slate-200"
                    >
                      +2 hours
                    </button>
                  </div>
                </div>

                {/* Night Data Tip */}
                <p className="text-[11px] text-indigo-600/90 font-medium bg-indigo-50/60 border border-indigo-100 rounded-xl p-2.5">
                  💡 <strong>රෑ 12 (Midnight) යනු 12:00 AM වේ:</strong> අද දිනය අවසන් වී ඊළඟ දවස උදාවන මොහොත (Night Time Data ආරම්භ වන වෙලාව) සඳහා <strong>Midnight (12:00 AM)</strong> තෝරන්න.
                </p>
              </div>

              {/* Schedule Preview Banner */}
              {scheduleInfo && !scheduleInfo.error && (
                <div
                  className={`p-3.5 rounded-2xl text-xs font-medium flex items-center gap-2.5 border ${
                    isErolabs
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  <Clock
                    className={`w-4 h-4 shrink-0 ${isErolabs ? 'text-rose-600' : 'text-emerald-600'}`}
                  />
                  <span>{scheduleInfo.text}</span>
                </div>
              )}

              {/* Queue Explanation Tip */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] text-slate-600 space-y-1">
                <p className="font-bold text-slate-700 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Sequential Queue Enabled
                </p>
                <p>
                  When this time arrives, the download starts automatically. If another download is actively
                  running, this item will stay queued as pending and start as soon as the first one finishes!
                </p>
              </div>
            </div>
          )}

          {/* Validation Error Message */}
          {validationError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{validationError}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || (mode === 'schedule' && !!scheduleInfo?.error)}
            className={`px-6 py-2.5 rounded-xl font-extrabold text-xs text-white transition-all flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-50 ${
              isErolabs
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : mode === 'now' ? (
              <>
                <Zap className="w-4 h-4" />
                <span>Start Download Now</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                <span>Confirm Schedule</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};