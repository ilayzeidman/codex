/** `function_call_output.output` and `custom_tool_call_output.output` on the
 *  wire can be either a plain string OR a list of structured content items.
 *  Stringify uniformly so the preview always shows something useful. */
export function stringifyToolOutput(out: any): string {
  if (typeof out === 'string') return out;
  if (out === undefined || out === null) return '';
  return JSON.stringify(out, null, 2);
}
