import { describe, test, expect } from "bun:test";
import { parseYaml, YamlParseError, type YamlValue } from "@promptlang/yaml-parser";

function asObj(v: YamlValue): Record<string, YamlValue> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("Expected a mapping");
  }
  return v;
}

function asArr(v: YamlValue): YamlValue[] {
  if (!Array.isArray(v)) throw new Error("Expected a sequence");
  return v;
}

describe("yaml-parser: mappings and sequences", () => {
  test("parses a simple flat mapping", () => {
    const result = asObj(parseYaml("name: my-project\nversion: 1.0.0\n"));
    expect(result.name).toBe("my-project");
    expect(result.version).toBe("1.0.0");
  });

  test("parses a simple flat sequence", () => {
    const result = asArr(parseYaml("- one\n- two\n- three\n"));
    expect(result).toEqual(["one", "two", "three"]);
  });

  test("parses a mapping nested two levels deep", () => {
    const src = "defaults:\n  model: claude-opus-4.7\n  temperature: 0.3\n";
    const result = asObj(parseYaml(src));
    const defaults = asObj(result.defaults!);
    expect(defaults.model).toBe("claude-opus-4.7");
    expect(defaults.temperature).toBe(0.3);
  });

  test("parses a sequence of mappings", () => {
    const src = "sources:\n  - path: ./prompts\n  - path: ./shared-prompts\n";
    const result = asObj(parseYaml(src));
    const sources = asArr(result.sources!);
    expect(sources).toHaveLength(2);
    expect(asObj(sources[0]!).path).toBe("./prompts");
    expect(asObj(sources[1]!).path).toBe("./shared-prompts");
  });

  test("parses a sequence-of-mappings item with multiple keys", () => {
    const src =
      "dependencies:\n" +
      "  - name: pkg-a\n" +
      "    version: ^1.2.0\n" +
      "    path: ./vendor/a\n";
    const result = asObj(parseYaml(src));
    const deps = asArr(result.dependencies!);
    expect(deps).toHaveLength(1);
    const first = asObj(deps[0]!);
    expect(first.name).toBe("pkg-a");
    expect(first.version).toBe("^1.2.0");
    expect(first.path).toBe("./vendor/a");
  });
});

describe("yaml-parser: scalars", () => {
  test("parses unquoted strings", () => {
    const result = asObj(parseYaml("name: my-project\n"));
    expect(result.name).toBe("my-project");
  });

  test("parses double-quoted strings with escapes", () => {
    const result = asObj(parseYaml('desc: "line1\\nline2\\t\\"quote\\""\n'));
    expect(result.desc).toBe('line1\nline2\t"quote"');
  });

  test("parses integer and float numbers", () => {
    const result = asObj(parseYaml("count: 42\nratio: 3.14\nneg: -7\n"));
    expect(result.count).toBe(42);
    expect(result.ratio).toBeCloseTo(3.14);
    expect(result.neg).toBe(-7);
  });

  test("parses booleans (true / false)", () => {
    const result = asObj(parseYaml("enabled: true\ndebug: false\n"));
    expect(result.enabled).toBe(true);
    expect(result.debug).toBe(false);
  });

  test("parses nulls (~ and null)", () => {
    const result = asObj(parseYaml("a: ~\nb: null\nc:\n"));
    expect(result.a).toBeNull();
    expect(result.b).toBeNull();
    expect(result.c).toBeNull();
  });

  test("ignores full-line and inline comments", () => {
    const src =
      "# leading comment\n" +
      "name: p # inline comment\n" +
      "# another line\n" +
      "count: 3\n";
    const result = asObj(parseYaml(src));
    expect(result.name).toBe("p");
    expect(result.count).toBe(3);
    // '#' inside quotes is preserved as-is.
    const quoted = asObj(parseYaml('note: "keep # this"\n'));
    expect(quoted.note).toBe("keep # this");
  });
});

