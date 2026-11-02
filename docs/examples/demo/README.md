# SemVer for prompts: demo

`bun run demo` (from the repository root) runs [`scripts/demo.ts`](../../../scripts/demo.ts),
which copies this folder into a temporary Git repository and plays five steps with
the real `promptlang` CLI. Each step has an expected exit code; any other code stops
the demo with exit 1. `tests/demo.test.ts` runs it in CI.

| Step | Command | Expected |
| --- | --- | --- |
| 1 | `promptlang install` with `sentiment.prompt` 1.0.0 committed and tagged `v1.0.0` | exit 0: `report.prompt` imports it with `requires "^1.0.0"` |
| 2 | `promptlang semver-check` after changing `sentiment.prompt` incompatibly (parameter renamed, output enum extended) but versioning it 1.1.0 | exit 1, listing each change and the required 2.0.0 |
| 3 | `promptlang semver-check` with the same change versioned 2.0.0 | exit 0 |
| 4 | `promptlang install` | exit 1: `report.prompt` requires `^1.0.0`, got 2.0.0 |
| 5 | `promptlang test prompts` | exit 0: every test passes on its `mock:` response |

Files:

- `prompts/sentiment.v1.prompt`, `prompts/sentiment.v2.prompt`: the two versions of
  the shared prompt; the demo installs each as `prompts/sentiment.prompt`.
- `prompts/report.prompt`: the consumer pinned to `^1.0.0`.
- `promptlang.yaml`: the project configuration `install` reads.

Step 5 uses mock responses: it shows the tests run and their assertions hold
against the generated code, not that the model answers correctly
(`promptlang test --live` does that, after a cost estimate).
