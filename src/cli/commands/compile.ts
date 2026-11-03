import { resolveFiles } from "../files";
import { warnAboutEvals, warnAboutTemperature } from "../warnings";
import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import { compile } from "../../compiler/compiler";
import { compilePython } from "../../compiler/python/python-compiler";
import { getPythonRuntimeSource } from "../../compiler/python/python-runtime-template";
import { LexerError } from "../../lexer/errors";
import { ParserError } from "../../parser/errors";
import { CompilerError } from "../../compiler/errors";
import {
  loadConfig,
  CONFIG_FILENAME,
  ConfigValidationError,
  type PromptLangConfig,
} from "../../config/config";
import { YamlParseError } from "@promptlang/yaml-parser";
import { mkdir } from "node:fs/promises";
import { join, basename, isAbsolute, relative, resolve } from "node:path";

const TARGETS = ["typescript", "python"] as const;
type Target = (typeof TARGETS)[number];

function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

export async function runCompile(args: string[]): Promise<number> {
  const outIdx = args.indexOf("--out");
  const emitTsconfig = args.includes("--emit-tsconfig");
  const targetIdx = args.indexOf("--target");
  const runtimePathIdx = args.indexOf("--runtime-path");
  const configIdx = args.indexOf("--config");

  const paths = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i === outIdx + 1) return false;
    if (runtimePathIdx !== -1 && i === runtimePathIdx + 1) return false;
    if (targetIdx !== -1 && i === targetIdx + 1) return false;
    if (configIdx !== -1 && i === configIdx + 1) return false;
    return true;
  });

  // Attempt to load promptlang.yaml when it is available. Explicit CLI flags
  // always win over config values.
  let config: PromptLangConfig | null = null;
  const configPath =
    configIdx !== -1 && args[configIdx + 1]
      ? args[configIdx + 1]!
      : join(process.cwd(), CONFIG_FILENAME);
  const wantsConfig = configIdx !== -1;
  try {
    if (wantsConfig || (await Bun.file(configPath).exists())) {
      config = await loadConfig(configPath);
    }
  } catch (error) {
    if (error instanceof YamlParseError || error instanceof ConfigValidationError) {
      console.error(`Error: ${(error as Error).message}`);
      return 1;
    }
    throw error;
  }

  const outDir =
    outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1]! : (config?.compile.out ?? "./generated");

  // Reject unknown values rather than defaulting: a fallback to TypeScript would
  // hand `--target py` users .ts files with no warning. promptlang.yaml does the same.
  let target: Target = config?.compile.target ?? "typescript";
  if (targetIdx !== -1) {
    const value = args[targetIdx + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`Error: --target requires a value (${TARGETS.join(", ")})`);
      return 1;
    }
    if (!isTarget(value)) {
      console.error(`Error: unknown --target '${value}' (expected one of: ${TARGETS.join(", ")})`);
      return 1;
    }
    target = value;
  }

  const runtimePath =
    runtimePathIdx !== -1 && args[runtimePathIdx + 1]
      ? args[runtimePathIdx + 1]!
      : computeDefaultRuntimePath(outDir);

  if (emitTsconfig && target === "python") {
    console.error("  [warn]    --emit-tsconfig is ignored for --target python");
  }

  // When no path is given but the project config declares sources, use them.
  if (paths.length === 0 && config && config.sources.length > 0) {
    for (const s of config.sources) paths.push(s.path);
  }

  if (paths.length === 0) {
    console.error(
      "Missing file argument.\n" +
        "Usage: promptlang compile <file|dir|glob> [--out <dir>] [--target typescript|python] [--config <path>] [--emit-tsconfig [--runtime-path <path>]]"
    );
    return 1;
  }

  const files = await resolveFiles(paths);

  if (files.length === 0) {
    console.error("No .prompt files found at the specified path(s).");
    return 1;
  }

  await mkdir(outDir, { recursive: true });

  const generatedNames: string[] = [];
  let hasErrors = false;

  for (const file of files) {
    let source: string;
    try {
      source = await Bun.file(file).text();
    } catch {
      console.error(`Could not read file: ${file}`);
      hasErrors = true;
      continue;
    }

    try {
      const tokens = tokenize(source);
      const ast = parse(tokens);
      // A file without declarations would otherwise "compile" to a module exporting
      // nothing and be reported as success, so the missing prompt only surfaces at
      // import time. Imports do not count: both compilers emit no code for them.
      if (ast.declarations.length === 0) {
        throw new CompilerError("file contains no declarations (empty .prompt file)", 1, 1);
      }

      warnAboutEvals(ast, file);
      warnAboutTemperature(ast, file);

      if (target === "python") {
        const generated = compilePython(ast, file);
        const outName = `${basename(file, ".prompt").replace(/-/g, "_")}.py`;
        const outPath = join(outDir, outName);
        await Bun.write(outPath, generated);
        console.log(`  compiled  ${file} → ${outPath}`);
        generatedNames.push(outName);
      } else {
        const generated = compile(ast, file);
        const outName = `${basename(file, ".prompt")}.ts`;
        const outPath = join(outDir, outName);
        await Bun.write(outPath, generated);
        console.log(`  compiled  ${file} → ${outPath}`);
        generatedNames.push(outName);
      }
    } catch (error) {
      if (
        error instanceof LexerError ||
        error instanceof ParserError ||
        error instanceof CompilerError
      ) {
        const at =
          error instanceof CompilerError && error.line !== undefined
            ? `:${error.line}:${error.column ?? 1}`
            : "";
        console.error(`  [error]   ${file}${at}: ${(error as Error).message}`);
        hasErrors = true;
      } else {
        throw error;
      }
    }
  }

  if (generatedNames.length > 0) {
    if (target === "python") {
      // Write __init__.py barrel
      const initContent =
        generatedNames.map((name) => `from .${name.replace(/\.py$/, "")} import *`).join("\n") +
        "\n";
      const initPath = join(outDir, "__init__.py");
      await Bun.write(initPath, initContent);
      console.log(`  generated ${initPath} (${generatedNames.length} export(s))`);

      // Write the autonomous runtime
      const runtimePath_ = join(outDir, "promptlang_runtime.py");
      await Bun.write(runtimePath_, getPythonRuntimeSource());
      console.log(`  generated ${runtimePath_}`);
    } else {
      const indexContent =
        generatedNames.map((name) => `export * from "./${name.replace(/\.ts$/, "")}";`).join("\n") +
        "\n";
      const indexPath = join(outDir, "index.ts");
      await Bun.write(indexPath, indexContent);
      console.log(`  generated ${indexPath} (${generatedNames.length} export(s))`);
    }
  }

  if (emitTsconfig && target !== "python") {
    const tsconfigPath = join(outDir, "tsconfig.json");
    const pathsEntry = asPathsEntry(runtimePath);
    await Bun.write(tsconfigPath, buildTsconfig(pathsEntry));
    console.log(`  emitted   ${tsconfigPath}`);
    console.log(`            (paths "@promptlang/core/runtime" → ${pathsEntry})`);
    console.log(`            Note: the mapping points at this checkout's runtime source;`);
    console.log(`            with @promptlang/core installed, the import resolves without it.`);
  }

  return hasErrors ? 1 : 0;
}

function computeDefaultRuntimePath(outDir: string): string {
  const outDirAbs = resolve(outDir);
  const runtimeAbs = resolve("src/runtime/index.ts");
  return relative(outDirAbs, runtimeAbs);
}

// Without baseUrl (removed in TypeScript 7), a paths entry resolves from the
// tsconfig's directory and must start with "./" or "../" (TS5090 otherwise);
// TypeScript accepts either separator, and path.relative() returns ..\ on Windows.
function asPathsEntry(path: string): string {
  if (isAbsolute(path) || /^\.\.?[\\/]/.test(path)) return path;
  return `./${path}`;
}

function buildTsconfig(pathsEntry: string): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noImplicitAny: true,
        esModuleInterop: true,
        skipLibCheck: true,
        paths: {
          "@promptlang/core/runtime": [pathsEntry],
        },
      },
      include: ["./*.ts"],
    },
    null,
    2
  )}\n`;
}
