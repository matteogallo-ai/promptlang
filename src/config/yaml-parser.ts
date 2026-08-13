/**
 * Minimal YAML parser (zero external dependencies).
 *
 * Supported subset:
 *   - Mappings (`key: value` with 2-space indentation, arbitrary nesting)
 *   - Sequences (`- item`)
 *   - Sequences of mappings (`- key: value` starts a mapping element)
 *   - Scalars: unquoted strings, double-quoted strings (with `\n`, `\t`,
 *     `\r`, `\"`, `\\` escapes), single-quoted strings (with `''` escape),
 *     integers, floats, booleans (`true`/`false`), null (`~` or `null`)
 *   - Comments (`#` from a whitespace boundary to end of line)
 *
 * NOT supported (all trigger `ConfigParseError`):
 *   - Anchors and aliases (`&`, `*`)
 *   - Block scalars (`|`, `>`)
 *   - Explicit type tags (`!!str`, `!!int`, ...)
 *   - Flow-style mappings/sequences (`{a: 1}`, `[1, 2]`)
 *   - Tab characters for indentation
 *
 * See docs/yaml-support.md for the exhaustive list.
 */

/** A parsed YAML value. Mappings are plain objects, sequences are arrays. */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

/** Thrown when the YAML source contains an unsupported or malformed construct. */
export class ConfigParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = "ConfigParseError";
    this.line = line;
  }
}

interface Line {
  indent: number;
  content: string;
  lineNum: number;
}

/**
 * Parses a YAML source string into a `YamlValue`.
 * Returns `null` for empty input.
 *
 * @throws {ConfigParseError} on any unsupported or malformed construct.
 */
export function parseYaml(source: string): YamlValue {
  const lines = tokenizeLines(source);
  if (lines.length === 0) return null;
  const parser = new YamlParser(lines);
  const value = parser.parse();
  return value;
}

// ---------------------------------------------------------------------------
// Line tokenization
// ---------------------------------------------------------------------------

function tokenizeLines(source: string): Line[] {
  const raw = source.split(/\r?\n/);
  const lines: Line[] = [];
  for (let i = 0; i < raw.length; i++) {
    const rowStr = raw[i]!;
    let indent = 0;
    while (indent < rowStr.length && rowStr[indent] === " ") indent++;
    if (indent < rowStr.length && rowStr[indent] === "\t") {
      throw new ConfigParseError(
        "Tab characters are not supported for indentation; use spaces",
        i + 1
      );
    }
    const rest = stripInlineComment(rowStr.slice(indent));
    const content = rest.replace(/\s+$/, "");
    if (content === "") continue;
    if (indent % 2 !== 0) {
      throw new ConfigParseError(
        `Indentation must be a multiple of 2 spaces (got ${indent})`,
        i + 1
      );
    }
    lines.push({ indent, content, lineNum: i + 1 });
  }
  return lines;
}

/**
 * Removes a trailing `# comment` from a line, respecting quoted strings.
 * A `#` starts a comment only when it appears at the beginning of the string
 * or is preceded by whitespace.
 */
function stripInlineComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if ((inSingle || inDouble) && ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inSingle && !inDouble) {
      if (i === 0 || s[i - 1] === " " || s[i - 1] === "\t") {
        return s.slice(0, i);
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

class YamlParser {
  private idx = 0;

  constructor(private readonly lines: Line[]) {}

  parse(): YamlValue {
    if (this.lines.length === 0) return null;
    const first = this.lines[0]!;
    if (first.indent !== 0) {
      throw new ConfigParseError(
        `Root node must start at column 1 (got indent ${first.indent})`,
        first.lineNum
      );
    }
    const value = this.parseBlock(0);
    if (this.idx < this.lines.length) {
      const stray = this.lines[this.idx]!;
      throw new ConfigParseError(
        "Unexpected content after root node — check indentation",
        stray.lineNum
      );
    }
    return value;
  }

  private parseBlock(indent: number): YamlValue {
    if (this.idx >= this.lines.length) return null;
    const first = this.lines[this.idx]!;
    if (first.indent !== indent) {
      throw new ConfigParseError(
        `Expected content at indent ${indent}, got ${first.indent}`,
        first.lineNum
      );
    }
    if (isSequenceLine(first.content)) {
      return this.parseSequence(indent);
    }
    return this.parseMapping(indent);
  }

  private parseMapping(indent: number): { [key: string]: YamlValue } {
    const obj: { [key: string]: YamlValue } = {};
    while (this.idx < this.lines.length) {
      const line = this.lines[this.idx]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new ConfigParseError(
          `Unexpected indentation ${line.indent} (expected ${indent})`,
          line.lineNum
        );
      }
      if (isSequenceLine(line.content)) {
        throw new ConfigParseError(
          "Expected a 'key: value' mapping but found a sequence item",
          line.lineNum
        );
      }
      const colonIdx = findKeyColon(line.content);
      if (colonIdx === -1) {
        throw new ConfigParseError(
          `Malformed mapping line — expected 'key: value' but found '${line.content}'`,
          line.lineNum
        );
      }
      const key = line.content.slice(0, colonIdx).trim();
      if (key === "") {
        throw new ConfigParseError("Mapping key cannot be empty", line.lineNum);
      }
      rejectUnsupported(key, line.lineNum);
      const rest = line.content.slice(colonIdx + 1).trim();
      this.idx++;
      if (rest === "") {
        if (this.idx < this.lines.length && this.lines[this.idx]!.indent > indent) {
          obj[key] = this.parseBlock(this.lines[this.idx]!.indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest, line.lineNum);
      }
    }
    return obj;
  }

  private parseSequence(indent: number): YamlValue[] {
    const arr: YamlValue[] = [];
    while (this.idx < this.lines.length) {
      const line = this.lines[this.idx]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new ConfigParseError(
          `Unexpected indentation ${line.indent} (expected ${indent})`,
          line.lineNum
        );
      }
      if (!isSequenceLine(line.content)) break;
      const rest = line.content === "-" ? "" : line.content.slice(2).trim();
      this.idx++;
      if (rest === "") {
        if (this.idx < this.lines.length && this.lines[this.idx]!.indent > indent) {
          arr.push(this.parseBlock(this.lines[this.idx]!.indent));
        } else {
          arr.push(null);
        }
        continue;
      }
      // "- key: value" starts a mapping whose keys align at indent + 2
      const colonIdx = findKeyColon(rest);
      if (colonIdx !== -1) {
        arr.push(this.parseInlineMappingItem(rest, colonIdx, indent, line.lineNum));
      } else {
        rejectUnsupported(rest, line.lineNum);
        arr.push(parseScalar(rest, line.lineNum));
      }
    }
    return arr;
  }

  /**
   * Parses `- key: value` where subsequent keys of the same mapping element
   * are at `indent + 2` (aligned under the character after `- `).
   */
  private parseInlineMappingItem(
    firstLineRest: string,
    firstColonIdx: number,
    outerIndent: number,
    firstLineNum: number
  ): { [key: string]: YamlValue } {
    const innerIndent = outerIndent + 2;
    const mapping: { [key: string]: YamlValue } = {};
    const key = firstLineRest.slice(0, firstColonIdx).trim();
    rejectUnsupported(key, firstLineNum);
    const val = firstLineRest.slice(firstColonIdx + 1).trim();
    if (val === "") {
      if (this.idx < this.lines.length && this.lines[this.idx]!.indent > innerIndent) {
        mapping[key] = this.parseBlock(this.lines[this.idx]!.indent);
      } else {
        mapping[key] = null;
      }
    } else {
      mapping[key] = parseScalar(val, firstLineNum);
    }
    // Consume additional keys of the same mapping element at innerIndent.
    while (this.idx < this.lines.length) {
      const nl = this.lines[this.idx]!;
      if (nl.indent !== innerIndent) break;
      if (isSequenceLine(nl.content)) break;
      const c = findKeyColon(nl.content);
      if (c === -1) {
        throw new ConfigParseError(
          `Malformed mapping line — expected 'key: value' but found '${nl.content}'`,
          nl.lineNum
        );
      }
      const k = nl.content.slice(0, c).trim();
      rejectUnsupported(k, nl.lineNum);
      const v = nl.content.slice(c + 1).trim();
      this.idx++;
      if (v === "") {
        if (this.idx < this.lines.length && this.lines[this.idx]!.indent > innerIndent) {
          mapping[k] = this.parseBlock(this.lines[this.idx]!.indent);
        } else {
          mapping[k] = null;
        }
      } else {
        mapping[k] = parseScalar(v, nl.lineNum);
      }
    }
    return mapping;
  }
}

// ---------------------------------------------------------------------------
// Scalar parsing
// ---------------------------------------------------------------------------

function isSequenceLine(content: string): boolean {
  return content === "-" || content.startsWith("- ");
}

/**
 * Finds the first `:` in `s` that is unquoted and either at end-of-string or
 * followed by whitespace — this is the key/value delimiter. Returns -1 when
 * no such colon exists.
 */
function findKeyColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if ((inSingle || inDouble) && ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === ":" && !inSingle && !inDouble) {
      if (i === s.length - 1) return i;
      const next = s[i + 1]!;
      if (next === " " || next === "\t") return i;
    }
  }
  return -1;
}

