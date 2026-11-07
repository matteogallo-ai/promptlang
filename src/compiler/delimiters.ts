/**
 * The delimiter pairs that enclose a template placeholder. The prompt-injection-risk
 * rule warns when there is none; the compilers pass the ones found to
 * neutralizeDelimiters, so the inserted value cannot close or reopen them.
 *
 * Encoded as strings ("tag:ticket", "brackets", "fence", "dashes") so that generated
 * Python can hold them in single quotes inside an f-string, which Python 3.11 needs.
 */
export type Delimiter = `tag:${string}` | "brackets" | "fence" | "dashes";

/** Whether an unmatched opener sits before `at` and its closer after it. */
function between(content: string, at: number, open: string, close: string): boolean {
  return (
    content.lastIndexOf(open, at) > content.lastIndexOf(close, at) &&
    content.indexOf(close, at) !== -1
  );
}

/** Whether an odd number of `fence` lines precede `at`, so one is open there, and one follows. */
function insideFence(content: string, at: number, fence: RegExp): boolean {
  const before = [...content.slice(0, at).matchAll(fence)].length;
  return before % 2 === 1 && content.slice(at).match(fence) !== null;
}

/** The names of the `<name ...>` tags opened before `at`, still open there, and closed after it. */
function enclosingTags(content: string, at: number): string[] {
  const open: string[] = [];
  for (const m of content.slice(0, at).matchAll(/<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^<>]*)?>/g)) {
    const [, slash, name] = m;
    if (!slash) open.push(name!);
    else if (open.includes(name!)) open.splice(open.lastIndexOf(name!));
  }
  const after = content.slice(at);
  // Closing tags are read with a fixed pattern: no name is built into a regex.
  const closed = new Set([...after.matchAll(/<\/([A-Za-z_][\w.:-]*)\s*>/g)].map((m) => m[1]!));
  return [...new Set(open.filter((name) => closed.has(name)))];
}

/**
 * Each delimiter pair around the placeholder at `at`. Each pair is matched around
 * the placeholder itself: a delimiter elsewhere in the text separates nothing from
 * the input.
 */
export function enclosingDelimiters(content: string, at: number): Delimiter[] {
  const found: Delimiter[] = enclosingTags(content, at).map((name) => `tag:${name}` as const);
  if (between(content, at, "<BEGIN>", "<END>")) found.push("tag:BEGIN", "tag:END");
  if (between(content, at, "[[", "]]")) found.push("brackets");
  if (insideFence(content, at, /```/g)) found.push("fence");
  if (insideFence(content, at, /^[ \t]*---[ \t]*$/gm)) found.push("dashes");
  return [...new Set(found)];
}
