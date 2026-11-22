import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gamepad2, Play, RefreshCw, Search, Loader2, MonitorDown, Library,
  Plus, X, FolderOpen, MoreHorizontal, ImagePlus, Check, MinusCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface InstalledGame {
  id: string;
  name: string;
  source: string;
  sourceId: string;
  appId?: string;
  installLocation: string;
  executable?: string;
  launcherPath?: string;
  launchUri?: string;
  coverUrl?: string;
  coverDataUrl?: string;
  iconDataUrl?: string;
  isManual?: boolean;
}

const nativeBridge = () => (window as any).electron;

const InstalledGameCard: React.FC<{
  game: InstalledGame;
  launching: boolean;
  uploadingCover: boolean;
  onPlay: (game: InstalledGame) => void;
  onUploadCover: (game: InstalledGame) => void;
  onRemoveFromLibrary: (game: InstalledGame) => void;
}> = ({ game, launching, uploadingCover, onPlay, onUploadCover, onRemoveFromLibrary }) => {
  const [coverFailed, setCoverFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasCoverArt = !coverFailed && Boolean(game.coverDataUrl || game.coverUrl);
  const iconArt = !iconFailed ? game.iconDataUrl || '' : '';
  const artwork = hasCoverArt ? (game.coverDataUrl || game.coverUrl || '') : iconArt;
  const artworkKind = hasCoverArt ? 'cover' : iconArt ? 'icon' : 'fallback';
  useEffect(() => { setCoverFailed(false); setIconFailed(false); }, [game.coverDataUrl, game.coverUrl, game.iconDataUrl]);

  return (
    <article className={`mn-installed-card ${game.isManual ? 'is-manual' : ''}`}>
      <div className={`mn-installed-art ${artworkKind === 'icon' ? 'has-file-icon' : ''} ${artworkKind === 'cover' ? 'has-cover-art' : ''}`}>
        {artwork ? (
          <img
            className={`mn-installed-art-image ${artworkKind === 'icon' ? 'is-file-icon' : 'is-cover-art'}`}
            src={artwork}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => artworkKind === 'cover' ? setCoverFailed(true) : setIconFailed(true)}
          />
        ) : (
          <div className="mn-installed-fallback">
            <Gamepad2 className="w-10 h-10" />
            <span>{game.name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        <div className="mn-installed-art-shade" />
        <span className="mn-installed-source">{game.isManual ? 'MANUAL' : game.source}</span>
        {game.isManual && (
          <div className="mn-installed-card-menu">
            <button
              type="button"
              className="mn-installed-menu-trigger"
              onClick={() => setMenuOpen(value => !value)}
              aria-label={'More options for ' + game.name}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="mn-installed-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onUploadCover(game); }}
                  disabled={uploadingCover}
                >
                  {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  <span>{game.coverDataUrl ? 'Change cover image' : 'Upload cover image'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="mn-installed-menu-remove"
                  onClick={() => { setMenuOpen(false); onRemoveFromLibrary(game); }}
                >
                  <MinusCircle className="w-4 h-4" />
                  <span>Remove from Library</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mn-installed-details">
        <h3 title={game.name}>{game.name}</h3>
        <div className="mn-installed-meta">
          <span className="mn-installed-ready"><i /> {game.isManual ? 'Added manually' : 'Installed'}</span>
          {game.appId && <span className="mn-installed-id">#{game.appId}</span>}
        </div>
        <button
          type="button"
          className="mn-installed-play"
          onClick={() => onPlay(game)}
          disabled={launching}
        >
          {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{launching ? 'Opening…' : 'Play'}</span>
        </button>
      </div>
    </article>
  );
};

export function LibraryView({ active }: { active: boolean }) {
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [uploadingCoverId, setUploadingCoverId] = useState<string | null>(null);
  const [gamePendingRemoval, setGamePendingRemoval] = useState<InstalledGame | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [gameName, setGameName] = useState('');
  const [launcherPath, setLauncherPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async (force = false) => {
    const bridge = nativeBridge();
    if (typeof bridge?.getInstalledGames !== 'function') {
      setError('Installed-game detection is available in the Windows desktop app.');
      setLoading(false);
      return;
    }

    if (force) setRefreshing(true);
    try {
      const result = await bridge.getInstalledGames(force);
      if (!Array.isArray(result)) throw new Error('Windows returned an invalid game list.');
      setGames(result);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Installed games could not be detected.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load(false);
    const interval = window.setInterval(() => { void load(false); }, 60000);
    return () => window.clearInterval(interval);
  }, [active, load]);

  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return games;
    return games.filter(game =>
      game.name.toLowerCase().includes(query) || game.source.toLowerCase().includes(query)
    );
  }, [games, searchQuery]);

  const play = async (game: InstalledGame) => {
    const bridge = nativeBridge();
    if (typeof bridge?.launchInstalledGame !== 'function') {
      toast.error('Game launching is only available in the Windows desktop app.');
      return;
    }
    setLaunchingId(game.id);
    try {
      await bridge.launchInstalledGame(game.id);
      toast.success('Opening ' + game.name);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The game could not be opened.');
    } finally {
      setLaunchingId(null);
    }
  };

  const browseLauncher = async () => {
    const bridge = nativeBridge();
    if (typeof bridge?.chooseManualGameLauncher !== 'function') {
      setAddError('The Windows file picker is not available.');
      return;
    }
    try {
      const selected = await bridge.chooseManualGameLauncher();
      if (!selected) return;
      setLauncherPath(selected);
      if (!gameName.trim()) {
        const filename = selected.split(/[\\/]/).pop() || '';
        setGameName(filename.replace(/\.(exe|lnk)$/i, '').replace(/[._-]+/g, ' ').trim());
      }
      setAddError('');
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'Could not open the file picker.');
    }
  };

  const addGame = async (event: React.FormEvent) => {
    event.preventDefault();
    const bridge = nativeBridge();
    if (typeof bridge?.addManualGame !== 'function') {
      setAddError('Manual game registration is available in the Windows desktop app.');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      await bridge.addManualGame(gameName.trim(), launcherPath.trim());
      await load(true);
      setAddOpen(false);
      setGameName('');
      setLauncherPath('');
      toast.success('Added ' + gameName.trim() + ' to your Library');
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'The game could not be added.');
    } finally {
      setAdding(false);
    }
  };

  const uploadCover = async (game: InstalledGame) => {
    const bridge = nativeBridge();
    if (typeof bridge?.chooseManualGameCover !== 'function') {
      toast.error('Cover image upload is available in the Windows desktop app.');
      return;
    }
    setUploadingCoverId(game.id);
    try {
      const result = await bridge.chooseManualGameCover(game.id);
      if (!result) return;
      await load(true);
      toast.success('Cover image updated for ' + game.name);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The cover image could not be saved.');
    } finally {
      setUploadingCoverId(null);
    }
  };

  const confirmRemoveFromLibrary = async () => {
    if (!gamePendingRemoval) return;
    const game = gamePendingRemoval;
    const bridge = nativeBridge();
    if (typeof bridge?.removeManualGame !== 'function') {
      toast.error('Removing games from the Library is only available in the Windows desktop app.');
      return;
    }

    setRemovingGameId(game.id);
    try {
      const result = await bridge.removeManualGame(game.id);
      if (!result?.ok) throw new Error('The game could not be removed from your Library.');
      setGamePendingRemoval(null);
      await load(true);
      toast.success(game.name + ' was removed from your Library. Its game files were kept.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The game could not be removed from your Library.');
    } finally {
      setRemovingGameId(null);
    }
  };

  const closeAddModal = () => {
    if (adding) return;
    setAddOpen(false);
    setAddError('');
  };

  return (
    <div className="mn-library-page">
      <div className="mn-library-content">
        <header className="mn-library-header">
          <div>
            <p className="mn-eyebrow">YOUR PC GAME COLLECTION</p>
            <h1>Game Library</h1>
          </div>
          <div className="mn-library-actions">
            <label className="mn-library-search">
              <Search className="w-4 h-4 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Find a game…"
                aria-label="Search installed games"
              />
            </label>
            <button
              type="button"
              className="mn-library-refresh"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              aria-label="Refresh installed games"
              title="Refresh installed games"
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button type="button" className="mn-library-add" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" />
              <span>Add Game</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="mn-library-error" role="alert">
            <MonitorDown className="w-5 h-5 shrink-0" />
            <span>{error}</span>
            <button type="button" onClick={() => void load(true)}>Retry</button>
          </div>
        )}

        {loading && (
          <div className="mn-installed-grid" aria-label="Loading installed games">
            {Array.from({ length: 8 }).map((_, index) => (
              <div className="mn-installed-skeleton" key={index}>
                <div className="mn-installed-skeleton-art" />
                <div className="mn-installed-skeleton-line" />
                <div className="mn-installed-skeleton-button" />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && games.length === 0 && (
          <div className="mn-library-empty">
            <div className="mn-library-empty-icon"><Library className="w-7 h-7" /></div>
            <h2>No games in your Library yet</h2>
            <p>Installed games are detected automatically. You can also add a game using its desktop shortcut or launcher file.</p>
            <button type="button" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> Add your first game
            </button>
          </div>
        )}

        {!loading && !error && games.length > 0 && visibleGames.length === 0 && (
          <div className="mn-library-empty compact">
            <Search className="w-6 h-6" />
            <h2>No matching games</h2>
            <p>Try a different game title or store name.</p>
          </div>
        )}

        {!loading && !error && visibleGames.length > 0 && (
          <div className="mn-installed-grid">
            {visibleGames.map(game => (
              <InstalledGameCard
                key={game.id}
                game={game}
                launching={launchingId === game.id}
                uploadingCover={uploadingCoverId === game.id}
                onPlay={play}
                onUploadCover={uploadCover}
                onRemoveFromLibrary={setGamePendingRemoval}
              />
            ))}
          </div>
        )}

        {!loading && !error && games.length > 0 && (
          <div className="mn-library-footer">
            {visibleGames.length} {visibleGames.length === 1 ? 'game' : 'games'}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="mn-add-game-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeAddModal(); }}>
          <section className="mn-add-game-modal" role="dialog" aria-modal="true" aria-labelledby="mn-add-game-title">
            <header className="mn-add-game-modal-header">
              <div className="mn-add-game-modal-icon"><Gamepad2 className="w-5 h-5" /></div>
              <div>
                <p className="mn-eyebrow">PERSONAL COLLECTION</p>
                <h2 id="mn-add-game-title">Add a game</h2>
              </div>
              <button type="button" className="mn-add-game-close" onClick={closeAddModal} aria-label="Close add game dialog">
                <X className="w-4 h-4" />
              </button>
            </header>
            <form onSubmit={addGame} className="mn-add-game-form">
              <label className="mn-add-game-field">
                <span>Game name</span>
                <input
                  value={gameName}
                  onChange={event => setGameName(event.target.value)}
                  placeholder="e.g. Need for Speed Most Wanted"
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
              <label className="mn-add-game-field">
                <span>Game launcher path</span>
                <div className="mn-add-game-path-row">
                  <input
                    value={launcherPath}
                    onChange={event => setLauncherPath(event.target.value)}
                    placeholder="Paste a .exe or .lnk shortcut path"
                    required
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => void browseLauncher()}>
                    <FolderOpen className="w-4 h-4" />
                    <span>Browse</span>
                  </button>
                </div>
              </label>
              <p className="mn-add-game-hint">Browse to your Desktop and select the game's shortcut, or paste the full path to the game .exe / .lnk file.</p>
              {addError && <p className="mn-add-game-error" role="alert">{addError}</p>}
              <footer className="mn-add-game-footer">
                <button type="button" className="mn-add-game-cancel" onClick={closeAddModal} disabled={adding}>Cancel</button>
                <button type="submit" className="mn-add-game-submit" disabled={adding || !gameName.trim() || !launcherPath.trim()}>
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{adding ? 'Adding…' : 'Add to Library'}</span>
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {gamePendingRemoval && (
        <div
          className="mn-add-game-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !removingGameId) setGamePendingRemoval(null);
          }}
        >
          <section className="mn-add-game-modal mn-remove-library-modal" role="dialog" aria-modal="true" aria-labelledby="mn-remove-library-title">
            <header className="mn-add-game-modal-header">
              <div className="mn-add-game-modal-icon mn-remove-library-icon"><MinusCircle className="w-5 h-5" /></div>
              <div>
                <p className="mn-eyebrow">PERSONAL COLLECTION</p>
                <h2 id="mn-remove-library-title">Remove from Library?</h2>
              </div>
              <button
                type="button"
                className="mn-add-game-close"
                onClick={() => setGamePendingRemoval(null)}
                disabled={Boolean(removingGameId)}
                aria-label="Close remove game dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="mn-remove-library-body">
              <p><strong>{gamePendingRemoval.name}</strong> will be removed from your MN Game Downloader Library.</p>
              <p>The installed game, desktop shortcut, cover image and all game files will stay on your PC. This does not uninstall or delete the game.</p>
            </div>
            <footer className="mn-add-game-footer">
              <button
                type="button"
                className="mn-add-game-cancel"
                onClick={() => setGamePendingRemoval(null)}
                disabled={Boolean(removingGameId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mn-remove-library-confirm"
                onClick={() => void confirmRemoveFromLibrary()}
                disabled={Boolean(removingGameId)}
              >
                {removingGameId ? <Loader2 className="w-4 h-4 animate-spin" /> : <MinusCircle className="w-4 h-4" />}
                <span>{removingGameId ? 'Removing…' : 'Remove from Library'}</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}