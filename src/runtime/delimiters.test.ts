import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { propertyParams } from "../../tests/support/property";
import { pythonTest } from "../../tests/support/python";
import { getPythonRuntimeSource } from "../compiler/python/python-runtime-template";
import { neutralizeDelimiters } from "./delimiters";

const n = neutralizeDelimiters;

describe("neutralizeDelimiters", () => {
  test("a closing or opening tag, in any case and spacing, loses its <", () => {
    expect(n("</ticket></TICKET>< /ticket ><ticket x>", ["tag:ticket"])).toBe(
      "&lt;/ticket>&lt;/TICKET>&lt; /ticket >&lt;ticket x>"
    );
    expect(n("<\n/\tticket>", ["tag:ticket"])).toBe("&lt;\n/\tticket>");
  });

  test("a longer name, another tag and a non-ASCII look-alike are left alone", () => {
    expect(n("<tickets></ticket-id><b>", ["tag:ticket"])).toBe("<tickets></ticket-id><b>");
    // U+212A KELVIN SIGN and U+017F LONG S fold to k and s in Python's Unicode mode only.
    expect(n("</ticKet></ſection>", ["tag:ticket", "tag:section"])).toBe("</ticKet></ſection>");
  });

  test("a tag name outside the compiler's grammar is refused, not read as a regex", () => {
    for (const name of ["a+b", "a\\", "a(b", "", "1a"]) {
      expect(() => n("aab", [`tag:${name}`])).toThrow(`invalid tag name ${JSON.stringify(name)}`);
    }
  });

  test("a dot in a tag name is literal", () => {
    expect(n("</a.b></axb>", ["tag:a.b"])).toBe("&lt;/a.b></axb>");
  });

  test("brackets, fences and dash lines are broken apart", () => {
    expect(n("x[[a]]]y", ["brackets"])).toBe("x[ [a] ] ]y");
    expect(n("x``ok`` ```x````y", ["fence"])).toBe("x``ok`` ` ` `x` ` ` `y");
    // A dash line is escaped rather than spaced: "- - -" is still a Markdown rule.
    expect(n("x\n---\n -- \n----\r\n  ---  \rx---", ["dashes"])).toBe(
      "x\n\\---\n -- \n\\----\r\n  \\---  \rx---"
    );
  });

  test("a dash line spaced the Markdown way is escaped too", () => {
    expect(n("x\n- - -\n -\t- - \ny", ["dashes"])).toBe("x\n\\- - -\n \\-\t- - \ny");
    expect(n("- -", ["dashes"]) + n("-\nEVIL", ["dashes"])).toBe("\\- -\\-\nEVIL");
  });

  test("every line terminator JavaScript's multiline mode knows ends a dash line", () => {
    for (const eol of ["\n", "\r", "\r\n", "\u2028", "\u2029"])
      expect(n(`x${eol}---${eol}y`, ["dashes"])).toBe(`x${eol}\\---${eol}y`);
  });

  test("tag whitespace includes the vertical tab and the form feed", () => {
    expect(n("<\v/\fticket>", ["tag:ticket"])).toBe("&lt;\v/\fticket>");
  });

  // A value is rewritten alone, but it lands next to another value or next to the
  // template's own text: what it starts or ends with must not complete a delimiter.
  test("the edges of a value cannot combine with what is next to it", () => {
    const t = ["tag:ticket"];
    expect(n("<", t) + n("/ticket>EVIL", t)).toBe("&lt;/ticket>EVIL");
    expect(`Name ${n("</", t)} ticket ${n(">EVIL", t)}`).toBe("Name &lt;/ ticket >EVIL");
    expect(n("x </tic", t)).toBe("x &lt;/tic");
    expect(n("x < \n", t)).toBe("x &lt; \n");
    expect(n("x <b", t)).toBe("x <b");
    expect(n("]", ["brackets"]) + n("]x", ["brackets"])).toBe(" ]  ]x");
    expect(n("x[", ["brackets"])).toBe("x[ ");
    expect(n("``", ["fence"]) + n("`x", ["fence"])).toBe(" ` `  `x");
    expect(n("-", ["dashes"]) + n("--\nEVIL", ["dashes"])).toBe("\\-\\--\nEVIL");
    expect(n("a\n-", ["dashes"])).toBe("a\n\\-");
  });

  // The value is the caller's: a pattern that backtracks on it is a denial of service.
  test("long runs of whitespace or backticks are rewritten in linear time", () => {
    const k = 50_000;
    const start = performance.now();
    expect(n(`<${" ".repeat(k)}x`, ["tag:ticket"])).toBe(`<${" ".repeat(k)}x`);
    expect(n(`<${" ".repeat(k)}/${" ".repeat(k)}x`, ["tag:ticket"])).toHaveLength(2 * k + 3);
    expect(n(`${"`".repeat(k)}x`, ["fence"])).toHaveLength(2 * k + 1);
    // Quadratic took 17 s here; the bound leaves room for a slow CI runner.
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("no delimiter, no change; an unknown one is a bug in the caller", () => {
    expect(() => n("x", ["é"])).toThrow('neutralizeDelimiters: unknown delimiter "é"');
    expect(n("</ticket>", [])).toBe("</ticket>");
    expect(() => n("x", ["quotes"])).toThrow("unknown delimiter");
  });
});

// Tokens rather than characters, so that random values do form tags, look-alikes and runs.
const TOKENS = [
  "<",
  "</",
  "< /",
  ">",
  " ",
  "\t",
  "\n",
  "\r\n",
  "ticket",
  "TICKET",
  "tic\u212Aet",
  "tickets",
  "BEGIN",
  "end",
  "\u017Fection",
  "[",
  "[[",
  "]]",
  "`",
  "```",
  "-",
  "---",
  "\r",
  "\u2028",
  "\f",
  "\\",
  "x",
];
const DELIMITERS = [
  "tag:ticket",
  "tag:BEGIN",
  "tag:END",
  "tag:section",
  "brackets",
  "fence",
  "dashes",
];

// What each delimiter must never contain once values are in place: the patterns the
// rewrite is meant to defeat, read as broadly as the rewrite claims.
const FORMS: Record<string, RegExp> = {
  "tag:ticket": /<[ \t\n\v\f\r]*\/?[ \t\n\v\f\r]*ticket(?![A-Za-z0-9_.:-])/i,
  "tag:BEGIN": /<[ \t\n\v\f\r]*\/?[ \t\n\v\f\r]*BEGIN(?![A-Za-z0-9_.:-])/i,
  brackets: /\[\[|\]\]/,
  fence: /```/,
  dashes: /(^|\r\n|[\n\r\u2028\u2029])[ \t]*(?:-[ \t]*){3,}(?=$|[\n\r\u2028\u2029])/,
};
// Template text between two values, without any delimiter character of its own.
const TEXT = TOKENS.filter((t) => !/[<[\]`-]/.test(t));

test("values and plain text, concatenated in any order, never form a delimiter", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...Object.keys(FORMS)),
      fc.array(fc.constantFrom(...TOKENS), { maxLength: 8 }).map((cs) => cs.join("")),
      fc.array(fc.constantFrom(...TEXT), { maxLength: 3 }).map((cs) => cs.join("")),
      fc.array(fc.constantFrom(...TOKENS), { maxLength: 8 }).map((cs) => cs.join("")),
      (d, a, text, b) => !FORMS[d]!.test(`\n${n(a, [d])}${text}${n(b, [d])}\n`)
    ),
    propertyParams(5000)
  );
});

