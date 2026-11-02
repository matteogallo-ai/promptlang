/**
 * Returns the value given after `--config`, or undefined when the flag is
 * absent or has no (non-empty) value, so callers fall back to the default
 * promptlang.yaml lookup.
 */
export function parseConfigFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--config");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  return value ? value : undefined;
}