function parseScalar(input: string, lineNum: number): YamlValue {
  const s = input.trim();
  if (s === "") return null;
  rejectUnsupported(s, lineNum);

  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) {
      throw new ConfigParseError("Unterminated double-quoted string", lineNum);
    }
    return parseDoubleQuoted(s.slice(1, -1), lineNum);
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) {
      throw new ConfigParseError("Unterminated single-quoted string", lineNum);
    }
    return s.slice(1, -1).replace(/''/g, "'");
  }

  if (s === "~" || s === "null" || s === "Null" || s === "NULL") return null;

  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;

  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (/^-?\d+(\.\d+)?[eE][-+]?\d+$/.test(s)) return parseFloat(s);

  return s;
}

function parseDoubleQuoted(body: string, lineNum: number): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    const next = body[i];
    if (next === undefined) {
      throw new ConfigParseError("Unterminated escape sequence", lineNum);
    }
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "/":
        out += "/";
        break;
      case "0":
        out += "\0";
        break;
      default:
        throw new ConfigParseError(`Unknown escape sequence '\\${next}'`, lineNum);
    }
  }
  return out;
}

/**
 * Rejects YAML constructs that the minimal parser does not support:
 * anchors (`&x`), aliases (`*x`), block scalars (`|`, `>`), explicit type
 * tags (`!!str`, `!foo`), and flow-style collections (`{...}`, `[...]`).
 */
function rejectUnsupported(s: string, lineNum: number): void {
  if (s.startsWith("&") || s.startsWith("*")) {
    throw new ConfigParseError(
      "YAML anchors and aliases (& / *) are not supported",
      lineNum
    );
  }
  if (s.startsWith("!!") || s.startsWith("!")) {
    throw new ConfigParseError(
      "YAML explicit type tags (! and !!) are not supported",
      lineNum
    );
  }
  if (s === "|" || s === ">" || s.startsWith("|") || s.startsWith(">")) {
    throw new ConfigParseError(
      "YAML block scalars (| and >) are not supported",
      lineNum
    );
  }
  if (s.startsWith("{") || s.startsWith("[")) {
    throw new ConfigParseError(
      "YAML flow-style collections ({...} and [...]) are not supported",
      lineNum
    );
  }
}