pythonTest("TypeScript and Python rewrite any value to the same bytes", async () => {
  const cases = fc.sample(
    fc.tuple(
      fc.array(fc.constantFrom(...TOKENS), { maxLength: 30 }).map((cs) => cs.join("")),
      fc.subarray(DELIMITERS)
    ),
    propertyParams(2000)
  );
  const dir = await mkdtemp(join(tmpdir(), "promptlang-neutralize-"));
  try {
    await writeFile(join(dir, "promptlang_runtime.py"), getPythonRuntimeSource());
    await writeFile(join(dir, "cases.json"), JSON.stringify(cases));
    const script =
      "import json, sys\nfrom promptlang_runtime import neutralize_delimiters as n\n" +
      "cases = json.load(open('cases.json'))\n" +
      "sys.stdout.write(json.dumps([n(v, tuple(d)) for v, d in cases]))\n";
    const r = Bun.spawnSync(["python3", "-c", script], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    expect(JSON.parse(r.stdout.toString())).toEqual(cases.map(([v, d]) => n(v, d)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

pythonTest(
  "Python rewrites long runs of whitespace or backticks in linear time",
  () => {
    const script =
      "import time\nfrom promptlang_runtime import neutralize_delimiters as n\n" +
      "k = 50000\nt = time.perf_counter()\n" +
      "n('<' + ' ' * k + 'x', ('tag:ticket',))\n" +
      "n('<' + ' ' * k + '/' + ' ' * k + 'x', ('tag:ticket',))\n" +
      "n(chr(96) * k + 'x', ('fence',))\n" +
      "print(time.perf_counter() - t)\n";
    const dir = mkdtempSync(join(tmpdir(), "promptlang-neutralize-"));
    try {
      writeFileSync(join(dir, "promptlang_runtime.py"), getPythonRuntimeSource());
      const r = Bun.spawnSync(["python3", "-c", script], { cwd: dir, timeout: 20_000 });
      if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr.toString()}`);
      expect(Number(r.stdout.toString())).toBeLessThan(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000
);

pythonTest("Python refuses the same tag names and delimiters with the same messages", async () => {
  const names = ["a+b", "a\\", "a(b", "", "1a", "é"];
  const delimiters = [...names.map((name) => `tag:${name}`), "zz", "é"];
  const dir = await mkdtemp(join(tmpdir(), "promptlang-neutralize-"));
  try {
    await writeFile(join(dir, "promptlang_runtime.py"), getPythonRuntimeSource());
    const script =
      "import json, sys\nfrom promptlang_runtime import neutralize_delimiters as n\n" +
      "out = []\nfor d in json.loads(sys.argv[1]):\n" +
      "    try:\n        n('aab', (d,))\n        out.append(None)\n" +
      "    except ValueError as e:\n        out.append(str(e))\n" +
      "sys.stdout.write(json.dumps(out))\n";
    const r = Bun.spawnSync(["python3", "-c", script, JSON.stringify(delimiters)], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    const typescript = delimiters.map((d) => {
      try {
        n("aab", [d]);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(JSON.parse(r.stdout.toString())).toEqual(typescript);
    expect(typescript.every((m) => m?.startsWith("neutralizeDelimiters: "))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
