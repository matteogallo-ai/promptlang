# Security Policy

## Reporting a vulnerability

Email **matteo.gallo@gallarti.io** with the subject line
`[SECURITY] PromptLang — <brief description>`. Do **not** open a public GitHub
issue. Reports are acknowledged within 48 hours; a fix or mitigation is targeted
within 14 days.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.2.x (current `main`) | Yes |
| < 1.2   | No |

PromptLang is not published to npm; "supported" means fixes land on `main` and in
the next tag. `@promptlang/yaml-parser` (published on npm) follows its own
versions; the latest release is supported.

## How API keys are handled

What the code does today:

- TypeScript provider clients (`AnthropicClient`, `OpenAIClient` in
  `src/runtime/`) receive the key as the `apiKey` constructor option. PromptLang never reads a key from a file. The
  documented pattern is `apiKey: process.env.ANTHROPIC_API_KEY`.
- In the TypeScript runtime, a missing, empty or whitespace-only key is rejected
  at construction with a `TypeError`, so a request is never sent unauthenticated.
- The generated Python runtime (`promptlang_runtime.py`) does **not** validate
  `api_key`, and it reads provider responses with defaults (`data.get(..., 0)`),
  so a malformed body yields empty content and zero token counts instead of an
  error. Validate keys and responses yourself when you use the Python target.
- The key is sent only in the provider's auth header (`x-api-key` for Anthropic,
  `Authorization: Bearer` for OpenAI) to the configured `baseURL`. It is not
  logged and is not included in error messages.
- The AI linter (`analyze --ai`) reads `ANTHROPIC_API_KEY` from the environment.
- `promptlang.yaml` has no field for secrets. Do not put keys in `.prompt` files
  or in `promptlang.yaml`: both are meant to be committed.
- Setting `baseURL` sends your key to that host. Only point it at endpoints you
  trust.

## Threat model

PromptLang compiles `.prompt` files into code that calls LLM providers. The assets
are your provider keys, the integrity of the prompts you ship, and the behaviour
of the model calls made from generated code.

| Threat | Where it enters | What PromptLang does | What it does not do |
| ------ | --------------- | -------------------- | ------------------- |
| Prompt injection through interpolated input | `{{variable}}` in a template, filled at runtime with end-user or retrieved content | The static rule `prompt-injection-risk` warns when a **user**-role section interpolates a variable and contains none of the delimiter markers `---`, triple backticks, `<tag>`, `<BEGIN>`/`<END>`, `[[`/`]]` | It does not escape, sanitize or bound the interpolated value at runtime; it does not check `system` or `assistant` sections; the presence of any marker anywhere in the section silences it, whether or not the marker actually surrounds the variable; it does not add an "untrusted content" instruction |
| Hostile `.prompt` file | Imported or copied from someone else | `install` records SHA-256 hashes in `.promptlang/integrity.json`; `check` fails when a file changed since | It does not judge whether a prompt is malicious; a hash only tells you the file changed |
| Hostile `.prompt` file sent to the AI linter | `analyze --ai` sends each prompt's text to Claude | — | The prompt text is inserted into the linter's request without delimiters or an untrusted-content instruction, so a crafted prompt can steer the linter's verdict (for example make it report no issues). Treat AI linter output as advisory |
| Key leakage | Keys in source, logs or committed config | Keys are passed in memory only; the TypeScript runtime rejects empty keys | It cannot stop you from hard-coding a key or committing a `.env` file |
| Untrusted model output | The response of any provider | Typed outputs are parsed (`JSON.parse` for structs, enum membership checks); in the TypeScript runtime a malformed provider response raises `InvalidResponseError` | It does not validate struct field contents beyond parsing; the Python runtime does not check the response shape; treat model output that drives code or queries as untrusted |
| Generated code | Output of `compile` | Deterministic code generation; no network access at compile time (except `analyze --ai`) | Generated functions make network calls when run; review them, especially chains that make several calls |

## Reporting scope

In scope: the compiler, CLI, runtime clients, analyzer and `@promptlang/yaml-parser`.
Out of scope: vulnerabilities in the LLM providers themselves, and prompt-injection
weaknesses in prompts you wrote (the linter rule above is a heuristic, not a
guarantee).
