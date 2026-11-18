import { Star, X } from 'lucide-react';

const RATE_URL = 'https://mnsoftvault.vercel.app/apps/mn-game-downloader';

export function RateAppModal({ isDarkMode, onClose }: { isDarkMode: boolean; onClose: () => void }) {
  return (
    <div className="rate-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="rate-app-title" className={`rate-modal-card ${isDarkMode ? 'rate-modal-dark' : ''}`}>
        <button type="button" aria-label="Close rate prompt" onClick={onClose} className="rate-modal-close"><X size={17} /></button>
        <div className="rate-modal-icon"><Star size={25} fill="currentColor" /></div>
        <p className="rate-modal-eyebrow">ENJOYING MN GAME DOWNLOADER?</p>
        <h2 id="rate-app-title">Rate it</h2>
        <p className="rate-modal-copy">Your rating helps other gamers discover the app.</p>
        <button type="button" className="rate-modal-button" onClick={() => window.open(RATE_URL, '_blank', 'noopener,noreferrer')}>
          <Star size={17} fill="currentColor" /> Rate
        </button>
      </section>
    </div>
  );
}