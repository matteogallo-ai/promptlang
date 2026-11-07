/**
 * Rewrites a value inserted between delimiters so that it cannot close or reopen
 * them. Generated code calls it with the pairs the compiler found around each
 * placeholder (src/compiler/delimiters.ts). promptlang_runtime.py implements the
 * same rewrite; tests require both to produce the same bytes.
 *
 * - `tag:<name>`: a `<` that starts `<name` or `</name`, in any ASCII case and with
 *   ASCII whitespace around the `/`, becomes `&lt;`. A longer name (`<tickets>`) is
 *   left alone.
 * - `brackets`: `[[` becomes `[ [` and `]]` becomes `] ]`.
 * - `fence`: a run of three or more backticks gets a space between each.
 * - `dashes`: a line of three or more dashes, spaced or not, gets a backslash
 *   before its first dash. Spacing them would not do: `- - -` is still a
 *   Markdown rule.
 *
 * A value is rewritten on its own but lands next to another value or next to the
 * template's text, so its edges are rewritten too: a trailing `<` that could still
 * become `<name` or `</name` becomes `&lt;`; a `[` or `]` at either end is padded
 * with a space on the outer side; a run of backticks at either end is spaced and
 * padded the same way; a first or last line made only of dashes gets the backslash.
 *
 * The patterns are ASCII on purpose: `\s` and Unicode case folding differ between
 * JavaScript and Python, and the two languages must send the same text.
 */
// The grammar the compiler reads tag names with (src/compiler/delimiters.ts). A name
// outside it never comes from generated code, and refusing it keeps every name that
// reaches the RegExp below a name the Python runtime also accepts.
const TAG_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const WS = "[ \\t\\n\\v\\f\\r]";
// The line terminators of JavaScript's multiline mode, which the compiler uses to
// find a dash line around a placeholder.
const EOL = /(\r\n|[\n\r\u2028\u2029])/;
// Spaced dashes too: Markdown reads `- - -` as the same rule as `---`.
const DASH_LINE = /^[ \t]*(?:-[ \t]*){3,}$/;
const DASH_EDGE = /^[ \t]*(?:-[ \t]*)+$/;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spaced = (run: string) => run.split("").join(" ");

/** `(?:t(?:i(?:c)?)?)?` for `tic`: any prefix of the name, the empty one included. */
function prefixes(name: string): string {
  let p = "";
  for (const ch of [...name].reverse()) p = `(?:${escapeRegExp(ch)}${p})?`;
  return p;
}

function tag(value: string, raw: string): string {
  if (!TAG_NAME.test(raw)) {
    throw new Error(`neutralizeDelimiters: invalid tag name ${JSON.stringify(raw)}`);
  }
  // Without the `m` flag, `$` is the end of the value, as `\Z` is in Python.
  // `WS*(?:/WS*)?` rather than `WS*/?WS*`: the second form can split one run of
  // whitespace two ways, and backtracking over a long run takes quadratic time.
  const opener = `<(?=${WS}*(?:/${WS}*)?(?:${escapeRegExp(raw)}(?![A-Za-z0-9_.:-])|${prefixes(raw)}$))`;
  return value.replace(new RegExp(opener, "gi"), "&lt;");
}

function dashes(value: string): string {
  const parts = value.split(EOL);
  const last = parts.length - 1;
  for (let i = 0; i <= last; i += 2) {
    const line = parts[i]!;
    const edge = i === 0 || i === last;
    if (DASH_LINE.test(line) || (edge && DASH_EDGE.test(line))) parts[i] = line.replace("-", "\\-");
  }
  return parts.join("");
}

export function neutralizeDelimiters(value: string, delimiters: readonly string[]): string {
  let out = value;
  for (const d of delimiters) {
    if (d.startsWith("tag:")) {
      out = tag(out, d.slice(4));
    } else if (d === "brackets") {
      out = out
        .replace(/\[(?=\[)/g, "[ ")
        .replace(/\](?=\])/g, "] ")
        .replace(/^[[\]]/, " $&")
        .replace(/[[\]]$/, "$& ");
    } else if (d === "fence") {
      out = out.replace(/`{3,}/g, spaced).replace(/^`+/, (run) => ` ${spaced(run)}`);
      // A scan, not /`+$/: that pattern retries from every backtick of a long run.
      let end = out.length;
      while (end > 0 && out[end - 1] === "`") end--;
      if (end < out.length) out = `${out.slice(0, end)}${spaced(out.slice(end))} `;
    } else if (d === "dashes") {
      out = dashes(out);
    } else {
      throw new Error(`neutralizeDelimiters: unknown delimiter ${JSON.stringify(d)}`);
    }
  }
  return out;
}
