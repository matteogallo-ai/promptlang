# Human review of the AI linter's findings: result

Scored as pre-registered in [`PROTOCOL.md`](PROTOCOL.md), on the answers as given
(`review.csv`, one annotator, 40 of 40 answered, no comment recorded). `score.json`
is the output of `bun run scripts/linter-findings-review.ts score`;
`tests/linter-findings-review.test.ts` ("the committed answers score 12/40 …")
recomputes it from the committed answers.

## Headline

**Precision measured by a pre-registered human review: 30% (12/40, Wilson 95% CI
18.1%–45.4%).** The weighted check gives 29.7%.

**Reading, as pre-registered:** the interval does not lie wholly above the
published lower bound of 20.3% (44/217) (`above_scored_lower_bound: false`), so
this review does not tell the linter's precision apart from that bound.

## Against the construction, same 40 findings

| | Result |
| - | ------ |
| Scored right by construction | 8/40 (20%) |
| Scored wrong but supported by the annotator | 4/32 (12.5%, 95% CI 5.0%–28.1%) |
| Scored right but rejected by the annotator | 0/8 (95% CI 0%–32.4%) |

Every finding the construction scored right was confirmed; the gap between 20%
and 30% is four findings of categories nobody designed in that the annotator
judged real.

## Per category (descriptive only, 3 to 9 findings each)

| Category | Supported |
| -------- | --------- |
| VAGUE_INSTRUCTIONS | 2/9 |
| MISSING_FORMAT_SPEC | 1/4 |
| CONFLICTING_INSTRUCTIONS | 4/7 |
| UNDEFINED_TERMS | 2/8 |
| POTENTIAL_HALLUCINATION_RISK | 2/9 |
| TOKEN_INEFFICIENCY | 1/3 |

## What it means for the product

About seven findings in ten are wrong, whichever figure is used. The linter is
an aid for a person reviewing a prompt, who reads each finding and decides; it is
not a gate. Its findings are warnings or info, never errors, so `analyze --ai`
exits 1 on them only under `--strict`, which turns every warning into a failure;
do not run `--ai` with `--strict` in CI. The limits
of this measure (one annotator, 40 findings on 31 prompts, no control items) are
in `PROTOCOL.md`.
