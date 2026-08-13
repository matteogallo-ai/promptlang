# YAML support in `promptlang.yaml`

PromptLang ships a **minimal, zero-dependency YAML parser**. It intentionally
supports only the subset required for `promptlang.yaml`. This keeps the
compiler dependency-free and makes error reporting simple and predictable.

If you need a YAML feature not listed here, please open an issue explaining
the use case — we would rather add the specific feature than pull in a
full YAML library.

---

## Supported

### Mappings (key/value)

Two-space indentation, arbitrary nesting depth:

```yaml
defaults:
  model: claude-opus-4.7
  temperature: 0.3
  linter:
    ai:
      enabled: false
```

### Sequences

```yaml
sources:
  - path: ./prompts
  - path: ./shared-prompts
```

### Sequences of mappings

Each `- key: value` starts a new mapping element. Subsequent keys of the same
element align at `indent + 2`:

```yaml
dependencies:
  - name: pkg-a
    version: ^1.0.0
    path: ./vendor/pkg-a
  - name: pkg-b
    version: ^2.3.0
    path: ./vendor/pkg-b
```

### Scalars

| Kind | Examples |
|------|----------|
| Unquoted string | `claude-opus-4.7`, `./generated`, `^1.2.0` |
| Double-quoted string | `"hello"`, `"line1\nline2"`, `"a\"b"` |
| Single-quoted string | `'x'`, `'it''s ok'` (double `''` = literal `'`) |
| Integer | `42`, `-7`, `0` |
| Float | `3.14`, `-0.5`, `1.5e2` |
| Boolean | `true`, `false`, `True`, `False`, `TRUE`, `FALSE` |
| Null | `~`, `null`, `Null`, `NULL`, or omitted value |

### Comments

`#` starts a comment when at the beginning of a line or preceded by
whitespace. `#` inside quoted strings is preserved as-is.

```yaml
# full-line comment
name: my-project  # inline comment
note: "keep # this literal"
```

### Escape sequences (double-quoted strings only)

`\n`, `\t`, `\r`, `\"`, `\\`, `\/`, `\0`

---

## Not supported

Each of these constructs raises `ConfigParseError` with the offending line
number:

| Feature | Example that will fail |
|---------|------------------------|
| Anchors | `x: &anchor 1` |
| Aliases | `y: *anchor` |
| Block scalars — literal | `x: \|\n  hello` |
| Block scalars — folded | `x: >\n  hello` |
| Explicit type tags | `port: !!int "8080"` |
| Custom tags | `x: !myTag foo` |
| Flow mappings | `x: {a: 1, b: 2}` |
| Flow sequences | `x: [1, 2, 3]` |
| Tabs for indentation | `\t- item` |
| Non-2-space indentation | `   nested: 1` (3 spaces) |

---

## Error messages

Every parse error includes the line number where the problem was detected.
For example:

```
Malformed mapping line — expected 'key: value' but found 'just text' (line 4)
YAML anchors and aliases (& / *) are not supported (line 7)
Tab characters are not supported for indentation; use spaces (line 12)
```

---

## Why not use `js-yaml`?

PromptLang has a strict zero-dependency policy for its core. A full YAML
parser is ~2000 lines of untrusted code that would ship with every install
of `promptlang`. The minimal parser is ~150 lines of code we can audit,
test, and reason about ourselves. `promptlang.yaml` is a config file, not
a general-purpose data format — the subset is more than sufficient.
