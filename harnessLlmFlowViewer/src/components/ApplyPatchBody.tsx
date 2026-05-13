import { useMemo } from 'react';

/** Renders an apply_patch freeform body with diff-style coloring for `+`/`-`
 *  lines and header callouts for `*** Begin Patch` / `*** Update File:` /
 *  `*** Add File:` markers. */
export function ApplyPatchBody({ patch }: { patch: string }) {
  const stats = useMemo(() => summarizePatch(patch), [patch]);
  const lines = patch.split('\n');
  return (
    <div className="text-xs">
      <div className="flex flex-wrap gap-2 mb-2 text-[10px] uppercase tracking-wide text-ink-500">
        <span>
          <span className="text-ink-400">files</span>{' '}
          <span className="text-ink-200">{stats.files}</span>
        </span>
        <span>
          <span className="text-accent-recv">+{stats.additions}</span>
        </span>
        <span>
          <span className="text-accent-err">−{stats.deletions}</span>
        </span>
        <span>
          <span className="text-ink-400">total</span>{' '}
          <span className="text-ink-200">{lines.length} lines</span>
        </span>
      </div>
      <pre className="font-mono whitespace-pre-wrap break-words bg-ink-950 border border-ink-800 rounded p-2 max-h-[40rem] overflow-auto leading-snug">
        {lines.map((line, i) => (
          <span key={i} className={classifyLine(line)}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}

function classifyLine(line: string): string {
  if (line.startsWith('*** ')) return 'text-accent-tool font-semibold';
  if (line.startsWith('@@')) return 'text-ink-400';
  if (line.startsWith('+')) return 'text-accent-recv bg-accent-recv/5';
  if (line.startsWith('-')) return 'text-accent-err bg-accent-err/5';
  return 'text-ink-300';
}

function summarizePatch(patch: string): { files: number; additions: number; deletions: number } {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('*** Update File:') || line.startsWith('*** Add File:') || line.startsWith('*** Delete File:')) {
      files++;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }
  return { files, additions, deletions };
}
