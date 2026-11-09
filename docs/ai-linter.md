# AI linter

PromptLang can send each prompt to an LLM for a semantic review at build time.
It looks for six kinds of defect that static rules cannot see:

- Vague instructions like "be careful" that don't tell the model what to do
- Missing format specs where structured output is expected but not constrained
- Conflicting instructions ("one-sentence summary" + "detailed key points")
- Undefined business terms ("premium user" without a definition)
- Hallucination risks (invitations to guess vs. refuse)
- Token inefficiencies (verbose phrasing that could be shorter)

**Measured on a labeled corpus** (`evals/linter/`, 120 cases;
[`docs/SYSTEM_CARD.md`](SYSTEM_CARD.md)), on the test split with
`claude-haiku-5-5`: it finds almost every designed defect (recall 44/45 and
45/45 over two runs) but reports about four categories per prompt, so most of
its findings are false alarms (precision 20%, 95% CI 15–26%) and it flags every
clean prompt (15/15). Reporting every category on every prompt would find all 45
defects at 12.5% precision (95% CI 9.5–16.3%), so recall alone says little; the
question is whether the linter's choice beats chance (see "Against chance, on the
same pairs" below: it does, by a wide margin). The labels are set by construction;
a human check of 30 cases (`evals/linter/human-review/`) confirmed 27/30 designed
labels (95% CI 74–97%, kappa 0.80) and suggests that some reports scored as false
alarms may be real defects, so that 20% is a lower bound. A pre-registered human
review of 40 of its findings (`evals/linter/findings-review/`) measured precision
at about 30% (12/40, 95% CI 18–45%): not distinguishable from the 20% bound, and
either way seven to eight findings in ten are wrong. The linter is an aid for the
person reviewing a prompt, not a gate: read its findings as leads to check, not
as defects, and do not fail a build on them; the six static rules of
`promptlang analyze` do not depend on the model.

## Usage

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli analyze docs/examples/ --ai
```

The AI linter runs in parallel (3 prompts at a time by default) and returns
confidence-scored issues alongside the static analysis output.

## Cost

`--ai` prints a cost estimate for your files and asks before any call; `--yes`
approves without asking.

Each analyzed prompt is one request to Claude Haiku 5.5 (by default) with
`max_tokens: 4096`, which leaves room for its adaptive thinking. At list prices
($0.10 / $0.50 per million input / output tokens, prompts up to 100K tokens) the
six example files (seven prompts) cost about $0.015 if every call used its full
`max_tokens`. This is an estimate from request sizes, not a measurement. The
committed live run (five prompts) used 5,557 input and 6,517 output tokens:
$0.0038. Costs are yours — bring your own API key.

## Against chance, on the same pairs

The linter and "report every category" decide the same 360 (case, category)
pairs of the test split. Setting the two precision intervals side by side (15–26%
against 9.5–16.3%) is not a test, and the second figure is only the base rate
(45/360). The question is whether the pairs the linter picks hold more defects
than as many pairs picked at random (`againstReportEverything` in
`scripts/linter-eval-metrics.ts`, recomputed from the committed run by
`tests/linter-eval-metrics.test.ts`).

| Repeat | Defects in the flagged pairs | Expected at random, same number flagged | P(at least as many at random), hypergeometric |
| ------ | ---------------------------- | --------------------------------------- | --------------------------------------------- |
| 1 | 44 of 217 | 27.1 | 6.4e-10 |
| 2 | 45 of 229 | 28.6 | 2.5e-10 |

The pairs of one case are not independent, so these p-values overstate the
evidence; their order of magnitude is what they show. A paired McNemar test
against "report every category" is not reported: its discordant pairs are the
clean pairs the linter leaves unflagged against the defects it misses, so a linter
that flags nothing would win it, 315 to 45.

- **Scope.** The linter's selection carries signal: the pairs it flags hold far
  more defects than as many pairs drawn at random.
- **Known limit.** Specificity: it leaves 142 of the 315 clean pairs unflagged in
  repeat 1 (45%, 95% CI 39.7%–50.6%) and 131 in repeat 2 (42%, 95% CI
  36.3%–47.1%), and it flags every clean prompt (15/15). Most of what it reports
  is still wrong.
- **Next step.** A baseline that isolates what the model adds (the same model
  with a naive instruction, or the six static rules) on the same split, compared
  case by case with a permutation test so that the pairs of one case move
  together. The model baseline is a paid run, not done.

The human review's reading (12/40 "not distinguishable from the 20% bound") is
a one-sample comparison with a fixed value, read as its protocol pre-registered;
it is kept as written.
