# Surviving mutants

Every mutant that survives `bun run mutation` is listed here with the reason no
test can kill it. Positions are `file:line:column` as Stryker reports them; the
same list is printed at the end of `bun run mutation`. A survivor missing from this
file, or a reason that no longer holds after a code change, means a test is missing.

## Score before and after

Measured with the same Stryker configuration (`stryker.config.json`).

| File | Before % | After % |
| ---- | -------: | ------: |
| `src/lexer/errors.ts` | 50.00 | 100.00 |
| `src/lexer/lexer.ts` | 85.25 | 97.69 |
| `src/parser/errors.ts` | 50.00 | 100.00 |
| `src/parser/parser.ts` | 73.00 | 95.83 |
| `src/semver/check.ts` | 84.72 | 91.20 |
| `src/semver/interface.ts` | 90.48 | 99.34 |
| `src/semver/semver.ts` | 85.57 | 95.19 |
| **total** | **81.44** | **96.19** |

"Before" is the test suite of `main` at the start of this work (1 918 mutants:
1 503 killed, 59 timeout, 356 survived). The tests added since are the property
tests (`*.property.test.ts`), the error tables (`lexer.errors.test.ts`,
`parser.errors.test.ts`) and boundary cases in the existing test files, each
written against a mutant that had survived. "After" is the run recorded in
[README.md](README.md), on commit a168201 (1 942 mutants: 1 808 killed, 60 timeout,
74 survived). That run took 11 min 30 s on an 8-core laptop, which is why pull
requests run only a dry run. The first "after" run, on f4f7306 (2026-11-03), scored
96.13% on 1 914 mutants (1 780 killed, 60 timeout, 74 survived); since then
`src/semver/interface.ts` gained 29 mutants and `src/lexer/lexer.ts` lost one.

Under that load a mutant is occasionally reported killed because an unrelated
test went over its time limit: 211:47 below was killed in one run and survived
the next. The reasons below are about the code, so they hold whichever way such
a mutant lands.

## Equivalent mutants

An equivalent mutant changes the code without changing any observable behavior,
so no test can tell it apart from the original.

### `src/lexer/lexer.ts`

| Position | Mutator | Why it survives |
| -------- | ------- | --------------- |
| 125:9, 125:32 | ConditionalExpression, StringLiteral | `peek()` at the end returns `"\0"`; without the guard it returns `undefined`, and with `""` it returns the empty string. Every caller compares the result with a specific printable character or a character class, which none of the three values belongs to, and a real NUL in the source is rejected as an unexpected character before any of these comparisons matter. |
| 131:9 (×3), 131:56 | ConditionalExpression, EqualityOperator, ArithmeticOperator, StringLiteral | The same argument for `peekNext()`: past the end, `this.source[i]` is `undefined`, which matches no character a caller looks for. `>` instead of `>=` only changes the case `i === length`, where the read is already `undefined`. |
| 141:9 (×2), 141:43 | ConditionalExpression, EqualityOperator, StringLiteral | The same argument for `peekAt()`. |
| 150:9 | ConditionalExpression | `match()` without the end check compares `undefined` with the expected character, which is false, as the guard returns. |

### `src/parser/parser.ts`

| Position | Mutator | Why it survives |
| -------- | ------- | --------------- |
| 84:12 (×2), 84:71 | ConditionalExpression, EqualityOperator, ArithmeticOperator | The fallback to the last token is unreachable: every `peekAhead` call is made while the current token is not EOF and looks one token ahead, and the token list always ends with EOF, so `idx` stays inside the list. |
| 99:9 | ConditionalExpression | No caller advances while the current token is EOF: each `advance()` follows a `check` or `match` of a non-EOF type, so the guard never stops an increment. |
| 171:7 | ConditionalExpression | Removing `default: return false` makes the function return `undefined`, which every caller uses only as a falsy condition. |
| 266:11 | ConditionalExpression | `parseRange` throws only `RangeError`; the re-throw of any other error is a guard against a bug in `parseRange`, which no input can trigger. |
| 393:7, 394:31 | ConditionalExpression, StringLiteral | `parseMetadata` is only called when the current token is one of the metadata directives handled by the `case`s above, so the `default` branch is unreachable. |
| 211:47, 443:45, 524:45, 545:47, 592:47, 708:46, 897:45, 944:47, 1015:45 | StringLiteral | The message of an `expect()` on a keyword the caller has just dispatched on (`import`, `type`, `enum`, `struct`, `prompt`, `chain`, `test`, `expect`, `eval`): that `expect` cannot fail, so its message is never shown. |
| 777:34, 780:34, 1062:34, 1065:34 | StringLiteral | The same for `parseStringLit` / `parseNumberLit` called right after a `check` of `STRING` or `NUMBER`. |
| 819:49, 820:35, 869:46, 870:32 | StringLiteral | `parseCall` and `parseMemberAccess` are only entered after a lookahead of `IDENT (` and `IDENT .`, so these `expect`s cannot fail. |
| 973:47, 973:54, 973:65 | ConditionalExpression, StringLiteral | For the `equals` form the current token has just been checked to be `:`, so this `expect` can only fail for `contains` and `matches`, and the message built for `equals` is never shown. |
| 991:13 | ConditionalExpression | `new RegExp` throws only `SyntaxError`; the re-throw is a guard, as at 266. |

