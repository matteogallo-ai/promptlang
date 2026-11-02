import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parseYaml, YamlParseError, type YamlValue } from "@promptlang/yaml-parser";

/**
 * The package has no stringifier, so the round-trip emits generated values
 * in the documented subset (README "What is supported") and parses them back.
 * The fixed seed keeps CI reproducible; fast-check prints the seed and the
 * shrunk counterexample on failure. This package stays standalone, so it does
 * not share the root's tests/support helper.
 */
const params = (numRuns: number) => ({ seed: 20261102, numRuns });

// ---------------------------------------------------------------------------
// Scalars and how each one may be written
// ---------------------------------------------------------------------------

const RESERVED_PLAIN = new Set(["true", "false", "null"]);

/** Unquoted strings the subset reads back as themselves. */
const plainString = fc
  .stringMatching(/^[a-z][a-z0-9._/^-]{0,8}( [a-z0-9._/^-]{1,5}){0,2}$/)
  .filter((s) => !RESERVED_PLAIN.has(s));

/** Text for quoted strings, including quotes, backslashes, `#`, `: ` and non-ASCII. */
const quotedText = fc.string({
  unit: fc.constantFrom(..."ab Z9#:'\"\\\t\n\r-&*!|>{[é"),
  maxLength: 12,
});

const DOUBLE_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

type Scalar = { value: YamlValue; text: string };

const scalar: fc.Arbitrary<Scalar> = fc.oneof(
  plainString.map((s) => ({ value: s, text: s })),
  quotedText.map((s) => ({
    value: s,
    text: `"${s.replace(/[\\"\n\t\r]/g, (c) => DOUBLE_ESCAPES[c]!)}"`,
  })),
  // Single-quoted strings only escape `'`; they cannot hold a line break.
  quotedText
    .map((s) => s.replace(/[\n\r\\]/g, ""))
    .map((s) => ({ value: s, text: `'${s.replace(/'/g, "''")}'` })),
  fc.integer().map((n) => ({ value: n, text: String(n) })),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Object.is(n, -0))
    .map((n) => ({ value: n, text: String(n) })),
  fc.boolean().map((b) => ({ value: b, text: String(b) })),
  fc.constantFrom("~", "null").map((text) => ({ value: null, text }))
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type Node =
  | { kind: "scalar"; scalar: Scalar }
  | { kind: "null" }
  | { kind: "map"; entries: Array<[string, Node]> }
  | { kind: "seq"; items: Node[] };

/** Ordinary keys plus the names an object literal treats specially. */
const key = fc.oneof(
  fc.stringMatching(/^[a-z_][a-z0-9_-]{0,6}$/),
  fc.constantFrom("constructor", "toString", "hasOwnProperty")
);

const { node } = fc.letrec<{ node: Node }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    scalar.map((s) => ({ kind: "scalar" as const, scalar: s })),
    fc.constant({ kind: "null" as const }),
    fc
      .uniqueArray(fc.tuple(key, tie("node")), {
        minLength: 1,
        maxLength: 4,
        selector: ([k]) => k,
      })
      .map((entries) => ({ kind: "map" as const, entries })),
    fc
      .array(tie("node"), { minLength: 1, maxLength: 4 })
      .map((items) => ({ kind: "seq" as const, items }))
  ),
}));

const root = node.filter((n) => n.kind === "map" || n.kind === "seq");

function expectedValue(n: Node): YamlValue {
  switch (n.kind) {
    case "scalar":
      return n.scalar.value;
    case "null":
      return null;
    case "seq":
      return n.items.map(expectedValue);
    case "map": {
      const obj: { [k: string]: YamlValue } = {};
      for (const [k, v] of n.entries) {
        Object.defineProperty(obj, k, {
          value: expectedValue(v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return obj;
    }
  }
}

/** Optional trailing comment: the subset strips `#` after whitespace. */
type Trail = () => string;

function pad(indent: number): string {
  return " ".repeat(indent);
}

/** Lines for `n` as the value after `head` (`key:` or `-`) written at `indent`. */
function emitAfter(
  head: string,
  n: Node,
  indent: number,
  childIndent: number,
  trail: Trail
): string[] {
  if (n.kind === "scalar") return [`${pad(indent)}${head} ${n.scalar.text}${trail()}`];
  if (n.kind === "null") return [`${pad(indent)}${head}${trail()}`];
  return [`${pad(indent)}${head}${trail()}`, ...emitBlock(n, childIndent, trail)];
}

function emitBlock(n: Node, indent: number, trail: Trail): string[] {
  if (n.kind === "map") {
    return n.entries.flatMap(([k, v]) => emitAfter(`${k}:`, v, indent, indent + 2, trail));
  }
  if (n.kind !== "seq") throw new Error("a block is a mapping or a sequence");
  return n.items.flatMap((item) => {
    if (item.kind !== "map") return emitAfter("-", item, indent, indent + 2, trail);
    // `- key: value`: the element's keys align two columns right of the dash, and a
    // nested block under any of them sits deeper still.
    const inner = indent + 2;
    return item.entries.flatMap(([k, v], i) => {
      const lines = emitAfter(`${k}:`, v, inner, inner + 2, trail);
      lines[0] = i === 0 ? `${pad(indent)}- ${lines[0]!.slice(inner)}` : lines[0]!;
      return lines;
    });
  });
}

const document = fc
  .tuple(root, fc.array(fc.boolean(), { minLength: 1, maxLength: 7 }))
  .map(([n, flags]) => {
    let i = 0;
    // Comments and blank lines are placed deterministically from the generated flags.
    const trail: Trail = () => (flags[i++ % flags.length] ? "  # note: 'x' \"y\"" : "");
    const lines = emitBlock(n, 0, trail).flatMap((line, j) =>
      flags[j % flags.length] && j % 3 === 0 ? ["", "# full-line comment", line] : [line]
    );
    return { node: n, source: lines.join("\n") };
  });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const yamlSoup = fc.string({
  unit: fc.constantFrom(..."ab:- #'\"\\\n\t&*!|>{[]}~0.e"),
  maxLength: 40,
});

describe("yaml-parser properties", () => {
  test("fuzz: arbitrary input returns a value or throws a YamlParseError with a line in range", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: "binary", maxLength: 60 }), yamlSoup), (source) => {
        try {
          parseYaml(source);
        } catch (error) {
          if (!(error instanceof YamlParseError)) throw error;
          expect(error.line).toBeGreaterThanOrEqual(1);
          expect(error.line).toBeLessThanOrEqual(source.split("\n").length);
        }
      }),
      params(2000)
    );
  });

  test("round-trip: a generated document in the supported subset parses to its value", () => {
    fc.assert(
      fc.property(document, ({ node: n, source }) => {
        expect(parseYaml(source)).toEqual(expectedValue(n));
      }),
      params(500)
    );
  });
});
