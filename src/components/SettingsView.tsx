import React, { useState, useEffect, useRef } from "react";
import { FolderOpen, HardDrive, Info, Save, Moon, Sun, Shield, ShieldCheck, ShieldAlert, Gauge } from "lucide-react";
import { toast } from "sonner";
import { getSettings, saveSettings, addDefenderExclusion } from "../services/downloadApi";
import type { DownloadSettings } from "../types";

interface SettingsViewProps {
  isDarkMode?: boolean;
  onToggleDark?: (dark: boolean) => void;
  highlightExclusion?: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isDarkMode = false,
  onToggleDark,
  highlightExclusion = false,
}) => {
  const [settings, setSettings] = useState<Partial<DownloadSettings>>({
    download_path: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const exclusionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSettings()
      .then(s => setSettings(s))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (highlightExclusion && exclusionRef.current) {
      setTimeout(() => {
        exclusionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }
  }, [highlightExclusion]);

  const handleSelectFolder = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const path = await (window as any).electron.showOpenDialog();
      if (path) {
        setSettings(s => ({ ...s, download_path: path }));
      }
    } catch (e) {
      toast.error('Failed to open folder picker');
    }
  };

  const [excluding, setExcluding] = useState(false);

  const handleAddExclusion = async () => {
    setExcluding(true);
    try {
      const res = await addDefenderExclusion();
      if (res.ok) {
        setSettings(s => ({ ...s, defender_excluded: '1' }));
        try {
          await saveSettings({ defender_excluded: '1' });
        } catch {}
        toast.success('Windows Defender exclusions applied! 🛡️', {
          description: 'Downloads, .mn-temp, and app folders are now excluded from Antivirus locks.',
        });
      } else {
        toast.error(res.error || 'Failed to add Defender exclusions');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply exclusions');
    } finally {
      setExcluding(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
      toast.success('Settings saved successfully');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-slate-400">Loading...</div>;

  return (
    <div className="flex-1 h-full bg-slate-50 overflow-y-auto p-6 flex flex-col items-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">App Settings</h1>
          <p className="text-sm text-slate-500 mt-2 font-medium">Configure download engine preferences</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-6 space-y-6 relative overflow-hidden">

          {/* Appearance Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-2">
              {isDarkMode ? <Moon className="w-5 h-5 text-indigo-500" /> : <Sun className="w-5 h-5 text-amber-500" />}
              <h2>Appearance</h2>
            </div>

            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-sm font-bold text-slate-800">Theme Mode</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isDarkMode ? 'Dark mode is active' : 'Light mode is active (default)'}
                </p>
              </div>

              {/* Toggle Switch: left = Light (white), right = Dark */}
              <button
                onClick={() => onToggleDark && onToggleDark(!isDarkMode)}
                title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className={`relative inline-flex items-center w-14 h-7 rounded-full transition-colors duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isDarkMode
                    ? 'bg-indigo-600 focus:ring-indigo-500'
                    : 'bg-slate-200 focus:ring-slate-400'
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${
                    isDarkMode ? 'translate-x-7 bg-white' : 'translate-x-0.5 bg-white'
                  }`}
                >
                  {isDarkMode ? (
                    <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Storage Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-2">
              <HardDrive className="w-5 h-5 text-emerald-600" />
              <h2>Storage</h2>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Download Location</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={settings.download_path || ''}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-600 focus:outline-none"
                  placeholder="C:\Users\Username\Downloads"
                />
                <button
                  onClick={handleSelectFolder}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-2 transition-colors shrink-0 font-semibold text-sm cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  Browse
                </button>
              </div>
              <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-1.5">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                Completed downloads will be moved here. Temp files are stored securely in AppData.
              </p>
            </div>
          </div>

          {/* Bandwidth & Speed Limit Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-2">
              <Gauge className="w-5 h-5 text-indigo-600" />
              <h2>Bandwidth & Speed Limit</h2>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-800">Maximum Download Speed</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Limit download bandwidth to prevent slowing down internet for other household devices.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {[
                  { label: 'Unlimited', desc: 'Full Speed (Default)', value: '0' },
                  { label: '2 MB/s', desc: '~16 Mbps cap', value: '2097152' },
                  { label: '5 MB/s', desc: '~40 Mbps cap', value: '5242880' },
                  { label: '10 MB/s', desc: '~80 Mbps cap', value: '10485760' },
                ].map(opt => {
                  const currentVal = settings.speed_limit || '0';
                  const isSelected = currentVal === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSettings(s => ({ ...s, speed_limit: opt.value }))}
                      className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-900 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-sm flex items-center justify-between">
                        {opt.label}
                        {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Applies immediately to both FitGirl BitTorrent repacks and EroLabs direct downloads.
              </p>
            </div>
          </div>

          {/* Antivirus & Windows Defender Exclusion */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-800 font-bold border-b border-slate-100 pb-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h2>Antivirus & Security</h2>
            </div>

            <div
              ref={exclusionRef}
              className={`p-4 rounded-2xl transition-all duration-500 space-y-3 ${
                highlightExclusion
                  ? 'bg-blue-50 border-2 border-blue-500 ring-4 ring-blue-500/25 shadow-md shadow-blue-500/10'
                  : 'bg-blue-50/50 border border-blue-200/80'
              }`}
            >
              {highlightExclusion && (
                <div className="bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 animate-bounce shadow-xs">
                  <span>👉</span>
                  <span>Click "Add Exclusion (1-Click)" below to protect downloads from antivirus errors!</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-blue-600 shrink-0" />
                      Add Windows Defender Exclusion
                    </p>
                    {settings.defender_excluded === '1' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        Active &amp; Protected ✅
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                        Recommended ⚠️
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-md">
                    Prevents Windows Defender from false-positive locking repack files (like <code className="bg-blue-100/70 text-blue-800 font-mono px-1 py-0.5 rounded text-[11px]">unarc.dll</code> or game setups) during download and installation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddExclusion}
                  disabled={excluding}
                  className={`text-white rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 shrink-0 transition-all shadow-xs cursor-pointer disabled:opacity-50 ${
                    highlightExclusion
                      ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400 ring-offset-2 scale-105'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <ShieldAlert className="w-4 h-4" />
                  {excluding ? 'Applying...' : settings.defender_excluded === '1' ? 'Re-apply Exclusion' : 'Add Exclusion (1-Click)'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Excludes Downloads folder, <span className="font-mono text-[10px]">.mn-temp</span>, and app data from Windows Antivirus scans.
              </p>
            </div>
          </div>

          {/* Engine Info */}
          <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
            <h3 className="font-bold text-emerald-800 text-sm flex items-center gap-1.5">
              <ZapIcon /> Download Engine Active
            </h3>
            <ul className="text-xs text-emerald-700/80 mt-2 space-y-1 list-disc list-inside">
              <li>BitTorrent DHT &amp; Local Peer Discovery enabled</li>
              <li>uTP (Micro Transport Protocol) &amp; UPnP active</li>
              <li>Sparse storage mode (instant start)</li>
              <li>No seeding — torrents are removed automatically upon completion</li>
              <li>EroLabs direct downloads auto-resume on connection loss</li>
              <li>Downloads auto-pause on app close and resume safely</li>
            </ul>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-6 py-2.5 text-sm font-bold flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ZapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
);


