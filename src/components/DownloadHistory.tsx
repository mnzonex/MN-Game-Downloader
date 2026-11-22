import React, { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../services/api';
import { addTorrent, formatSize } from '../services/downloadApi';
import { toast } from 'sonner';

export function DownloadHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const load = () => apiFetch('/api/download-history')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const keys = new Set<string>(data.map((item: any) => item.id + ':' + item.completedAt));
        if (seen.current) for (const item of data) {
          if (item.taskKind === 'repair' && !seen.current.has(item.id + ':' + item.completedAt)) {
            toast.success('Repair successful', { description: item.name + ' — files verified.' });
          }
        }
        seen.current = keys;
        setItems(data);
      })
      .catch(() => {});
    void load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <details className="mn-download-history" open={items.length > 0}>
      <summary className="mn-download-history-summary">Download history ({items.length})</summary>
      <div className="mn-download-history-list">
        {items.map((item, i) => (
          <article key={`${item.completedAt}-${i}`} className="mn-download-history-item">
            <div className="mn-download-history-copy">
              <p className="mn-download-history-name">{item.name}</p>
              <p className="mn-download-history-status">
                {item.taskKind === 'repair' ? 'Repair successful — files verified' : 'Download completed'}
              </p>
              <p className="mn-download-history-meta">
                {formatSize(item.size)} · {new Date(item.completedAt).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              disabled={!!busy}
              className="mn-download-history-again"
              onClick={async () => {
                setBusy(item.id);
                try {
                  await addTorrent(item.magnet, item.name);
                  toast.success('Download started');
                } catch (error: any) {
                  toast.error(error.message);
                } finally {
                  setBusy(undefined);
                }
              }}
            >
              {busy === item.id ? 'Starting…' : 'Download again'}
            </button>
          </article>
        ))}
        {!items.length && (
          <p className="mn-download-history-empty">Completed downloads will appear here.</p>
        )}
      </div>
    </details>
  );
}