### `src/semver/check.ts`

| Position | Mutator | Why it survives |
| -------- | ------- | --------------- |
| 45:7 (×2) | ConditionalExpression, EqualityOperator | Making the pre-release test always true only matters when `base` is a release with the same `MAJOR.MINOR.PATCH` as a strictly greater `cur`. No such `cur` exists: a pre-release of that triplet is lower, and build metadata alone compares equal. |
| 47:7 (×4), 47:65 | ConditionalExpression, EqualityOperator, ArrayDeclaration | Whether the pre-release of `base` is stripped, kept, or replaced does not matter: the rest of `bumpOf` reads only `major`, `minor` and `patch`. |
| 49:7, 49:22 | ConditionalExpression, StringLiteral | `order` is undefined only if both triplets are equal, a case already returned at line 45 (pre-release base) or impossible (release base, see 45). |
| 50:7 | ConditionalExpression | Stryker mutates the left operand: `true && cur.major === 0`. Since `cur > base`, `cur.major === 0` implies `base.major === 0`. |
| 51:9 (×2), 51:29 | LogicalOperator, ConditionalExpression | With major 0 and `cur > base`, `cur.minor === 0` implies `base.minor === 0`; and when only `base.minor` is 0, the bump is to the minor, for which both branches answer `"major"`. |
| 74:16, 75:15 | ConditionalExpression | `parseVersion(null)` returns `null` (the regular expression does not match `"null"`), as the `=== null` shortcut does. |
| 90:8, 90:19 | ConditionalExpression, StringLiteral | Here `required` is not `"none"`, so its rank is at least 1, while the rank of `"none"` is 0: the comparison already excludes `actual === "none"`. |
| 98:74 | ArrayDeclaration | `nextVersion` reads only `major`, `minor` and `patch`. |
| 154:9 | ConditionalExpression | `parse(tokenize(text))` throws only `LexerError` or `ParserError`; the re-throw of anything else is a guard against a bug in the parser. |

### `src/semver/interface.ts`

| Position | Mutator | Why it survives |
| -------- | ------- | --------------- |
| 29:32 | EqualityOperator | With `>=`, a change of the same level replaces `best` with an equal value. |
| 185:12 | ConditionalExpression | With `false`, a type's change carries `declaration: undefined` instead of no `declaration` key; `formatChange` prints nothing for either, and the JSON output drops an undefined value. |

### `src/semver/semver.ts`

| Position | Mutator | Why it survives |
| -------- | ------- | --------------- |
| 26:50 | StringLiteral | Without a pre-release the fallback string is only split and filtered for numeric identifiers; a non-numeric fallback is filtered out as `""` is. |
| 44:7 | ConditionalExpression | Stryker mutates the left operand: `true && typeof b === "number"`. When `a` is a string and `b` a number, `Math.sign(NaN)` is `NaN`, which `compareParsed` maps to 1, the value the original returns for that case. |
| 53:35 | EqualityOperator | `<=` after `a[key] !== b[key]` is `<`. |
| 66:25 | EqualityOperator | `c <= 0` after `c !== 0` is `c < 0`. |
| 89:14 (×2) | Regex | Dropping `^` or `$` from `PART`: the optional operator and `(.+)` already make the leftmost match start at 0 and run to the end of a part, which holds no whitespace. |
| 97:17, 97:35 | MethodExpression, Regex | Without `trim()` or with `\s` instead of `\s+`, the split yields extra empty parts, which `filter(Boolean)` removes. |
| 120:40 | ArrayDeclaration | Every caller of `release()` that keeps the default pre-release overrides it (`caret` spreads `prerelease: [0]`); `tilde` passes `[0]`. |
| 122:52 | ArrayDeclaration | Build metadata takes no part in precedence. |
| 136:49, 144:58 | ArrayDeclaration | The `-0` upper bound of `^` and `~` only differs from a plain release bound on pre-releases of the next version, which the pre-release opt-in rule (line 178) rejects anyway because no comparator names that triplet as a pre-release. |
| 178:9, 178:88 | ConditionalExpression, StringLiteral | Dropping the exclusion of the internal `<X-0` bound altogether (the condition made false, or `"<"` replaced by `""`) changes nothing: `X-0` is the lowest pre-release of `X`, so no pre-release of `X` satisfies `<X-0`, and the `every()` check above has already returned false. The narrower mutants of this condition are killed by `semver.test.ts` ("only the internal <X-0 bound of ^ and ~ is denied the pre-release opt-in"). |
