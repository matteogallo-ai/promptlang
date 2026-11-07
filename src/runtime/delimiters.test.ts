import { describe, expect, test } from "bun:test";
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
    expect(n("[[a]]]", ["brackets"])).toBe("[ [a] ] ]");
    expect(n("``ok`` ```x````", ["fence"])).toBe("``ok`` ` ` `x` ` ` `");
    expect(n("---\n -- \n----\r\nx---", ["dashes"])).toBe("- - -\n -- \n- - - -\r\nx---");
  });

  test("no delimiter, no change; an unknown one is a bug in the caller", () => {
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

pythonTest("Python refuses the same tag names with the same message", async () => {
  const names = ["a+b", "a\\", "a(b", "", "1a"];
  const dir = await mkdtemp(join(tmpdir(), "promptlang-neutralize-"));
  try {
    await writeFile(join(dir, "promptlang_runtime.py"), getPythonRuntimeSource());
    const script =
      "import json, sys\nfrom promptlang_runtime import neutralize_delimiters as n\n" +
      "out = []\nfor name in json.loads(sys.argv[1]):\n" +
      "    try:\n        n('aab', ('tag:' + name,))\n        out.append(None)\n" +
      "    except ValueError as e:\n        out.append(str(e))\n" +
      "sys.stdout.write(json.dumps(out))\n";
    const r = Bun.spawnSync(["python3", "-c", script, JSON.stringify(names)], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    expect(JSON.parse(r.stdout.toString())).toEqual(
      names.map((name) => `neutralizeDelimiters: invalid tag name ${JSON.stringify(name)}`)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
