import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { propertyParams } from "../../tests/support/property";
import type {
  CallArgument,
  Declaration,
  Expression,
  Metadata,
  Parameter,
  Program,
  StringLiteral,
  TypeExpression,
} from "../ast/nodes";
import { LexerError } from "../lexer/errors";
import { tokenize } from "../lexer/lexer";
import { ParserError } from "./errors";
import { parse } from "./parser";

/**
 * The printer in src/ast/ renders a debug tree, not source, so the round-trip
 * runs the other way: a generated AST (positions omitted) is rendered to
 * source by `render*` below, parsed, and must come back equal.
 */

type NoPos<T> = T extends readonly (infer U)[]
  ? NoPos<U>[]
  : T extends object
    ? { [K in keyof T as K extends "line" | "column" ? never : K]: NoPos<T[K]> }
    : T;

const RESERVED = new Set([
  ..."prompt type chain test eval step return enum struct import as string number boolean date".split(
    " "
  ),
  ..."system user assistant output input expect dataset metric threshold true false".split(" "),
  // Contextual words: an identifier spelled like one changes the parse where it is read.
  ..."requires mock contains matches schema".split(" "),
]);

/** Keywords the parser accepts as a field, parameter, enum member, property or argument name. */
const NAME_KEYWORDS = [
  ..."prompt type chain test eval step return enum struct string number boolean date".split(" "),
  ..."system user assistant output input expect dataset metric threshold".split(" "),
];

const ident = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,7}$/).filter((s) => !RESERVED.has(s));
const anyName = fc.oneof(ident, fc.constantFrom(...NAME_KEYWORDS));

const number = fc
  .tuple(fc.nat(99_999), fc.option(fc.stringMatching(/^\d{1,3}$/)))
  .map(([i, f]) => Number.parseFloat(f === null ? `${i}` : `${i}.${f}`));

/** Content with characters that need escaping; `{{` would make it a template. */
const plainText = fc
  .string({ unit: fc.constantFrom(..."ab Z9#{}'\"\\\n\t\r"), maxLength: 12 })
  .filter((s) => !s.includes("{{"));

const stringLit: fc.Arbitrary<NoPos<StringLiteral>> = fc.oneof(
  plainText.map((value) => ({ kind: "StringLiteral" as const, value, isTemplate: false })),
  fc.tuple(fc.stringMatching(/^[a-z \n"]{0,6}$/), ident).map(([text, name]) => ({
    kind: "StringLiteral" as const,
    value: `${text}{{${name}}}`,
    isTemplate: true,
  }))
);

const simpleType = fc.oneof(
  fc.constantFrom("string", "number", "boolean", "date").map((name) => ({
    kind: "PrimitiveType" as const,
    name,
  })),
  ident.map((name) => ({ kind: "TypeReference" as const, name })),
  fc.array(anyName, { maxLength: 4 }).map((values) => ({ kind: "EnumType" as const, values }))
);
const field = fc.record({
  kind: fc.constant("Field" as const),
  name: anyName,
  optional: fc.boolean(),
  type: simpleType,
});
const typeExpr: fc.Arbitrary<NoPos<TypeExpression>> = fc.oneof(
  simpleType,
  fc.array(field, { maxLength: 3 }).map((fields) => ({ kind: "StructType" as const, fields }))
);

const literal = fc.oneof(
  stringLit,
  number.map((value) => ({ kind: "NumberLiteral" as const, value })),
  fc.boolean().map((value) => ({ kind: "BooleanLiteral" as const, value }))
);
const identifier = ident.map((name) => ({ kind: "Identifier" as const, name }));

const { expr } = fc.letrec<{ expr: NoPos<Expression>; arg: NoPos<CallArgument> }>((tie) => ({
  expr: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    identifier,
    literal,
    fc.record({ kind: fc.constant("MemberExpression" as const), object: ident, property: anyName }),
    fc.record({
      kind: fc.constant("CallExpression" as const),
      callee: ident,
      arguments: fc.array(tie("arg"), { maxLength: 3 }),
    })
  ),
  arg: fc.oneof(
    tie("expr"),
    fc.record({ kind: fc.constant("NamedArgument" as const), name: anyName, value: tie("expr") })
  ),
}));

