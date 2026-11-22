import React, { useState } from "react";
import {
  AlertCircle, CheckCircle2, ExternalLink, Gamepad2, Heart,
  MessageCircle, RefreshCw, Sparkles, Download,
} from "lucide-react";
import { AppVersionInfo } from "../types";
import { apiFetch } from "../services/api";

interface AboutAndSupportViewProps {
  versionInfo: AppVersionInfo | null;
  onOpenDonateModal: () => void;
  bgUpdateState?: "idle" | "checking" | "downloading" | "downloaded" | "error";
  bgUpdateProgress?: number;
  bgUpdateVersion?: string;
  onRestartAndInstall?: () => void;
  isInstallingUpdate?: boolean;
}

export const AboutAndSupportView: React.FC<AboutAndSupportViewProps> = ({
  versionInfo,
  onOpenDonateModal,
  bgUpdateState = "idle",
  bgUpdateProgress = 0,
  bgUpdateVersion = "",
  onRestartAndInstall,
  isInstallingUpdate = false,
}) => {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const currentVersion = versionInfo?.currentVersion || "1.2.11";

  const showMessage = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const response = await apiFetch("/api/version");
      if (!response.ok) throw new Error("Update service is unavailable.");
      const data = await response.json();
      if (data.isUpdateAvailable) {
        showMessage(`Version ${data.latestVersion} is available and will download in the background.`);
      } else {
        showMessage(`You're up to date — version ${data.currentVersion}.`);
      }
    } catch (error: any) {
      showMessage(error?.message || "Couldn't check for updates. Try again later.");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <div className="mn-about-page">
      <div className="mn-about-content">
        {toastMessage && <div className="mn-about-toast" role="status">{toastMessage}</div>}

        <header className="mn-about-hero">
          <div className="mn-about-brand">
            <span className="mn-about-logo"><Gamepad2 className="w-7 h-7" /></span>
            <div>
              <div className="mn-eyebrow">ABOUT THE APP</div>
              <h1>MN Game Downloader</h1>
              <p>Discover, manage and download PC games in one place.</p>
            </div>
          </div>
          <span className="mn-about-version">Version {currentVersion}</span>
        </header>

        <section className="mn-about-support-grid">
          <article className="mn-about-card">
            <span className="mn-about-card-icon support"><MessageCircle className="w-5 h-5" /></span>
            <div>
              <h2>Need help?</h2>
              <p>Report a problem, request a game or ask for support.</p>
            </div>
            <a href="https://wa.me/94776941748" target="_blank" rel="noopener noreferrer">
              Contact support <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </article>

          <article className="mn-about-card">
            <span className="mn-about-card-icon donate"><Heart className="w-5 h-5" /></span>
            <div>
              <h2>Support development</h2>
              <p>Contributions help with maintenance and future improvements.</p>
            </div>
            <button type="button" onClick={onOpenDonateModal}>
              Support the project <Heart className="w-3.5 h-3.5" />
            </button>
          </article>
        </section>

        <section className="mn-about-update">
          <div className="mn-about-update-top">
            <span className="mn-about-card-icon update"><Download className="w-5 h-5" /></span>
            <div className="min-w-0 flex-1">
              <h2>App updates</h2>
              <p>Keep the app up to date with the latest improvements.</p>
            </div>
            {bgUpdateState === "downloaded" ? (
              <button type="button" onClick={onRestartAndInstall} disabled={isInstallingUpdate}>
                {isInstallingUpdate ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Restart &amp; install
              </button>
            ) : bgUpdateState === "downloading" ? (
              <span className="mn-about-update-state"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Downloading {bgUpdateProgress}%</span>
            ) : (
              <button type="button" onClick={() => void handleCheckUpdate()} disabled={isCheckingUpdate}>
                {isCheckingUpdate ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isCheckingUpdate ? "Checking…" : "Check for updates"}
              </button>
            )}
          </div>

          {bgUpdateState === "downloading" && (
            <div className="mn-about-progress"><span style={{ width: `${Math.max(0, Math.min(100, bgUpdateProgress))}%` }} /></div>
          )}
          {bgUpdateState === "downloaded" && (
            <div className="mn-about-update-note"><CheckCircle2 className="w-4 h-4" /> Version {bgUpdateVersion || "new version"} is ready to install. Your downloads and settings are kept.</div>
          )}
          {bgUpdateState === "error" && (
            <div className="mn-about-update-note error"><AlertCircle className="w-4 h-4" /> Update check failed. You can try again.</div>
          )}
        </section>

        <p className="mn-about-footnote">Your downloads, library and settings remain stored on this PC.</p>
      </div>
    </div>
  );
};