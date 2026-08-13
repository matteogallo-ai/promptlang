import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILENAME } from "../../config/config";

const TEMPLATE_YAML = `# PromptLang project configuration
name: my-project
version: 0.1.0
description: "A PromptLang project"

defaults:
  model: claude-opus-4.7
  temperature: 0.3
  max_tokens: 1024

sources:
  - path: ./prompts

compile:
  target: typescript
  out: ./generated
  emit_tsconfig: true

linter:
  ai:
    enabled: false
    model: claude-haiku-4-5
    concurrency: 3

# Local packages (remote registry planned for post-v1.0).
# dependencies:
#   - name: promptlang-support-templates
#     version: ^1.0.0
#     path: ./vendor/support-templates
`;

/**
 * Bootstraps a new PromptLang project in the current directory.
 * Creates `promptlang.yaml` and a `prompts/` folder if they do not exist.
 * Never overwrites an existing config.
 */
export async function runInit(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const configPath = join(cwd, CONFIG_FILENAME);
  const force = args.includes("--force");

  const exists = await Bun.file(configPath).exists();
  if (exists && !force) {
    console.error(
      `${CONFIG_FILENAME} already exists in ${cwd}. Use --force to overwrite.`
    );
    return 1;
  }

  await Bun.write(configPath, TEMPLATE_YAML);
  await mkdir(join(cwd, "prompts"), { recursive: true });

  console.log(`  created   ${configPath}`);
  console.log(`  created   ${join(cwd, "prompts")}/`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Add .prompt files to ./prompts/");
  console.log("  2. Run 'promptlang install' to build the registry");
  console.log("  3. Run 'promptlang compile' to generate code");
  return 0;
}
