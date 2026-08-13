import { describe, test, expect } from "bun:test";
import {
  parseConfig,
  loadConfig,
  ConfigValidationError,
  ConfigParseError,
  CONFIG_DEFAULTS,
} from "./config";

const VALID_MIN = `name: my-project\nversion: 1.0.0\n`;

const VALID_FULL = `name: my-project
version: 1.0.0
description: "A test project"
defaults:
  model: claude-opus-4.7
  temperature: 0.7
  max_tokens: 2048
sources:
  - path: ./prompts
  - path: ./vendor
compile:
  target: python
  out: ./out
  emit_tsconfig: false
linter:
  ai:
    enabled: true
    model: claude-haiku-4-5
    concurrency: 5
dependencies:
  - name: pkg-a
    version: ^1.0.0
    path: ./vendor/pkg-a
`;

describe("config: parsing valid input", () => {
  test("parses a full, valid promptlang.yaml into a typed object", () => {
    const cfg = parseConfig(VALID_FULL);
    expect(cfg.name).toBe("my-project");
    expect(cfg.version).toBe("1.0.0");
    expect(cfg.description).toBe("A test project");
    expect(cfg.defaults.model).toBe("claude-opus-4.7");
    expect(cfg.defaults.temperature).toBe(0.7);
    expect(cfg.defaults.max_tokens).toBe(2048);
    expect(cfg.sources).toHaveLength(2);
    expect(cfg.sources[0]!.path).toBe("./prompts");
    expect(cfg.compile.target).toBe("python");
    expect(cfg.compile.out).toBe("./out");
    expect(cfg.compile.emit_tsconfig).toBe(false);
    expect(cfg.linter.ai.enabled).toBe(true);
    expect(cfg.linter.ai.concurrency).toBe(5);
    expect(cfg.dependencies).toHaveLength(1);
    expect(cfg.dependencies[0]!.name).toBe("pkg-a");
  });
});

describe("config: required fields", () => {
  test("throws when 'name' is missing", () => {
    expect(() => parseConfig(`version: 1.0.0\n`)).toThrow(ConfigValidationError);
  });

  test("throws when 'version' is missing", () => {
    expect(() => parseConfig(`name: p\n`)).toThrow(ConfigValidationError);
  });
});

describe("config: defaults applied", () => {
  test("applies defaults for defaults, compile, linter, sources, dependencies", () => {
    const cfg = parseConfig(VALID_MIN);
    expect(cfg.defaults.model).toBe(CONFIG_DEFAULTS.defaults.model);
    expect(cfg.defaults.temperature).toBe(CONFIG_DEFAULTS.defaults.temperature);
    expect(cfg.defaults.max_tokens).toBe(CONFIG_DEFAULTS.defaults.max_tokens);
    expect(cfg.compile.target).toBe(CONFIG_DEFAULTS.compile.target);
    expect(cfg.compile.out).toBe(CONFIG_DEFAULTS.compile.out);
    expect(cfg.compile.emit_tsconfig).toBe(CONFIG_DEFAULTS.compile.emit_tsconfig);
    expect(cfg.linter.ai.enabled).toBe(CONFIG_DEFAULTS.linter.ai.enabled);
    expect(cfg.linter.ai.model).toBe(CONFIG_DEFAULTS.linter.ai.model);
    expect(cfg.sources).toEqual([]);
    expect(cfg.dependencies).toEqual([]);
    expect(cfg.description).toBeNull();
  });

  test("applies partial defaults inside 'defaults' when only some keys are set", () => {
    const cfg = parseConfig(`name: p\nversion: "1"\ndefaults:\n  model: custom-model\n`);
    expect(cfg.defaults.model).toBe("custom-model");
    expect(cfg.defaults.temperature).toBe(CONFIG_DEFAULTS.defaults.temperature);
    expect(cfg.defaults.max_tokens).toBe(CONFIG_DEFAULTS.defaults.max_tokens);
  });
});

describe("config: file loading", () => {
  test("loadConfig throws when the file does not exist", async () => {
    await expect(loadConfig("/tmp/does-not-exist-promptlang.yaml")).rejects.toThrow(
      ConfigValidationError
    );
  });

  test("loadConfig reads and parses a real file on disk", async () => {
    const path = "/tmp/promptlang-config-test.yaml";
    await Bun.write(path, VALID_MIN);
    const cfg = await loadConfig(path);
    expect(cfg.name).toBe("my-project");
    expect(cfg.version).toBe("1.0.0");
  });
});

describe("config: invalid values", () => {
  test("throws on invalid compile.target", () => {
    const src = `name: p\nversion: "1"\ncompile:\n  target: cobol\n`;
    expect(() => parseConfig(src)).toThrow(ConfigValidationError);
    try {
      parseConfig(src);
    } catch (e) {
      expect((e as Error).message).toContain("target");
    }
  });

  test("throws when 'sources' is not a sequence", () => {
    const src = `name: p\nversion: "1"\nsources:\n  path: ./x\n`;
    expect(() => parseConfig(src)).toThrow(ConfigValidationError);
  });

  test("throws when a dependency entry is missing 'name'", () => {
    const src =
      `name: p\nversion: "1"\ndependencies:\n  - version: ^1\n    path: ./vendor\n`;
    expect(() => parseConfig(src)).toThrow(ConfigValidationError);
  });

  test("throws when 'defaults.temperature' is a string", () => {
    const src = `name: p\nversion: "1"\ndefaults:\n  temperature: "hot"\n`;
    expect(() => parseConfig(src)).toThrow(ConfigValidationError);
  });

  test("propagates YAML syntax errors as ConfigParseError", () => {
    const src = `name: p\nversion: "1"\ndefaults:\n  bad: &anchor 1\n`;
    expect(() => parseConfig(src)).toThrow(ConfigParseError);
  });
});
