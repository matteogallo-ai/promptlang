# Benchmarks — PromptLang v1.0

All numbers measured on the reference machine below. Reproduce them
locally with the commands shown next to each table.

## Reference machine

| Item | Value |
| ---- | ----- |
| Machine  | MacBook Pro (Mac16,1) |
| Chip     | Apple M4 — 10 cores (4 performance + 6 efficiency) |
| Memory   | 16 GB unified |
| OS       | macOS 15.6 (24G84) |
| Runtime  | Bun 1.3.14 |
| Compiler | TypeScript 5.9.3 |

## Codebase footprint

| Item | Value |
| ---- | ----- |
| Production source LOC (excluding tests) | 6 900 |
| Test LOC                                 | 6 865 |
| Total TypeScript LOC                     | 13 765 |
| External dependencies                    | **0** (only `@types/bun` and `typescript` as devDependencies) |

## Test suite

Full run, 3 samples (median):

| Metric | Value |
| ------ | ----- |
| Tests    | 596 pass / 0 fail |
| `expect()` calls | 1 040 |
| Files    | 22 |
| Wall time (median of 3) | **1.71 s** |
| Peak RSS during run | 231 MB |

Reproduce:

```bash
bun test                                       # runs the suite
/usr/bin/time -l bun test 2>&1 | grep maximum # peak RSS on macOS
```

## Compilation performance (end-to-end CLI)

Wall time from process spawn to exit — includes Bun startup, TypeScript
loading, and the full compile pipeline (tokenize → parse → codegen → write).
Median of 10 runs per row (2 warm-up runs discarded).

| Command                                                                  | Median | Min   | Max   |
| ------------------------------------------------------------------------ | -----: | ----: | ----: |
| `compile classify-ticket.prompt --out /tmp/o`                            | 18.5 ms | 18.4 ms | 19.3 ms |
| `compile extract-invoice.prompt --out /tmp/o`                            | 18.5 ms | 18.2 ms | 18.8 ms |
| `compile summarize-and-translate.prompt --out /tmp/o`                    | 18.4 ms | 18.0 ms | 19.3 ms |
| `compile classify-ticket.prompt --out /tmp/o --target python`            | 18.6 ms | 18.3 ms | 19.2 ms |
| `compile docs/examples/ --out /tmp/o --emit-tsconfig` (all 3 files + tsconfig) | 20.1 ms | 19.5 ms | 20.3 ms |
| `parse classify-ticket.prompt`                                           | 17.7 ms | 17.5 ms | 18.0 ms |
| `analyze docs/examples/` (6 static rules × 3 files)                      | 19.3 ms | 19.0 ms | 19.6 ms |
| `version`                                                                | 16.2 ms | 15.8 ms | 16.5 ms |

Reproduce (Python 3 script uses `time.perf_counter()`):

```bash
python3 -c "
import subprocess, time
cmd = ['bun', 'run', 'src/cli/cli.ts', 'compile',
       'docs/examples/classify-ticket.prompt', '--out', '/tmp/o']
for _ in range(2): subprocess.run(cmd, capture_output=True)  # warmup
samples = []
for _ in range(10):
    t = time.perf_counter()
    subprocess.run(cmd, capture_output=True, check=True)
    samples.append((time.perf_counter() - t) * 1000)
samples.sort()
print(f'median={samples[5]:.1f} ms  min={samples[0]:.1f}  max={samples[-1]:.1f}')
"
```

**Takeaway** — the CLI is dominated by Bun startup (~16 ms). The actual
compile work is well under 1 ms per file, so throughput scales linearly with
the number of files you pass in a single invocation.

## Hot-loop performance (excludes process startup)

Same functions, measured in a warm Bun process over 200 iterations
(10 warm-up passes discarded). Numbers are per-iteration averages.

| Operation                                    | classify-ticket | extract-invoice | summarize-and-translate |
| -------------------------------------------- | --------------: | --------------: | ----------------------: |
| Tokens produced                              | 182 | 198 | 274 |
| Source bytes                                 | 2 158 | 2 622 | 2 448 |
| `tokenize()`                                 | 0.04 ms | 0.04 ms | 0.04 ms |
| `parse(tokenize(...))` (parse + tokenize)    | 0.06 ms | 0.05 ms | 0.04 ms |
| `compile(ast, file)` (TypeScript codegen)    | 0.01 ms | 0.01 ms | 0.01 ms |
| `compilePython(ast, file)` (Python codegen)  | 0.01 ms | 0.01 ms | 0.01 ms |

Reproduce with the micro-benchmark script:

```typescript
// bench.ts (run with: bun run bench.ts)
import { tokenize } from "./src/lexer/lexer";
import { parse } from "./src/parser/parser";
import { compile } from "./src/compiler/compiler";

const src = await Bun.file("docs/examples/classify-ticket.prompt").text();
const ast = parse(tokenize(src));

const N = 200;
for (let i = 0; i < 10; i++) compile(ast, "x"); // warmup
const t = performance.now();
for (let i = 0; i < N; i++) compile(ast, "x");
console.log(`compile: ${((performance.now() - t) / N).toFixed(3)} ms`);
```

## Memory footprint

| Scenario | Peak RSS |
| -------- | -------: |
| `compile docs/examples/ --out … --emit-tsconfig` (3 files) | **50 MB** |
| Full `bun test` (596 tests, 22 files) | **231 MB** |

Reproduce:

```bash
/usr/bin/time -l bun run src/cli/cli.ts compile docs/examples/ \
  --out /tmp/out --emit-tsconfig 2>&1 | grep "maximum resident"

/usr/bin/time -l bun test 2>&1 | grep "maximum resident"
```

The compile-time footprint (~50 MB) is dominated by Bun's runtime and V8-style
memory pools. PromptLang itself allocates a small amount of transient data per
file (token array + AST) that is garbage-collected between files.

## AI-powered linter

Requires `ANTHROPIC_API_KEY` and hits the network on every invocation, so we
do not include a fixed number here — the wall time is dominated by round-trip
latency to Anthropic, not by PromptLang itself.

Typical single-prompt call (Claude Haiku 4.5, 200–400 input tokens):

| Phase | Typical time |
| ----- | -----------: |
| HTTP round trip to `api.anthropic.com` | 800 – 1 500 ms |
| JSON response parse + issue mapping | < 5 ms |
| **Total per prompt (sequential)** | ~1 – 2 s |

The linter parallelizes 3 prompts at a time by default (`concurrency: 3`), so
a project with 10 prompts typically finishes in **5 – 8 seconds** wall-clock.

Reproduce:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
time bun run cli analyze docs/examples/ --ai
```

## What these numbers mean

- **You can put PromptLang in a pre-commit hook.** A full `analyze` of a
  three-file project completes in under 20 ms, faster than most linters
  (`eslint`, `ruff`) even start.
- **The compiler is not the bottleneck.** For any realistic project size,
  the wall-clock is process-startup-bound. If throughput becomes an issue,
  pass many files in a single invocation instead of one file per process.
- **Memory is bounded by Bun, not PromptLang.** A 50 MB compile-time
  footprint is comfortably within CI runner limits.
- **Zero external dependencies means zero supply-chain risk.** The whole
  toolchain reviews in an afternoon.