describe("yaml-parser: full promptlang.yaml example", () => {
  test("parses the full example from the mission spec", () => {
    const src = `# promptlang.yaml
name: my-ai-project
version: 1.0.0
description: "Support ticket classification"

defaults:
  model: claude-opus-4.7
  temperature: 0.3
  max_tokens: 1024

sources:
  - path: ./prompts
  - path: ./shared-prompts

compile:
  target: typescript
  out: ./generated
  emit_tsconfig: true

linter:
  ai:
    enabled: false
    model: claude-haiku-4-5
    concurrency: 3

dependencies:
  - name: promptlang-support-templates
    version: ^1.2.0
    path: ./vendor/support-templates
`;
    const result = asObj(parseYaml(src));
    expect(result.name).toBe("my-ai-project");
    expect(result.version).toBe("1.0.0");
    expect(result.description).toBe("Support ticket classification");

    const defaults = asObj(result.defaults!);
    expect(defaults.model).toBe("claude-opus-4.7");
    expect(defaults.temperature).toBe(0.3);
    expect(defaults.max_tokens).toBe(1024);

    const sources = asArr(result.sources!);
    expect(sources).toHaveLength(2);
    expect(asObj(sources[0]!).path).toBe("./prompts");

    const compile = asObj(result.compile!);
    expect(compile.target).toBe("typescript");
    expect(compile.out).toBe("./generated");
    expect(compile.emit_tsconfig).toBe(true);

    const linter = asObj(result.linter!);
    const ai = asObj(linter.ai!);
    expect(ai.enabled).toBe(false);
    expect(ai.model).toBe("claude-haiku-4-5");
    expect(ai.concurrency).toBe(3);

    const deps = asArr(result.dependencies!);
    expect(deps).toHaveLength(1);
    const dep = asObj(deps[0]!);
    expect(dep.name).toBe("promptlang-support-templates");
    expect(dep.version).toBe("^1.2.0");
    expect(dep.path).toBe("./vendor/support-templates");
  });
});

describe("yaml-parser: errors", () => {
  test("throws on inconsistent indentation", () => {
    const src = "root:\n  a: 1\n   b: 2\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
  });

  test("throws on a malformed mapping line", () => {
    const src = "root:\n  just a scalar with no colon\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
  });

  test("throws on unsupported anchor (&)", () => {
    const src = "root: &anchor 1\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
    try {
      parseYaml(src);
    } catch (e) {
      expect((e as Error).message).toContain("anchors");
    }
  });

  test("throws on unsupported alias (*)", () => {
    const src = "root: *ref\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
  });

  test("throws on unsupported block scalar (|)", () => {
    const src = "root: |\n  line one\n  line two\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
  });

  test("throws on tabs used for indentation", () => {
    const src = "root:\n\ta: 1\n";
    expect(() => parseYaml(src)).toThrow(YamlParseError);
    try {
      parseYaml(src);
    } catch (e) {
      expect((e as Error).message).toContain("Tab");
    }
  });

  test("throws on flow-style collections", () => {
    expect(() => parseYaml("root: [1, 2, 3]\n")).toThrow(YamlParseError);
    expect(() => parseYaml("root: {a: 1}\n")).toThrow(YamlParseError);
  });

  test("error message includes the offending line number", () => {
    const src = "root:\n  a: 1\n  b: &x 2\n";
    try {
      parseYaml(src);
      throw new Error("expected error");
    } catch (e) {
      expect((e as YamlParseError).line).toBe(3);
    }
  });
});

describe("yaml-parser: types are typed correctly", () => {
  test("returns a mapping when the root is a mapping", () => {
    const result = parseYaml("a: 1\nb: 2\n");
    expect(typeof result).toBe("object");
    expect(Array.isArray(result)).toBe(false);
    expect((result as Record<string, YamlValue>).a).toBe(1);
  });

  test("returns null for an empty document", () => {
    expect(parseYaml("")).toBeNull();
    expect(parseYaml("# only a comment\n")).toBeNull();
  });

  test("preserves original number types", () => {
    const result = asObj(parseYaml("i: 1\nf: 1.5\ne: 1.5e2\n"));
    expect(Number.isInteger(result.i as number)).toBe(true);
    expect(Number.isInteger(result.f as number)).toBe(false);
    expect(result.e).toBe(150);
  });
});
