# Runbook

The five most likely failures of a paid run (`test --live`, `analyze --ai`,
`scripts/linter-eval.ts --yes`): symptom, detection, response. Exit codes of `promptlang test`:
0 every test passed; 1 an assertion failed or a file did not compile; 2 usage
(bad flag, no key, no approval); 3 at least one test has no verdict because the
call failed. A line marked `ERROR` names the class of the failure; a test is
never reported `FAIL` because the provider failed
(`src/cli/commands/test.test.ts` "provider down: exit 3 and an ERROR line, never a
FAIL verdict").

## 1. Provider down, timeout or rate limit

*Detection:* exit 3 with `providerError.kind: "provider"` in `--json`; for `analyze --ai`, `ai:request-failure` in `ai_issues`.

*Symptom:* exit 3; `ERROR … provider failure, no verdict (retry later):
ServerError | TimeoutError | NetworkError | RateLimitError …`. With
`analyze --ai`: `ai:request-failure` warnings; the static results are complete.

*Why it is safe:* paid runs make one attempt, so a failed call is not billed
twice (`src/cli/live.test.ts` "makes exactly one attempt, so a retryable error is
not billed again"); a request times out after 60 s.

*Response:* check <https://status.anthropic.com>; rerun later. Nothing to change
in the files. `analyze --ai` exits 0 on request failures unless `--strict`, so a
CI step that must have AI results should use `--strict` or read `ai_issues`
from `--json`.

## 2. Key missing, rejected or without access to the model

*Detection:* exit 2 before any call, or exit 3 with `providerError.kind: "configuration"` in `--json`.

*Symptom:* missing key: exit 2, `--live needs ANTHROPIC_API_KEY in the
environment`, nothing called (`src/cli/live.test.ts` "refuses to start without
ANTHROPIC_API_KEY, naming the flag"). Rejected key, unknown model, malformed
request: exit 3, `configuration error, no verdict (fix the file or the key)`
(`src/cli/commands/test.test.ts` "a rejected request: exit 3, reported as a
configuration error, not an outage").

*Response:* do not retry: the same call fails the same way. Check the key in the
console, the `model:` of the prompt against `src/testing/cost.ts`, and
`anthropic_version`. Error messages never contain the key, so a CI log can be
shared (`src/runtime/providers/secrets.test.ts` "the API key never appears in an
error message").

## 3. Spending cap reached

*Detection:* exit 3, `providerError.kind: "configuration"`, message starting `BudgetExceededError`.

*Symptom:* exit 3, `configuration error … BudgetExceededError`: the next call's
worst case would take the spend past the approved estimate, so it was not sent
(`src/cli/commands/test.test.ts` "a call that overspends stops the next test:
exit 3, a configuration error, nothing sent").

*Why it happens:* the estimate assumes each call's input is its rendered text
÷ 3 characters per token; a provider that counts more tokens than that spends
more than estimated, and the cap stops the run before the overrun.

*Response:* read the usage reported by `--json`; do not raise a cap to make a run
pass without a new estimate and a new approval.

## 4. Malformed model output

*Detection:* exit 1 with the failed assertion; `ai:parse-failure` in `ai_issues`.

*Symptom:* `promptlang test`: `FAIL` with the generated code's validation error
(`src/testing/runner.test.ts` "the generated code's own validation is the
verdict when it throws"). AI linter: an `ai:parse-failure` warning for the prompt
(`src/analyzer/ai/issue-parser.test.ts` "returns parse-failure issue on
malformed JSON"); the eval script records that case as no verdict, not as a
clean result.

*Response:* this is a result, not an outage: the prompt or its declared return
type does not hold for that model. Fix the prompt or the type; rerunning only
measures how often it happens.

## 5. Integrity check fails after an install

*Detection:* `promptlang check` exits 1; run it in CI after `install`.

*Symptom:* `promptlang check` prints `failed integrity check` and exits 1: an
installed `.prompt` file differs from the SHA-256 recorded at install
(`src/registry/integrity.test.ts` "verifyIntegrity flags a file whose contents
changed after recording", "verifyIntegrity flags a file that has been deleted").

*Response:* treat it as a change you did not make. `git diff` the file; if the
change is wanted, reinstall to record the new hash; otherwise restore it.

## Also: the release workflow fails

Publishing is the maintainer's: `docs/RELEASING.md` describes each step of
`release.yml` and what it needs.