const parameters: fc.Arbitrary<NoPos<Parameter>[]> = fc.array(
  fc.record(
    {
      kind: fc.constant("Parameter" as const),
      name: anyName,
      type: typeExpr,
      optional: fc.constant(true as const),
    },
    { requiredKeys: ["kind", "name", "type"] }
  ),
  { maxLength: 3 }
);

const version = fc
  .tuple(fc.nat(20), fc.nat(20), fc.nat(20), fc.option(fc.constantFrom("rc.1", "beta", "0")))
  .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre === null ? "" : `-${pre}`}`);

const importDecl = fc.record(
  {
    kind: fc.constant("ImportDeclaration" as const),
    path: fc.stringMatching(/^[a-z/]{1,10}\.prompt$/),
    alias: ident,
    versionRange: fc
      .tuple(fc.constantFrom("", "^", "~", ">=", "<", "="), version)
      .map(([op, v]) => op + v),
  },
  { requiredKeys: ["kind", "path", "alias"] }
);

const metadata: fc.Arbitrary<NoPos<Metadata>> = fc.oneof(
  version.map((value) => ({ kind: "VersionMetadata" as const, value })),
  fc
    .tuple(
      ident,
      fc.array(fc.stringMatching(/^[a-z0-9]{1,4}$/), { maxLength: 2 }),
      fc.option(fc.nat(9))
    )
    .map(([head, parts, minor]) => ({
      kind: "ModelMetadata" as const,
      value: [head, ...parts].join("-") + (minor === null ? "" : `.${minor}`),
    })),
  number.map((value) => ({ kind: "TemperatureMetadata" as const, value })),
  number.map((value) => ({ kind: "MaxTokensMetadata" as const, value })),
  stringLit.map(({ value }) => ({ kind: "BreakingChangesMetadata" as const, value })),
  fc
    .tuple(stringLit, stringLit)
    .map(([a, b]) => ({ kind: "MigrationFromMetadata" as const, from: a.value, to: b.value })),
  stringLit.map(({ value }) => ({ kind: "DescriptionMetadata" as const, value }))
);

const section = fc.oneof(
  fc.record({
    kind: fc.constant("MessageSection" as const),
    role: fc.constantFrom("system" as const, "user" as const, "assistant" as const),
    content: stringLit,
  }),
  fc.record({ kind: fc.constant("OutputSection" as const), type: typeExpr })
);

const path = fc.option(anyName).map((f) => (f === null ? ["expect"] : ["expect", f]));
const regexSafe = fc
  .stringMatching(/^[a-z0-9 ]{0,8}$/)
  .map((value) => ({ kind: "StringLiteral" as const, value, isTemplate: false }));
const expectation = fc.oneof(
  fc.record({ op: fc.constant("equals" as const), value: fc.oneof(literal, identifier) }),
  fc.record({ op: fc.constant("contains" as const), value: stringLit }),
  fc.record({ op: fc.constant("matches" as const), value: regexSafe })
);

const declaration: fc.Arbitrary<NoPos<Declaration>> = fc.oneof(
  fc.record({ kind: fc.constant("TypeDeclaration" as const), name: ident, definition: typeExpr }),
  fc.record({
    kind: fc.constant("PromptDeclaration" as const),
    name: ident,
    parameters,
    returnType: typeExpr,
    sections: fc.array(section, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant("ChainDeclaration" as const),
    name: ident,
    parameters,
    returnType: typeExpr,
    steps: fc.array(
      fc.record({ kind: fc.constant("ChainStep" as const), name: ident, expression: expr }),
      { minLength: 1, maxLength: 3 }
    ),
    returnExpression: expr,
  }),
  fc
    .record(
      {
        kind: fc.constant("TestDeclaration" as const),
        description: stringLit.map((s) => s.value),
        input: expr,
        mock: stringLit,
        expectations: fc.array(
          fc
            .tuple(path, expectation)
            .map(([p, x]) => ({ kind: "Expectation" as const, path: p, ...x })),
          { maxLength: 3 }
        ),
        expectsSchema: fc.constant(true as const),
      },
      { requiredKeys: ["kind", "description", "input", "expectations"] }
    )
    .filter((t) => t.expectations.length > 0 || t.expectsSchema === true),
  fc.record({
    kind: fc.constant("EvalDeclaration" as const),
    description: stringLit.map((s) => s.value),
    dataset: stringLit.map((s) => s.value),
    promptName: ident,
    metric: ident,
    threshold: number,
  })
);

const program: fc.Arbitrary<NoPos<Program>> = fc.record({
  kind: fc.constant("Program" as const),
  imports: fc.array(importDecl, { maxLength: 2 }),
  metadata: fc.array(metadata, { maxLength: 3 }),
  declarations: fc.array(declaration, { maxLength: 4 }),
});

// ---------------------------------------------------------------------------
// Rendering a generated AST to source tokens
// ---------------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

/**
 * Exercises both literal forms: triple-quoted strings keep their content raw, so
 * they are used whenever the value holds no `"`; escapes are not processed inside
 * `{{...}}`, which generated templates never need.
 */
