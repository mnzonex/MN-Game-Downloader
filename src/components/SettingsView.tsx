import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen, HardDrive, Info, Moon, Sun, Gauge, CheckCircle2,
  Loader2, AlertCircle, Settings2, Download, Globe2, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { getSettings, saveSettings } from "../services/downloadApi";
import type { DownloadSettings } from "../types";

interface SettingsViewProps {
  isDarkMode: boolean;
  onToggleDark: (dark: boolean) => void;
}

type SettingsTab = "general" | "downloads" | "network";
type SaveState = "saved" | "saving" | "error";
type ThemeChoice = "light" | "dark";

const tabs: { id: SettingsTab; label: string; description: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", description: "Appearance and app behaviour", icon: Settings2 },
  { id: "downloads", label: "Downloads", description: "Default save location", icon: Download },
  { id: "network", label: "Network", description: "Bandwidth limits", icon: Globe2 },
];

const speedOptions = [
  { label: "Unlimited", description: "Use available bandwidth", value: "0" },
  { label: "2 MB/s", description: "Light usage", value: "2097152" },
  { label: "5 MB/s", description: "Balanced", value: "5242880" },
  { label: "10 MB/s", description: "Faster downloads", value: "10485760" },
];

const defaultSettings: Partial<DownloadSettings> = {
  download_path: "",
  speed_limit: "0",
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  isDarkMode,
  onToggleDark,
}) => {
  const [settings, setSettings] = useState<Partial<DownloadSettings>>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const loadedRef = useRef(false);
  const lastSavedRef = useRef<Partial<DownloadSettings>>({});
  const pendingPatchRef = useRef<Partial<DownloadSettings>>({});
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;

    const version = saveVersionRef.current;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveSettings(patch);
        lastSavedRef.current = { ...lastSavedRef.current, ...patch };
        if (version === saveVersionRef.current && Object.keys(pendingPatchRef.current).length === 0) {
          setSaveState("saved");
          setSaveError("");
        }
      })
      .catch((error: unknown) => {
        pendingPatchRef.current = { ...patch, ...pendingPatchRef.current };
        if (version === saveVersionRef.current) {
          setSaveState("error");
          setSaveError(error instanceof Error ? error.message : "The settings could not be saved.");
        }
      });
  }, []);

  const queueSettingSave = useCallback((key: keyof DownloadSettings, value: string) => {
    if (!loadedRef.current) return;
    pendingPatchRef.current = { ...pendingPatchRef.current, [key]: value };
    saveVersionRef.current += 1;
    setSaveState("saving");
    setSaveError("");
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushPending, 450);
  }, [flushPending]);

  useEffect(() => {
    let active = true;
    getSettings()
      .then((value) => {
        if (!active) return;
        const knownKeys: (keyof DownloadSettings)[] = [
          "download_path", "port_range", "max_download_speed", "max_upload_speed",
          "seed_after_done", "speed_limit", "appearance",
        ];
        const known = Object.fromEntries(
          knownKeys.filter((key) => typeof value?.[key] === "string")
            .map((key) => [key, value[key]])
        ) as Partial<DownloadSettings>;

        const merged = { ...defaultSettings, ...known };
        setSettings(merged);
        lastSavedRef.current = merged;
        loadedRef.current = true;
        if (merged.appearance === "light" || merged.appearance === "dark") {
          onToggleDark(merged.appearance === "dark");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSaveState("error");
          setSaveError(error instanceof Error ? error.message : "Settings could not be loaded.");
          toast.error("Failed to load your saved settings");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [onToggleDark]);

  const updateSetting = <K extends keyof DownloadSettings>(key: K, value: DownloadSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    queueSettingSave(key, String(value));
  };

  const chooseTheme = (theme: ThemeChoice) => {
    onToggleDark(theme === "dark");
    updateSetting("appearance", theme);
  };

  const retrySave = () => {
    setSaveState("saving");
    setSaveError("");
    flushPending();
  };

  const handleSelectFolder = async () => {
    try {
      const bridge = (window as any).electron;
      if (typeof bridge?.showOpenDialog !== "function") {
        toast.error("Folder selection is only available in the desktop app.");
        return;
      }
      const selectedPath = await bridge.showOpenDialog("Choose a folder for new downloads");
      if (typeof selectedPath === "string" && selectedPath.trim()) {
        updateSetting("download_path", selectedPath);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "The folder picker could not be opened.");
    }
  };

  const selectedTab = tabs.find((tab) => tab.id === activeTab)!;

  if (loading) {
    return (
      <div className="mn-settings-loading" role="status">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading saved preferences…</span>
      </div>
    );
  }

  return (
    <div className="mn-settings-page">
      <div className="mn-settings-content">
        <header className="mn-settings-header">
          <div>
            <p className="mn-eyebrow">PREFERENCES</p>
            <h1>Settings</h1>
            <p className="mn-settings-subtitle">Make MN Game Downloader work the way you prefer.</p>
          </div>
          <div className={`mn-save-status ${saveState}`} role="status" aria-live="polite">
            {saveState === "saving" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving changes</>
            ) : saveState === "error" ? (
              <><AlertCircle className="w-4 h-4" /> Save failed <button type="button" onClick={retrySave}>Retry</button></>
            ) : (
              <><CheckCircle2 className="w-4 h-4" /> All changes saved</>
            )}
          </div>
        </header>

        {saveState === "error" && saveError && (
          <div className="mn-settings-error" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{saveError}</span>
            <button type="button" onClick={retrySave}>Try again</button>
          </div>
        )}

        <div className="mn-settings-layout">
          <nav className="mn-settings-nav" aria-label="Settings sections">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="mn-settings-nav-item"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="mn-settings-nav-icon"><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className="block text-[11px] mt-0.5">{tab.description}</span>
                  </span>
                  {selected && <ChevronRight className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </nav>

          <section className="mn-settings-section" aria-labelledby="settings-section-title">
            <div className="mn-settings-section-header">
              <div>
                <h2 id="settings-section-title">{selectedTab.label}</h2>
                <p>{selectedTab.description}</p>
              </div>
              <span className="mn-settings-section-number">{tabs.findIndex((tab) => tab.id === activeTab) + 1} / {tabs.length}</span>
            </div>

            {activeTab === "general" && (
              <div className="mn-settings-group">
                <div className="mn-setting-row">
                  <div className="mn-setting-icon amber"><Sun className="w-5 h-5" /></div>
                  <div className="mn-setting-copy">
                    <h3>Appearance</h3>
                    <p>Choose the colour theme for every screen in the app.</p>
                  </div>
                  <div className="mn-theme-choice" role="group" aria-label="Appearance">
                    <button type="button" aria-pressed={!isDarkMode} className={!isDarkMode ? "selected" : ""} onClick={() => chooseTheme("light")}>
                      <Sun className="w-4 h-4" /> Light
                    </button>
                    <button type="button" aria-pressed={isDarkMode} className={isDarkMode ? "selected" : ""} onClick={() => chooseTheme("dark")}>
                      <Moon className="w-4 h-4" /> Dark
                    </button>
                  </div>
                </div>
                <div className="mn-settings-note"><Info className="w-4 h-4" /> Theme changes apply immediately and are saved locally on this PC.</div>
                <div className="mn-setting-row">
                  <div className="mn-setting-icon blue"><Info className="w-5 h-5" /></div>
                  <div className="mn-setting-copy">
                    <h3>Anonymous usage analytics</h3>
                    <p>We collect anonymous app usage analytics solely to understand how MN Game Downloader is used and improve its features and reliability.</p>
                  </div>
                  <span className="mn-static-value">Always on</span>
                </div>
                <div className="mn-settings-note"><Info className="w-4 h-4" /> This includes app launches, feature usage, selected game sources, game titles and download outcomes. We do not send magnet links, download URLs, local file paths, usernames or raw error messages. Events are saved locally while offline and sent when the internet connection returns.</div>
                <div className="mn-setting-row">
                  <div className="mn-setting-icon neutral"><Settings2 className="w-5 h-5" /></div>
                  <div className="mn-setting-copy">
                    <h3>App mode</h3>
                    <p>Runs locally on this computer. No account, sign-in or cloud profile is used.</p>
                  </div>
                  <span className="mn-static-value">Local only</span>
                </div>
              </div>
            )}

            {activeTab === "downloads" && (
              <div className="mn-settings-group">
                <div className="mn-setting-row">
                  <div className="mn-setting-icon green"><HardDrive className="w-5 h-5" /></div>
                  <div className="mn-setting-copy">
                    <h3>Default download location</h3>
                    <p>Choose where new downloads will be stored.</p>
                  </div>
                </div>
                <label className="mn-field-label" htmlFor="download-location">Download folder</label>
                <div className="mn-folder-control">
                  <input id="download-location" type="text" readOnly value={settings.download_path || ""} placeholder="Choose a folder…" />
                  <button type="button" onClick={handleSelectFolder}><FolderOpen className="w-4 h-4" /> Browse</button>
                </div>
                <div className="mn-settings-note"><Info className="w-4 h-4" /> New downloads use this folder. Existing, paused and active downloads keep their original destination.</div>
              </div>
            )}

            {activeTab === "network" && (
              <div className="mn-settings-group">
                <div className="mn-setting-row">
                  <div className="mn-setting-icon blue"><Gauge className="w-5 h-5" /></div>
                  <div className="mn-setting-copy">
                    <h3>Download speed limit</h3>
                    <p>Set a maximum speed for supported download engines.</p>
                  </div>
                </div>
                <div className="mn-speed-options">
                  {speedOptions.map((option) => {
                    const selected = (settings.speed_limit || "0") === option.value;
                    return (
                      <button key={option.value} type="button" aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => updateSetting("speed_limit", option.value)}>
                        <span>{option.label}</span>
                        <small>{option.description}</small>
                        {selected && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                    );
                  })}
                </div>
                <div className="mn-settings-note"><Info className="w-4 h-4" /> Unlimited means no app-imposed speed cap. Your internet connection and source server still determine actual speeds.</div>
                <div className="mn-setting-row compact">
                  <div className="mn-setting-copy">
                    <h3>Peer connection ports</h3>
                    <p>Current configured range for torrent connections.</p>
                  </div>
                  <span className="mn-static-value">{settings.port_range || "6881-6891"}</span>
                </div>
              </div>
            )}

          </section>
        </div>

        <footer className="mn-settings-footer">Downloads, Library data and preferences stay on this PC. No account is required.</footer>
      </div>
    </div>
  );
};