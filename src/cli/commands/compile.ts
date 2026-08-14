import { Glob } from "bun";
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
import { join, basename, relative, resolve } from "node:path";

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
    outIdx !== -1 && args[outIdx + 1]
      ? args[outIdx + 1]!
      : config?.compile.out ?? "./generated";

  const explicitTarget = targetIdx !== -1 && args[targetIdx + 1];
  const target: "typescript" | "python" = explicitTarget
    ? args[targetIdx + 1] === "python"
      ? "python"
      : "typescript"
    : config?.compile.target ?? "typescript";

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

      if (target === "python") {
        const generated = compilePython(ast, file);
        const outName = basename(file, ".prompt").replace(/-/g, "_") + ".py";
        const outPath = join(outDir, outName);
        await Bun.write(outPath, generated);
        console.log(`  compiled  ${file} → ${outPath}`);
        generatedNames.push(outName);
      } else {
        const generated = compile(ast, file);
        const outName = basename(file, ".prompt") + ".ts";
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
        console.error(`  [error]   ${file}: ${(error as Error).message}`);
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
        generatedNames
          .map((name) => `from .${name.replace(/\.py$/, "")} import *`)
          .join("\n") + "\n";
      const initPath = join(outDir, "__init__.py");
      await Bun.write(initPath, initContent);
      console.log(`  generated ${initPath} (${generatedNames.length} export(s))`);

      // Write the autonomous runtime
      const runtimePath_ = join(outDir, "promptlang_runtime.py");
      await Bun.write(runtimePath_, getPythonRuntimeSource());
      console.log(`  generated ${runtimePath_}`);
    } else {
      const indexContent =
        generatedNames
          .map((name) => `export * from "./${name.replace(/\.ts$/, "")}";`)
          .join("\n") + "\n";
      const indexPath = join(outDir, "index.ts");
      await Bun.write(indexPath, indexContent);
      console.log(`  generated ${indexPath} (${generatedNames.length} export(s))`);
    }
  }

  if (emitTsconfig && target !== "python") {
    const tsconfigPath = join(outDir, "tsconfig.json");
    await Bun.write(tsconfigPath, buildTsconfig(runtimePath));
    console.log(`  emitted   ${tsconfigPath}`);
    console.log(`            (paths "promptlang/runtime" → ${runtimePath})`);
    console.log(
      `            Note: --emit-tsconfig is for local/alpha use. Once promptlang`
    );
    console.log(
      `            is published to npm (v1.0), this flag will not be needed.`
    );
  }

  return hasErrors ? 1 : 0;
}

function computeDefaultRuntimePath(outDir: string): string {
  const outDirAbs = resolve(outDir);
  const runtimeAbs = resolve("src/runtime/index.ts");
  return relative(outDirAbs, runtimeAbs);
}

function buildTsconfig(runtimePath: string): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noImplicitAny: true,
          esModuleInterop: true,
          skipLibCheck: true,
          baseUrl: ".",
          paths: {
            "promptlang/runtime": [runtimePath],
          },
        },
        include: ["./*.ts"],
      },
      null,
      2
    ) + "\n"
  );
}

async function resolveFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const p of paths) {
    if (p.includes("*")) {
      const glob = new Glob(p);
      for await (const file of glob.scan(".")) {
        if (file.endsWith(".prompt")) files.push(file);
      }
    } else if (p.endsWith(".prompt")) {
      files.push(p);
    } else {
      const dir = p.replace(/\/+$/, "");
      const glob = new Glob("**/*.prompt");
      for await (const file of glob.scan(dir)) {
        files.push(`${dir}/${file}`);
      }
    }
  }

  return [...new Set(files)];
}