function str(value: string): string {
  if (!value.includes('"')) return `"""${value}"""`;
  return `"${value.replace(/[\\"\n\t\r]/g, (c) => ESCAPES[c]!)}"`;
}

function list<T>(items: T[], render: (item: T) => string[]): string[] {
  return items.flatMap((item, i) => [...(i === 0 ? [] : [","]), ...render(item)]);
}

function type(t: NoPos<TypeExpression>): string[] {
  switch (t.kind) {
    case "PrimitiveType":
    case "TypeReference":
      return [t.name];
    case "EnumType":
      return ["enum", "{", ...list(t.values, (v) => [v]), "}"];
    case "StructType":
      return [
        "struct",
        "{",
        ...list(t.fields, (f) => [f.name, ...(f.optional ? ["?"] : []), ":", ...type(f.type)]),
        "}",
      ];
  }
}

function expression(e: NoPos<CallArgument>): string[] {
  switch (e.kind) {
    case "Identifier":
      return [e.name];
    case "StringLiteral":
      return [str(e.value)];
    case "NumberLiteral":
    case "BooleanLiteral":
      return [String(e.value)];
    case "MemberExpression":
      return [e.object, ".", e.property];
    case "NamedArgument":
      return [e.name, ":", ...expression(e.value)];
    case "CallExpression":
      return [e.callee, "(", ...list(e.arguments, expression), ")"];
  }
}

function signature(name: string, ps: NoPos<Parameter>[], returns: NoPos<TypeExpression>): string[] {
  const params = list(ps, (p) => [p.name, ...(p.optional ? ["?"] : []), ":", ...type(p.type)]);
  return [name, "(", ...params, ")", "->", ...type(returns), "{"];
}

function metadataTokens(m: NoPos<Metadata>): string[] {
  switch (m.kind) {
    case "VersionMetadata":
      return ["@version", `"${m.value}"`];
    case "ModelMetadata":
      return ["@model", m.value];
    case "TemperatureMetadata":
      return ["@temperature", String(m.value)];
    case "MaxTokensMetadata":
      return ["@max_tokens", String(m.value)];
    case "BreakingChangesMetadata":
      return ["@breaking_changes", str(m.value)];
    case "MigrationFromMetadata":
      return ["@migration_from", str(m.from), str(m.to)];
    case "DescriptionMetadata":
      return ["@description", str(m.value)];
  }
}

