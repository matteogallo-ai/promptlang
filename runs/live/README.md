# Live runs

Artifacts of real provider calls, committed whatever their outcome
(`docs/ENGINEERING_STANDARDS.md`). `scripts/ai-linter-live-run.ts` writes
`ai-linter-<UTC timestamp>.json` here.

| File | Written by |
| ---- | ---------- |
| `ai-linter-<UTC timestamp>.json` | `scripts/ai-linter-live-run.ts`: one pass over the examples |
| `linter-eval-<UTC timestamp>.json` | `scripts/linter-eval.ts`: precision and recall on `evals/linter/` |

Every file is listed with its SHA-256 in `SHA256SUMS`; `scripts/linter-eval.ts`
appends its own line. `tests/live-artefacts.test.ts` fails if a file here is
unlisted or no longer matches its hash, so a committed result cannot be edited
in place: a new run is a new file.
