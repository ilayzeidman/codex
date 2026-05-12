interface Props {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: 'default' | 'sent' | 'recv' | 'tool' | 'text';
}

export function Stat({ label, value, hint, accent = 'default' }: Props) {
  const accentClass = {
    default: 'text-ink-100',
    sent: 'text-accent-sent',
    recv: 'text-accent-recv',
    tool: 'text-accent-tool',
    text: 'text-accent-text',
  }[accent];
  return (
    <div className="bg-ink-800 border border-ink-700 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accentClass}`}>{value}</div>
      {hint && <div className="text-xs text-ink-500 mt-1">{hint}</div>}
    </div>
  );
}
