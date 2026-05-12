import { useCallback, useEffect, useState } from 'react';
import { parseDump } from '../parser';
import { Session } from '../types';

interface Props {
  onLoaded: (session: Session) => void;
}

interface RawFile {
  name: string;
  text: string;
  size: number;
}

export function FolderPicker({ onLoaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const ingest = useCallback(
    async (files: RawFile[]) => {
      setBusy(true);
      setError(null);
      try {
        const session = await parseDump(files);
        onLoaded(session);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setBusy(false);
      }
    },
    [onLoaded],
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__loadDumpFiles = (files: RawFile[]) => ingest(files);
    }
  }, [ingest]);

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files;
      if (!fl || fl.length === 0) return;
      const raw: RawFile[] = [];
      for (let i = 0; i < fl.length; i++) {
        const f = fl.item(i);
        if (!f) continue;
        // webkitRelativePath looks like "<thread-uuid>/manifest.json"
        const rel = (f as any).webkitRelativePath as string;
        const name = rel ? rel.split('/').slice(1).join('/') : f.name;
        if (!name) continue;
        const text = await f.text();
        raw.push({ name, text, size: f.size });
      }
      await ingest(raw);
    },
    [ingest],
  );

  const handleDrop = useCallback(
    async (ev: React.DragEvent<HTMLDivElement>) => {
      ev.preventDefault();
      setDragOver(false);
      const items = ev.dataTransfer?.items;
      const filesOut: RawFile[] = [];
      if (items) {
        const entries: any[] = [];
        for (let i = 0; i < items.length; i++) {
          const e = items[i].webkitGetAsEntry?.();
          if (e) entries.push(e);
        }
        for (const e of entries) {
          await walkEntry(e, '', filesOut);
        }
      }
      if (filesOut.length === 0) {
        // fall back to FileList
        const fl = ev.dataTransfer?.files;
        if (fl) {
          for (let i = 0; i < fl.length; i++) {
            const f = fl.item(i);
            if (!f) continue;
            const text = await f.text();
            filesOut.push({ name: f.name, text, size: f.size });
          }
        }
      }
      if (filesOut.length === 0) {
        setError('Drop did not yield any files. Try the folder picker button instead.');
        return;
      }
      // Trim a leading folder prefix if present (so "manifest.json" lives at the root).
      const root = commonRoot(filesOut.map(f => f.name));
      if (root) {
        for (const f of filesOut) {
          f.name = f.name.slice(root.length);
        }
      }
      await ingest(filesOut);
    },
    [ingest],
  );

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <h1 className="text-3xl font-semibold mb-2">
          Codex Harness <span className="text-accent-text">LLM Flow Viewer</span>
        </h1>
        <p className="text-ink-300 mb-8">
          Drop a session folder from <code className="text-ink-100">--debug-llm-dump &lt;DIR&gt;</code>.
          The folder is named after the thread UUID and contains <code>manifest.json</code> plus
          either <code>ws-events.ndjson</code> (WebSocket transport) or HTTP triplet files.
        </p>

        <div
          className={
            'border-2 border-dashed rounded-xl p-12 text-center transition-colors ' +
            (dragOver ? 'border-accent-text bg-ink-800' : 'border-ink-600 bg-ink-900')
          }
          onDragOver={ev => {
            ev.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="text-ink-300 mb-4">Drag & drop the session folder here</div>
          <div className="text-ink-500 text-sm mb-6">— or —</div>

          <label className="inline-block px-4 py-2 bg-accent-text text-ink-950 font-medium rounded-md cursor-pointer hover:opacity-90">
            Choose folder
            <input
              type="file"
              className="hidden"
              // @ts-expect-error non-standard attributes for directory picker
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleInputChange}
            />
          </label>

          <div className="mt-6 text-xs text-ink-500">
            Files are parsed locally in your browser. No upload.
          </div>
        </div>

        {busy && <div className="mt-6 text-accent-text">Parsing…</div>}
        {error && (
          <div className="mt-6 p-4 rounded-md bg-accent-err/20 border border-accent-err/40 text-accent-err">
            {error}
          </div>
        )}

        <div className="mt-10 text-ink-400 text-sm space-y-2">
          <div className="font-medium text-ink-200">Tip</div>
          <div>
            Generate a dump with:{' '}
            <code className="text-ink-100">$env:CODEX_DEBUG_LLM_DUMP = 'C:\tmp\dump'</code> then run
            any <code>codex</code> command. The viewer reads the resulting per-thread folder.
          </div>
        </div>
      </div>
    </div>
  );
}

function commonRoot(names: string[]): string {
  if (names.length === 0) return '';
  // If every name starts with the same path prefix up to a "/", strip it.
  const first = names[0];
  const idx = first.indexOf('/');
  if (idx < 0) return '';
  const prefix = first.slice(0, idx + 1);
  for (const n of names) {
    if (!n.startsWith(prefix)) return '';
  }
  return prefix;
}

async function walkEntry(entry: any, base: string, out: RawFile[]): Promise<void> {
  if (entry.isFile) {
    await new Promise<void>(resolve => {
      entry.file(async (file: File) => {
        const text = await file.text();
        out.push({ name: base + entry.name, text, size: file.size });
        resolve();
      });
    });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries: any[] = await new Promise(resolve => reader.readEntries(resolve));
    for (const e of entries) {
      await walkEntry(e, base + entry.name + '/', out);
    }
  }
}
