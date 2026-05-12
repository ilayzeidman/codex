import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  className?: string;
  title?: string;
}

/**
 * Click-to-copy span. Selectable text — clicking copies the full value to the
 * clipboard and flashes "copied" briefly.
 */
export function Copyable({ value, className, title }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers / non-secure contexts — best effort fallback.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${value} (click to copy)`}
      className={
        'group inline-flex items-center gap-1 select-text text-left ' +
        'rounded px-1 -mx-1 hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-text ' +
        (className ?? '')
      }
    >
      <span className="break-all">{value}</span>
      <span
        className={
          'text-[10px] uppercase tracking-wide transition-opacity ' +
          (copied ? 'text-accent-recv opacity-100' : 'text-ink-500 opacity-0 group-hover:opacity-70')
        }
      >
        {copied ? 'copied' : 'copy'}
      </span>
    </button>
  );
}
