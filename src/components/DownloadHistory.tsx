import React, { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../services/api';
import { addTorrent, formatSize } from '../services/downloadApi';
import { toast } from 'sonner';
export function DownloadHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const load = () => apiFetch('/api/download-history').then(r => r.ok ? r.json() : []).then(data => {
      const keys = new Set<string>(data.map((item: any) => item.id + ':' + item.completedAt));
      if (seen.current) for (const item of data) {
        if (item.taskKind === 'repair' && !seen.current.has(item.id + ':' + item.completedAt)) toast.success('Repair successful', { description: item.name + ' — files verified.' });
      }
      seen.current = keys; setItems(data);
    }).catch(() => {});
    void load(); const timer = setInterval(load, 4000); return () => clearInterval(timer);
  }, []);
  return <details className="mx-6 my-3 bg-slate-100 border rounded-xl p-3" open={items.length > 0}><summary className="font-bold text-sm text-slate-600 cursor-pointer">Download history ({items.length})</summary><div className="max-h-56 overflow-y-auto space-y-2 mt-2">{items.map((item, i) => <div key={`${item.completedAt}-${i}`} className="flex items-center justify-between gap-3 p-3 bg-white/50 rounded-lg text-slate-500"><div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs font-semibold">{item.taskKind === 'repair' ? 'Repair successful — files verified' : 'Download completed'}</p><p className="text-xs">{formatSize(item.size)} · {new Date(item.completedAt).toLocaleString()}</p></div><button disabled={!!busy} className="text-xs border rounded-lg px-3 py-2" onClick={async () => { setBusy(item.id); try { await addTorrent(item.magnet, item.name); toast.success('Download started'); } catch (e: any) { toast.error(e.message); } finally { setBusy(undefined); } }}>{busy === item.id ? 'Starting…' : 'Download again'}</button></div>)}{!items.length && <p className="text-xs text-slate-500">Completed downloads will appear here.</p>}</div></details>;
}