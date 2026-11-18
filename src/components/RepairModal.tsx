import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../services/api';
import { formatSize } from '../services/downloadApi';
import { Loader2, ShieldCheck, X } from 'lucide-react';

async function request(action: string, body: any) {
  const response = await apiFetch('/api/torrent/repair/' + action, { method: 'POST', body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Repair request failed');
  return data;
}
export function RepairModal({ magnet, folder, title, cover, onClose, onStarted }: {
  magnet: string; folder: string; title: string; cover?: string; onClose: () => void; onStarted: () => void;
}) {
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const scanId = useRef<string>();
  const confirmed = useRef(false);
  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async (id: string) => {
      try {
        const data = await request('status', { id });
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        if (data.report) setReport(data.report);
        else timer = setTimeout(() => void poll(id), 1000);
      } catch (e: any) { if (!cancelled) setError(e.message); }
    };
    request('scan', { magnetLink: magnet, folder, gameName: title }).then(data => {
      scanId.current = data.id;
      if (cancelled) void request('cancel', { id: data.id }).catch(() => {});
      else void poll(data.id);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => {
      cancelled = true; clearTimeout(timer);
      if (scanId.current && !confirmed.current) void request('cancel', { id: scanId.current }).catch(() => {});
    };
  }, [magnet, folder]);
  const confirm = async () => {
    setStarting(true); setError('');
    try {
      await request('confirm', { id: scanId.current, gameName: title, coverUrl: cover });
      confirmed.current = true; onStarted();
    } catch (e: any) { setError(e.message); setStarting(false); }
  };
  const damaged = report?.files.filter((f: any) => f.status !== 'ok') || [];
  const files = showAll ? report?.files || [] : damaged;
  return <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
    <section role="dialog" aria-label="Check game files" className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
      <header className="p-5 border-b flex items-center justify-between"><div><h2 className="font-extrabold text-lg">Check game files</h2><p className="text-sm text-slate-500">{title}</p></div><button disabled={starting} onClick={onClose} aria-label="Close repair"><X /></button></header>
      <div className="p-5 overflow-y-auto space-y-4">
        <p className="text-xs text-slate-500 break-all">{folder}</p><p className="text-xs text-slate-500">Choose the original downloaded repack containing setup.exe and archive files. Installed game files differ from the repack and cannot be repaired with this magnet.</p>
        {!report && !error && <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto mb-3 text-emerald-600" /><p className="font-bold">Finding package and checking hashes…</p><p className="text-xs text-slate-500 mt-2">Large games can take several minutes. No repair download starts until you confirm.</p></div>}
        {error && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</p>}
        {report && report.identity_confirmed === false && <div role="alert" className="p-4 rounded-xl bg-red-50 text-red-800"><h3 className="font-bold">{report.title_match === false ? 'This magnet is for a different game' : 'Wrong game folder or unverified game'}</h3>{report.torrent_name && <p className="text-sm mt-2">Selected game: <strong>{title}</strong><br />Magnet game: <strong>{report.torrent_name}</strong></p>}<p className="text-sm mt-2">{report.identity_error}</p><p className="text-xs mt-2">No repair download will start. Shared names such as setup.exe and fg-01.bin are not enough to identify a game.</p></div>}
        {report && report.identity_confirmed !== false && <>
          <div className={`p-4 rounded-xl ${report.all_ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}><ShieldCheck className="mb-2" /><h3 className="font-bold">{report.all_ok ? 'All files OK — no download needed' : `${damaged.length} missing or damaged files`}</h3><p className="text-xs mt-1">{report.files.length} files checked • Package {formatSize(report.total_size)}{!report.all_ok && ` • Missing pieces ${formatSize(report.missing_bytes)}`}</p></div>
          <button className="text-sm text-emerald-700 underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show files needing repair' : 'Show every checked file'}</button>
          <div className="space-y-1 text-xs">{files.map((file: any) => <div key={file.name} className="flex gap-3 justify-between border-b py-2"><span className="break-all">{file.name}</span><span className="shrink-0 text-slate-500">{formatSize(file.size)} · {file.status.replace('_', ' ')}</span></div>)}</div>
          {!report.all_ok && <p className="text-xs text-slate-500">Repair downloads only invalid torrent pieces, which may overlap adjacent files. The complete package is checked again afterwards.</p>}
        </>}
      </div>
      <footer className="p-5 border-t flex justify-end gap-3"><button disabled={starting} onClick={onClose} className="px-4 py-2 border rounded-xl">{report?.all_ok ? 'Done' : 'Cancel'}</button>{report && report.identity_confirmed === true && !report.all_ok && <button disabled={starting} onClick={confirm} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl disabled:opacity-50">{starting ? 'Starting repair…' : 'Repair and download'}</button>}</footer>
    </section>
  </div>;
}