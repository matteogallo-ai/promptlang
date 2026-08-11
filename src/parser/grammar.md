# PromptLang v0.3 Grammar Reference (EBNF)

This document is the authoritative EBNF grammar for PromptLang v0.3.
The parser (`parser.ts`) implements a hand-written recursive descent parser
that follows these rules exactly. One parse function per non-terminal.

---

## Notation

```
::=     definition
|       alternative
?       zero or one
*       zero or more
+       one or more
( )     grouping
" "     terminal (literal keyword or symbol)
UPPER   terminal token type produced by the lexer
```

---

## Top-Level

```ebnf
Program        ::= Metadata* Declaration*

Metadata       ::= AT_VERSION   StringLit
                 | AT_MODEL     IDENT          -- model names may contain hyphens/dots
                 | AT_TEMPERATURE NumberLit
                 | AT_MAX_TOKENS  NumberLit
                 | AT_BREAKING_CHANGES StringLit
                 | AT_MIGRATION_FROM   StringLit StringLit
                 | AT_DESCRIPTION StringLit

Declaration    ::= TypeDeclaration
                 | PromptDeclaration
                 | ChainDeclaration
                 | TestDeclaration
                 | EvalDeclaration
```

---

## Types

```ebnf
TypeDeclaration
               ::= "type" IDENT "=" TypeExpression

TypeExpression ::= EnumType
                 | StructType
                 | PrimitiveType
                 | TypeReference

PrimitiveType  ::= "string" | "number" | "boolean" | "date"

TypeReference  ::= IDENT          -- reference to a named type

EnumType       ::= "enum" "{" IdentifierList "}"
IdentifierList ::= IDENT ("," IDENT)* ","?

StructType     ::= "struct" "{" FieldList "}"
FieldList      ::= Field ("," Field)* ","?
Field          ::= IDENT "?"? ":" TypeExpression
                   -- "?" marks the field as optional (e.g. `invoice_number?: string`)
```

---

## Prompts

```ebnf
PromptDeclaration
               ::= "prompt" IDENT "(" ParameterList? ")" "->" TypeExpression "{"
                     PromptSection+
                   "}"

ParameterList  ::= Parameter ("," Parameter)*
Parameter      ::= IDENT ":" TypeExpression

PromptSection  ::= ("system" | "user" | "assistant") ":" StringLit   -- MessageSection
                 | "output" ":" TypeExpression                         -- OutputSection
```

---

## Chains

```ebnf
ChainDeclaration
               ::= "chain" IDENT "(" ParameterList? ")" "->" TypeExpression "{"
                     ChainStep+
                     "return" Expression
                   "}"

ChainStep      ::= "step" IDENT "=" Expression
```

---

## Expressions

```ebnf
Expression     ::= IDENT "(" ArgumentList? ")"   -- CallExpression
                 | IDENT "." IDENT                -- MemberExpression
                 | IDENT                          -- Identifier (variable reference)
                 | Literal                        -- literal value passed as argument

ArgumentList   ::= CallArgument ("," CallArgument)*
CallArgument   ::= IDENT ":" Expression           -- NamedArgument (key: value)
                 | Expression                     -- positional

Literal        ::= StringLit | NumberLit | "true" | "false"

StringLit      ::= STRING | TRIPLE_STRING | TEMPLATE_STRING
NumberLit      ::= NUMBER
```

Disambiguation rule: when parsing `Expression`, lookahead determines the variant:
- `IDENT LPAREN` → CallExpression
- `IDENT DOT IDENT` → MemberExpression
- `IDENT` alone → Identifier
- `STRING | TRIPLE_STRING | TEMPLATE_STRING | NUMBER | TRUE | FALSE` → Literal

Within an `ArgumentList`, `IDENT COLON` unambiguously signals a NamedArgument
because `COLON` cannot follow a bare expression in any other production.

---

## Tests

```ebnf
TestDeclaration
               ::= "test" StringLit "{"
                     "input" ":" Expression
                     Expectation+
                   "}"

Expectation    ::= "expect" ":" Literal                    -- bare expect
                 | "expect" "." IDENT ":" Literal          -- field-path expect
```

---

## Evals

```ebnf
EvalDeclaration
               ::= "eval" StringLit "{"
                     "dataset"   ":" StringLit
                     "prompt"    ":" IDENT
                     "metric"    ":" IDENT
                     "threshold" ":" NumberLit
                   "}"
```

---

## Token Reference

The lexer converts these source words to keyword token types:

| Source text      | TokenType         |
|------------------|-------------------|
| `prompt`         | PROMPT            |
| `type`           | TYPE              |
| `chain`          | CHAIN             |
| `test`           | TEST              |
| `eval`           | EVAL              |
| `step`           | STEP              |
| `return`         | RETURN            |
| `enum`           | ENUM              |
| `struct`         | STRUCT            |
| `string`         | STRING_TYPE       |
| `number`         | NUMBER_TYPE       |
| `boolean`        | BOOLEAN_TYPE      |
| `date`           | DATE_TYPE         |
| `system`         | SYSTEM            |
| `user`           | USER              |
| `assistant`      | ASSISTANT         |
| `output`         | OUTPUT            |
| `input`          | INPUT             |
| `expect`         | EXPECT            |
| `dataset`        | DATASET           |
| `metric`         | METRIC            |
| `threshold`      | THRESHOLD         |
| `true`           | TRUE              |
| `false`          | FALSE             |
| `@version`       | AT_VERSION        |
| `@model`         | AT_MODEL          |
| `@temperature`   | AT_TEMPERATURE    |
| `@max_tokens`    | AT_MAX_TOKENS     |
| `@breaking_changes` | AT_BREAKING_CHANGES |
| `@migration_from`   | AT_MIGRATION_FROM   |
| `@description`   | AT_DESCRIPTION    |

The parser must accept keyword tokens in positions where identifiers are
grammatically expected (e.g., `prompt` inside an `eval` body, field names
that happen to be keywords, etc.).