function declarationTokens(d: NoPos<Declaration>): string[] {
  switch (d.kind) {
    case "TypeDeclaration":
      return ["type", d.name, "=", ...type(d.definition)];
    case "PromptDeclaration":
      return [
        "prompt",
        ...signature(d.name, d.parameters, d.returnType),
        ...d.sections.flatMap((s) =>
          s.kind === "MessageSection"
            ? [s.role, ":", str(s.content.value)]
            : ["output", ":", ...type(s.type)]
        ),
        "}",
      ];
    case "ChainDeclaration":
      return [
        "chain",
        ...signature(d.name, d.parameters, d.returnType),
        ...d.steps.flatMap((s) => ["step", s.name, "=", ...expression(s.expression)]),
        "return",
        ...expression(d.returnExpression),
        "}",
      ];
    case "TestDeclaration":
      return [
        "test",
        str(d.description),
        "{",
        "input",
        ":",
        ...expression(d.input),
        ...(d.mock ? ["mock", ":", str(d.mock.value)] : []),
        ...d.expectations.flatMap((x) => [
          "expect",
          ...(x.path.length > 1 ? [".", x.path[1]!] : []),
          ...(x.op === "equals" ? [] : [x.op]),
          ":",
          ...expression(x.value),
        ]),
        ...(d.expectsSchema ? ["expect", "schema"] : []),
        "}",
      ];
    case "EvalDeclaration":
      return [
        ...["eval", str(d.description), "{", "dataset", ":", str(d.dataset)],
        ...[
          "prompt",
          ":",
          d.promptName,
          "metric",
          ":",
          d.metric,
          "threshold",
          ":",
          String(d.threshold),
          "}",
        ],
      ];
  }
}

function programTokens(p: NoPos<Program>): string[] {
  return [
    ...p.imports.flatMap((i) => [
      ...["import", `"${i.path}"`, "as", i.alias],
      ...(i.versionRange === undefined ? [] : ["requires", `"${i.versionRange}"`]),
    ]),
    ...p.metadata.flatMap(metadataTokens),
    ...p.declarations.flatMap(declarationTokens),
  ];
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => k !== "line" && k !== "column")
      .map(([k, v]) => [k, strip(v)])
  );
}

/** Whitespace and comments the grammar must ignore between any two tokens. */
const separators = fc.array(
  fc.constantFrom(" ", "\n", "\t ", " // note\n", " /* c */ ", "\r\n  "),
  {
    minLength: 1,
    maxLength: 8,
  }
);

/** Token texts in grammar-relevant shapes, so fuzzed input gets past the lexer. */
const TOKEN_SOUP = [
  ..."( ) { } [ ] : , . -> = | ? @version @model @temperature @max_tokens @breaking_changes".split(
    " "
  ),
  ..."@migration_from @description import as requires mock contains matches schema".split(" "),
  ..."x Foo llama3 1 0.5 true false".split(" "),
  ...NAME_KEYWORDS,
  ...['"s"', '"{{x}}"', '"""t"""', '"1.0.0"', '"^1.0.0"', '"("', "// c\n"],
];

describe("parser properties", () => {
  test("fuzz: parse(tokenize(src)) returns a Program or throws a LexerError or ParserError", () => {
    const source = fc.oneof(
      fc.array(fc.constantFrom(...TOKEN_SOUP), { maxLength: 30 }).map((ts) => ts.join(" ")),
      fc.string({ maxLength: 40 })
    );
    fc.assert(
      fc.property(source, (src) => {
        try {
          expect(parse(tokenize(src)).kind).toBe("Program");
        } catch (error) {
          if (!(error instanceof ParserError || error instanceof LexerError)) throw error;
          expect(error.line).toBeGreaterThanOrEqual(1);
          expect(error.column).toBeGreaterThanOrEqual(1);
        }
      }),
      propertyParams(2000)
    );
  });

  test("round-trip: a generated program rendered to source parses back to the same AST", () => {
    fc.assert(
      fc.property(program, separators, (p, seps) => {
        const tokens = programTokens(p);
        const source = tokens.map((t, i) => (i === 0 ? t : seps[i % seps.length]! + t)).join("");
        expect(strip(parse(tokenize(source)))).toEqual(p);
      }),
      propertyParams(400)
    );
  });
});
