import React, { useEffect, useState } from 'react';
import { Gamepad2, FolderSearch, Play, Download, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, getApiUrl } from '../services/api';
import { formatSize } from '../services/downloadApi';
import { toast } from 'sonner';

export function LibraryView({ active }: { active: boolean }) {
  const [games, setGames] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const desktop = () => (window as any).electron;
  const load = async () => {
    const response = await apiFetch('/api/library');
    if (response.ok) setGames(await response.json());
  };
  const scan = async (choose = false) => {
    setBusy(true);
    try {
      const folder = choose ? await desktop()?.showOpenDialog('Select game library folder') : undefined;
      if (choose && !folder) return;
      const response = await apiFetch('/api/library/scan', { method: 'POST', body: JSON.stringify({ folder }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setGames(result.games);
      setCandidates(result.candidates || []); setSelected([]);
      if (!result.candidates?.length) toast.info("No saved game packages found. Use Repair files on the game page to check an older download.");
      if (result.limited) toast.info('Scan limit reached. Add a more specific game folder.');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => { void load(); desktop()?.getLaunchJobs?.().then(setJobs).catch(() => {}); }, 2000);

    return () => { clearInterval(timer); };
  }, [active]);
  const remove = async (id: string) => {
    try { const response = await apiFetch('/api/library/' + id, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove game');
      setGames(await response.json()); toast.success('Removed from library. Your files are unchanged.');
    } catch (e: any) { toast.error(e.message); }
  };
  const importSelected = async () => {
    setBusy(true);
    try { const response = await apiFetch('/api/library/import', { method: 'POST', body: JSON.stringify({ tokens: selected }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setGames(result); setCandidates([]); setSelected([]);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const locate = async (id?: string) => {
    try {
      if (!desktop()?.chooseGameExecutable) throw new Error('Open the desktop app to select a game executable.');
      await desktop().chooseGameExecutable(id); await load();
    } catch (e: any) { toast.error(e.message); }
  };
  const launch = async (id: string, action: string) => {
    try {
      if (!desktop()?.launchGame) throw new Error('Game launching is available in the desktop app.');
      await desktop().launchGame(id, action);
      setJobs(await desktop().getLaunchJobs());
    } catch (e: any) { toast.error(e.message); }
  };
  return <div className="flex-1 overflow-y-auto p-6 space-y-5">
    <header className="flex flex-wrap gap-3 items-center justify-between"><div><h2 className="text-xl font-black">Game Library</h2><p className="text-xs text-slate-500 mt-1">Your downloaded packages and installed games</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void load()} className="p-2 border rounded-xl" title="Refresh library"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /></button><button disabled={busy} onClick={() => void scan(true)} className="px-3 py-2 border rounded-xl text-sm flex gap-2"><FolderSearch className="w-4" />Scan folder</button></div></header>
    <p className="text-xs text-slate-500">Install opens the repack setup. After installation, the library detects the game from Windows installation records and enables Play. If the installer provides no usable record, use Link installed game. Scan folder finds saved packages for you to review before adding.</p>
    {!!candidates.length && <section className="bg-white border rounded-2xl p-4 space-y-3"><h3 className="font-bold">Choose packages to add</h3><p className="text-xs text-slate-500">Nothing is added until you confirm.</p>{candidates.map(item => <label key={item.token} className="flex items-start gap-3 border-b py-2"><input type="checkbox" checked={selected.includes(item.token)} onChange={event => setSelected(event.target.checked ? [...selected, item.token] : selected.filter(t => t !== item.token))} /><span><strong className="text-sm">{item.name}</strong><span className="block text-xs text-slate-500 break-all">{item.folder}</span></span></label>)}<div className="flex gap-3"><button disabled={busy || !selected.length} onClick={() => void importSelected()} className="bg-emerald-600 text-white px-4 py-2 rounded-xl disabled:opacity-50">Add selected ({selected.length})</button><button onClick={() => setCandidates([])}>Cancel</button></div></section>}
    {!games.length && <div className="p-12 border border-dashed rounded-2xl text-center text-slate-500"><Gamepad2 className="mx-auto mb-3" /><p>No games added yet. Completed downloads appear here automatically.</p></div>}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{games.map(game => <article key={game.id} className="rounded-2xl bg-white border overflow-hidden shadow-sm">
      <div className="h-40 bg-slate-100 flex items-center justify-center">{game.cover ? <img src={getApiUrl(`/api/library/${game.id}/cover`)} alt={game.name} className="w-full h-full object-cover" /> : <Gamepad2 className="w-12 h-12 text-slate-300" />}</div>
      <div className="p-4 space-y-3"><h3 className="font-bold line-clamp-2">{game.name}</h3><p className="text-xs text-slate-500 break-all">{game.folder}</p><p className="text-xs text-slate-500">{formatSize(game.size)} · {game.executable ? 'Ready to play' : game.available ? 'Downloaded package' : 'Folder unavailable — scan its new location'}</p><div className="flex flex-wrap gap-2">
        {game.executable ? <button onClick={() => void launch(game.id, 'play')} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm flex gap-2"><Play className="w-4" />Play</button> : game.available && game.installer && <button onClick={() => void launch(game.id, 'install')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm flex gap-2"><Download className="w-4" />Install</button>}
        <button onClick={() => void locate(game.id)} className="px-3 py-2 rounded-xl border text-sm">Link installed game</button>
        <button onClick={() => void remove(game.id)} title="Remove from library only; files are kept" className="px-3 py-2 rounded-xl border text-sm text-red-600 flex gap-2"><Trash2 className="w-4" />Remove</button>
      </div>{game.verifiedAt && <p className="text-[10px] text-slate-400">Package last verified {new Date(game.verifiedAt).toLocaleString()}</p>}</div>
    </article>)}</div>
    {!!jobs.length && <section className="space-y-3"><h3 className="font-bold">Launch / installation activity</h3><p className="text-xs text-slate-500">Process output and available installer logs are shown below. GUI-only errors and detached child installers may not be observable.</p>{jobs.map(job => <details key={job.id} className="bg-white border rounded-xl p-3" open={job.state === 'failed'}><summary className="text-sm font-semibold cursor-pointer">{job.name} · {job.action} · {job.state}{job.exitCode !== null ? ` (exit ${job.exitCode})` : ''}</summary><pre className="whitespace-pre-wrap text-xs text-slate-600 mt-3 max-h-48 overflow-y-auto">{job.messages.join('\n') || 'No process output captured.'}</pre></details>)}</section>}
  </div>;
}