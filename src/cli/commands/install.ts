import { loadConfig, CONFIG_FILENAME, ConfigValidationError } from "../../config/config";
import { ConfigParseError } from "../../config/yaml-parser";
import { install } from "../../registry/registry";
import { ResolverError } from "../../registry/resolver";
import { join } from "node:path";

/**
 * Resolves the project's import graph and writes `.promptlang/manifest.json`
 * and `.promptlang/integrity.json`. Reads `promptlang.yaml` from the current
 * directory (or from `--config <path>`).
 */
export async function runInstall(args: string[]): Promise<number> {
  const configPath = parseConfigFlag(args);
  const cwd = process.cwd();
  const resolvedConfigPath = configPath ?? join(cwd, CONFIG_FILENAME);

  try {
    const config = await loadConfig(resolvedConfigPath);
    const result = await install(config, cwd);
    console.log(`  resolved  ${result.manifest.files.length} file(s)`);
    console.log(`  imports   ${result.manifest.imports.length}`);
    console.log(`  written   ${join(result.registryPath, "manifest.json")}`);
    console.log(`  written   ${join(result.registryPath, "integrity.json")}`);
    return 0;
  } catch (error) {
    if (
      error instanceof ConfigParseError ||
      error instanceof ConfigValidationError ||
      error instanceof ResolverError
    ) {
      console.error(`Error: ${(error as Error).message}`);
      return 1;
    }
    throw error;
  }
}

function parseConfigFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--config");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value) return undefined;
  return value;
}
