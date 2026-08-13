import { join, relative } from "node:path";
import {
  loadConfig,
  CONFIG_FILENAME,
  ConfigValidationError,
} from "../../config/config";
import { ConfigParseError } from "../../config/yaml-parser";
import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import { discoverLocalPrompts, readManifest } from "../../registry/registry";

interface ListedPrompt {
  file: string;
  prompts: string[];
  chains: string[];
  imports: string[];
}

/**
 * Lists every prompt discovered in the project, split by declaration kind.
 * `--json` prints a machine-readable payload; otherwise a human-friendly tree.
 */
export async function runList(args: string[]): Promise<number> {
  const asJson = args.includes("--json");
  const configPath = parseConfigFlag(args);
  const cwd = process.cwd();

  try {
    const config = await loadConfig(configPath ?? join(cwd, CONFIG_FILENAME));
    const localFiles = await discoverLocalPrompts(config, cwd);
    const manifest = await readManifest(cwd);

    const allFiles = new Set<string>(localFiles);
    if (manifest) {
      for (const f of manifest.files) allFiles.add(f);
    }

    const rows: ListedPrompt[] = [];
    for (const file of [...allFiles].sort()) {
      const info = await inspectFile(file);
      rows.push(info);
    }

    if (asJson) {
      const payload = {
        project: { name: config.name, version: config.version },
        files: rows.map((r) => ({
          file: relative(cwd, r.file),
          prompts: r.prompts,
          chains: r.chains,
          imports: r.imports,
        })),
      };
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${config.name}@${config.version}`);
      console.log("");
      for (const r of rows) {
        console.log(`  ${relative(cwd, r.file)}`);
        for (const p of r.prompts) console.log(`    prompt  ${p}`);
        for (const c of r.chains) console.log(`    chain   ${c}`);
        for (const i of r.imports) console.log(`    import  ${i}`);
      }
      console.log("");
      console.log(`  ${rows.length} file(s) total`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
      console.error(`Error: ${(error as Error).message}`);
      return 1;
    }
    throw error;
  }
}

async function inspectFile(file: string): Promise<ListedPrompt> {
  const source = await Bun.file(file).text();
  try {
    const ast = parse(tokenize(source));
    const prompts: string[] = [];
    const chains: string[] = [];
    for (const d of ast.declarations) {
      if (d.kind === "PromptDeclaration") prompts.push(d.name);
      else if (d.kind === "ChainDeclaration") chains.push(d.name);
    }
    const imports = ast.imports.map((i) => `${i.path} as ${i.alias}`);
    return { file, prompts, chains, imports };
  } catch {
    return { file, prompts: [], chains: [], imports: [] };
  }
}

function parseConfigFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--config");
  if (idx === -1) return undefined;
  return args[idx + 1];
}
