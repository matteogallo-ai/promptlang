/**
 * Rewrites a value inserted between delimiters so that it cannot close or reopen
 * them. Generated code calls it with the pairs the compiler found around each
 * placeholder (src/compiler/delimiters.ts). promptlang_runtime.py implements the
 * same rewrite; tests require both to produce the same bytes.
 *
 * - `tag:<name>`: a `<` that starts `<name` or `</name`, in any ASCII case and with
 *   spaces, tabs or line breaks around the `/`, becomes `&lt;`. A longer name
 *   (`<tickets>`) is left alone.
 * - `brackets`: `[[` becomes `[ [` and `]]` becomes `] ]`.
 * - `fence`: a run of three or more backticks gets a space between each.
 * - `dashes`: a line of three or more dashes gets a space between each dash.
 *
 * The patterns are ASCII on purpose: `\s` and Unicode case folding differ between
 * JavaScript and Python, and the two languages must send the same text.
 */
export function neutralizeDelimiters(value: string, delimiters: readonly string[]): string {
  let out = value;
  for (const d of delimiters) {
    if (d.startsWith("tag:")) {
      const name = d.slice(4).replace(/[.]/g, "\\.");
      out = out.replace(
        new RegExp(`<(?=[ \\t\\r\\n]*/?[ \\t\\r\\n]*${name}(?![A-Za-z0-9_.:-]))`, "gi"),
        "&lt;"
      );
    } else if (d === "brackets") {
      out = out.replace(/\[(?=\[)/g, "[ ").replace(/\](?=\])/g, "] ");
    } else if (d === "fence") {
      out = out.replace(/`{3,}/g, (run) => run.split("").join(" "));
    } else if (d === "dashes") {
      out = out
        .split("\n")
        .map((line) =>
          /^[ \t]*-{3,}[ \t\r]*$/.test(line)
            ? line.replace(/-+/, (run) => run.split("").join(" "))
            : line
        )
        .join("\n");
    } else {
      throw new Error(`neutralizeDelimiters: unknown delimiter ${JSON.stringify(d)}`);
    }
  }
  return out;
}
