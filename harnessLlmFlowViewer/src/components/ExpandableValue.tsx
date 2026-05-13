/** Shows `text` inline when short; otherwise renders a <details> with a
 *  truncated summary and the full content in a scrollable <pre>. Set
 *  `prettyJson` to attempt JSON-pretty-printing the expanded body. */
export function ExpandableValue({
  text,
  previewChars,
  prettyJson,
}: {
  text: string;
  previewChars: number;
  prettyJson?: boolean;
}) {
  if (text.length <= previewChars) {
    return <span className="text-ink-200 whitespace-pre-wrap break-words">{text}</span>;
  }
  const fullBody = prettyJson ? prettyPrintJsonOrPassthrough(text) : text;
  const moreChars = text.length - previewChars;
  return (
    <details className="block w-full">
      <summary className="cursor-pointer list-none text-ink-200 hover:text-ink-100">
        <span className="whitespace-pre-wrap break-words">{text.slice(0, previewChars)}</span>
        <span className="ml-2 text-accent-text text-[10px] uppercase tracking-wide">
          [+{moreChars.toLocaleString()} more · click to expand]
        </span>
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-200 bg-ink-950 border border-ink-800 rounded p-2 max-h-[32rem] overflow-auto">
        {fullBody}
      </pre>
    </details>
  );
}

function prettyPrintJsonOrPassthrough(s: string): string {
  try {
    const parsed = JSON.parse(s);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return s;
  }
}
