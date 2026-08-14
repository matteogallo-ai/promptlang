import { join } from "node:path";
import {
  loadConfig,
  CONFIG_FILENAME,
  ConfigValidationError,
} from "../../config/config";
import { YamlParseError } from "@promptlang/yaml-parser";
import { check } from "../../registry/registry";
import { ResolverError } from "../../registry/resolver";

/**
 * Verifies that:
 *   1. `promptlang.yaml` parses and validates.
 *   2. Every import listed in the manifest resolves to an existing file.
 *   3. Every file's SHA-256 matches the recorded integrity hash.
 *
 * Exits 0 when the project is clean, 1 otherwise.
 */
export async function runCheck(args: string[]): Promise<number> {
  const configPath = parseConfigFlag(args);
  const cwd = process.cwd();

  try {
    const config = await loadConfig(configPath ?? join(cwd, CONFIG_FILENAME));
    const mismatches = await check(config, cwd);
    if (mismatches.length === 0) {
      console.log("  ok        project integrity verified");
      return 0;
    }
    console.error(`  [error]   ${mismatches.length} file(s) failed integrity check:`);
    for (const m of mismatches) {
      console.error(`  - ${m.file}`);
      console.error(`      expected: ${m.expected}`);
      console.error(`      actual:   ${m.actual}`);
    }
    return 1;
  } catch (error) {
    if (
      error instanceof YamlParseError ||
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
  return args[idx + 1];
}
