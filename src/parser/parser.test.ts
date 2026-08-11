import { describe, test, expect } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "./parser";
import { ParserError } from "./errors";
import type {
  Program,
  TypeDeclaration,
  PromptDeclaration,
  ChainDeclaration,
  TestDeclaration,
  EvalDeclaration,
  EnumType,
  StructType,
  PrimitiveType,
  TypeReference,
  MessageSection,
  OutputSection,
  CallExpression,
  MemberExpression,
  NamedArgument,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
} from "../ast/nodes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(source: string): Program {
  return parse(tokenize(source));
}

function firstDecl<T>(source: string): T {
  return p(source).declarations[0] as T;
}

// ---------------------------------------------------------------------------
// 1. Metadata
// ---------------------------------------------------------------------------

describe("Parser — Metadata", () => {
  test("parses @version", () => {
    const ast = p(`@version "1.0.0"`);
    expect(ast.metadata).toHaveLength(1);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("VersionMetadata");
    if (m.kind === "VersionMetadata") expect(m.value).toBe("1.0.0");
  });

  test("parses @model", () => {
    const ast = p(`@model claude-opus-4.7`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("ModelMetadata");
    if (m.kind === "ModelMetadata") expect(m.value).toBe("claude-opus-4.7");
  });

  test("parses @temperature", () => {
    const ast = p(`@temperature 0.3`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("TemperatureMetadata");
    if (m.kind === "TemperatureMetadata") expect(m.value).toBeCloseTo(0.3);
  });

  test("parses @max_tokens", () => {
    const ast = p(`@max_tokens 2048`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("MaxTokensMetadata");
    if (m.kind === "MaxTokensMetadata") expect(m.value).toBe(2048);
  });

  test("parses @breaking_changes", () => {
    const ast = p(`@breaking_changes "output type changed"`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("BreakingChangesMetadata");
    if (m.kind === "BreakingChangesMetadata") expect(m.value).toBe("output type changed");
  });

  test("parses @migration_from with two strings", () => {
    const ast = p(`@migration_from "0.9.0" "1.0.0"`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("MigrationFromMetadata");
    if (m.kind === "MigrationFromMetadata") {
      expect(m.from).toBe("0.9.0");
      expect(m.to).toBe("1.0.0");
    }
  });

  test("parses @description", () => {
    const ast = p(`@description "Support ticket classifier"`);
    const m = ast.metadata[0]!;
    expect(m.kind).toBe("DescriptionMetadata");
    if (m.kind === "DescriptionMetadata") expect(m.value).toBe("Support ticket classifier");
  });

  test("parses multiple metadata directives", () => {
    const ast = p(`
      @version "1.0.0"
      @model claude-opus-4.7
      @temperature 0.5
    `);
    expect(ast.metadata).toHaveLength(3);
    expect(ast.metadata[0]!.kind).toBe("VersionMetadata");
    expect(ast.metadata[1]!.kind).toBe("ModelMetadata");
    expect(ast.metadata[2]!.kind).toBe("TemperatureMetadata");
  });
});

// ---------------------------------------------------------------------------
// 2. TypeDeclaration — primitive
// ---------------------------------------------------------------------------

describe("Parser — TypeDeclaration (primitive)", () => {
  test("parses type alias to string", () => {
    const decl = firstDecl<TypeDeclaration>(`type Name = string`);
    expect(decl.kind).toBe("TypeDeclaration");
    expect(decl.name).toBe("Name");
    expect(decl.definition.kind).toBe("PrimitiveType");
    if (decl.definition.kind === "PrimitiveType") expect(decl.definition.name).toBe("string");
  });

  test("parses type alias to number", () => {
    const decl = firstDecl<TypeDeclaration>(`type Count = number`);
    expect(decl.definition.kind).toBe("PrimitiveType");
    if (decl.definition.kind === "PrimitiveType") expect(decl.definition.name).toBe("number");
  });

  test("parses type alias to boolean", () => {
    const decl = firstDecl<TypeDeclaration>(`type Flag = boolean`);
    if (decl.definition.kind === "PrimitiveType") expect(decl.definition.name).toBe("boolean");
  });

  test("parses type alias to date", () => {
    const decl = firstDecl<TypeDeclaration>(`type When = date`);
    if (decl.definition.kind === "PrimitiveType") expect(decl.definition.name).toBe("date");
  });
});

// ---------------------------------------------------------------------------
// 3. TypeDeclaration — TypeReference
// ---------------------------------------------------------------------------

describe("Parser — TypeDeclaration (TypeReference)", () => {
  test("parses type alias to a named type", () => {
    const decl = firstDecl<TypeDeclaration>(`type Alias = Category`);
    expect(decl.definition.kind).toBe("TypeReference");
    if (decl.definition.kind === "TypeReference") expect(decl.definition.name).toBe("Category");
  });
});

// ---------------------------------------------------------------------------
// 4. EnumType
// ---------------------------------------------------------------------------

describe("Parser — EnumType", () => {
  test("parses enum with multiple members", () => {
    const decl = firstDecl<TypeDeclaration>(`type Category = enum { bug, feature_request, question, other }`);
    expect(decl.definition.kind).toBe("EnumType");
    const e = decl.definition as EnumType;
    expect(e.values).toEqual(["bug", "feature_request", "question", "other"]);
  });

  test("parses enum with trailing comma", () => {
    const decl = firstDecl<TypeDeclaration>(`type Status = enum { open, closed, }`);
    const e = decl.definition as EnumType;
    expect(e.values).toEqual(["open", "closed"]);
  });

  test("parses enum with single member", () => {
    const decl = firstDecl<TypeDeclaration>(`type Solo = enum { only }`);
    const e = decl.definition as EnumType;
    expect(e.values).toHaveLength(1);
    expect(e.values[0]).toBe("only");
  });
});

// ---------------------------------------------------------------------------
// 5. StructType
// ---------------------------------------------------------------------------

describe("Parser — StructType", () => {
  test("parses struct with multiple fields", () => {
    const decl = firstDecl<TypeDeclaration>(`
      type Invoice = struct {
        amount: number
        currency: string
        vendor: string
      }
    `);
    expect(decl.definition.kind).toBe("StructType");
    const s = decl.definition as StructType;
    expect(s.fields).toHaveLength(3);
    expect(s.fields[0]!.name).toBe("amount");
    expect(s.fields[0]!.optional).toBe(false);
    expect(s.fields[0]!.type.kind).toBe("PrimitiveType");
  });

  test("parses struct with optional field", () => {
    const decl = firstDecl<TypeDeclaration>(`
      type Invoice = struct {
        amount: number
        ref?: string
      }
    `);
    const s = decl.definition as StructType;
    expect(s.fields[1]!.optional).toBe(true);
    expect(s.fields[1]!.name).toBe("ref");
  });

  test("parses struct with TypeReference field", () => {
    const decl = firstDecl<TypeDeclaration>(`
      type Order = struct {
        id: string
        category: Category
      }
    `);
    const s = decl.definition as StructType;
    expect(s.fields[1]!.type.kind).toBe("TypeReference");
    if (s.fields[1]!.type.kind === "TypeReference") expect(s.fields[1]!.type.name).toBe("Category");
  });

  test("parses struct fields separated by commas", () => {
    const decl = firstDecl<TypeDeclaration>(`type Pair = struct { x: number, y: number }`);
    const s = decl.definition as StructType;
    expect(s.fields).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. PromptDeclaration
// ---------------------------------------------------------------------------

describe("Parser — PromptDeclaration", () => {
  test("parses prompt with no parameters", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt greet() -> string {
        system: "You are a greeter."
        user: "Say hello."
        output: string
      }
    `);
    expect(decl.kind).toBe("PromptDeclaration");
    expect(decl.name).toBe("greet");
    expect(decl.parameters).toHaveLength(0);
    expect(decl.returnType.kind).toBe("PrimitiveType");
  });

  test("parses prompt with one parameter", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt classify(ticket: string) -> Category {
        system: "You are a classifier."
        user: "Classify: {{ticket}}"
        output: Category
      }
    `);
    expect(decl.parameters).toHaveLength(1);
    expect(decl.parameters[0]!.name).toBe("ticket");
    expect(decl.parameters[0]!.type.kind).toBe("PrimitiveType");
    const p = decl.parameters[0]!.type as PrimitiveType;
    expect(p.name).toBe("string");
  });

  test("parses prompt with multiple parameters", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt summarize(doc: string, max_words: number) -> string {
        system: "You are a summarizer."
        user: "Summarize."
        output: string
      }
    `);
    expect(decl.parameters).toHaveLength(2);
    expect(decl.parameters[0]!.name).toBe("doc");
    expect(decl.parameters[1]!.name).toBe("max_words");
  });

  test("parses prompt with TypeReference return type", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt detect(text: string) -> Language {
        system: "Detect language."
        user: "{{text}}"
        output: Language
      }
    `);
    expect(decl.returnType.kind).toBe("TypeReference");
    const tr = decl.returnType as TypeReference;
    expect(tr.name).toBe("Language");
  });

  test("parses prompt with enum inline return type", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt pick(q: string) -> enum { yes, no } {
        system: "Answer yes or no."
        user: "{{q}}"
        output: enum { yes, no }
      }
    `);
    expect(decl.returnType.kind).toBe("EnumType");
  });

  test("stores section count correctly", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt t(x: string) -> string {
        system: "S"
        user: "U"
        assistant: "A"
        output: string
      }
    `);
    expect(decl.sections).toHaveLength(4);
  });

  test("parses prompt with triple-string system prompt", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt doc(x: string) -> string {
        system: """
          You are an assistant.
          Be helpful.
        """
        output: string
      }
    `);
    const sys = decl.sections[0] as MessageSection;
    expect(sys.kind).toBe("MessageSection");
    expect(sys.role).toBe("system");
    expect(sys.content.kind).toBe("StringLiteral");
    expect(sys.content.value).toContain("You are an assistant");
  });

  test("parses prompt with template string user section", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt q(input: string) -> string {
        system: "Answer."
        user: "{{input}}"
        output: string
      }
    `);
    const userSection = decl.sections[1] as MessageSection;
    expect(userSection.content.isTemplate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. PromptSection
// ---------------------------------------------------------------------------

describe("Parser — PromptSection", () => {
  test("parses system section", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt x() -> string {
        system: "Be helpful."
        output: string
      }
    `);
    const s = decl.sections[0] as MessageSection;
    expect(s.kind).toBe("MessageSection");
    expect(s.role).toBe("system");
    expect(s.content.value).toBe("Be helpful.");
  });

  test("parses user section", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt x() -> string {
        system: "S"
        user: "Hello"
        output: string
      }
    `);
    const u = decl.sections[1] as MessageSection;
    expect(u.role).toBe("user");
  });

  test("parses assistant section", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt x() -> string {
        system: "S"
        assistant: "I am ready."
        output: string
      }
    `);
    const a = decl.sections[1] as MessageSection;
    expect(a.role).toBe("assistant");
  });

  test("parses output section with primitive type", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt x() -> string {
        system: "S"
        output: string
      }
    `);
    const o = decl.sections[1] as OutputSection;
    expect(o.kind).toBe("OutputSection");
    expect(o.type.kind).toBe("PrimitiveType");
  });

  test("parses output section with TypeReference", () => {
    const decl = firstDecl<PromptDeclaration>(`
      prompt x() -> Category {
        system: "S"
        output: Category
      }
    `);
    const o = decl.sections[1] as OutputSection;
    expect(o.type.kind).toBe("TypeReference");
  });
});

// ---------------------------------------------------------------------------
// 8. ChainDeclaration
// ---------------------------------------------------------------------------

describe("Parser — ChainDeclaration", () => {
  test("parses chain with one step", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain process(text: string) -> string {
        step result = summarize(text)
        return result
      }
    `);
    expect(decl.kind).toBe("ChainDeclaration");
    expect(decl.name).toBe("process");
    expect(decl.steps).toHaveLength(1);
    expect(decl.steps[0]!.name).toBe("result");
  });

  test("parses chain with multiple steps", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain pipeline(doc: string) -> string {
        step summary = summarize(doc)
        step translated = translate(summary)
        return translated
      }
    `);
    expect(decl.steps).toHaveLength(2);
    expect(decl.steps[0]!.name).toBe("summary");
    expect(decl.steps[1]!.name).toBe("translated");
  });

  test("parses chain with return identifier", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain run(x: string) -> string {
        step out = process(x)
        return out
      }
    `);
    expect(decl.returnExpression.kind).toBe("Identifier");
    if (decl.returnExpression.kind === "Identifier") expect(decl.returnExpression.name).toBe("out");
  });

  test("parses chain with return member expression", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain run(x: string) -> string {
        step out = process(x)
        return out.result
      }
    `);
    expect(decl.returnExpression.kind).toBe("MemberExpression");
    const me = decl.returnExpression as MemberExpression;
    expect(me.object).toBe("out");
    expect(me.property).toBe("result");
  });

  test("parses chain with named args in step expression", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain go(doc: string, lang: Language) -> string {
        step s = summarize(document: doc, max_words: 50)
        return s
      }
    `);
    const step = decl.steps[0]!;
    expect(step.expression.kind).toBe("CallExpression");
    const call = step.expression as CallExpression;
    expect(call.arguments).toHaveLength(2);
    const arg0 = call.arguments[0] as NamedArgument;
    expect(arg0.kind).toBe("NamedArgument");
    expect(arg0.name).toBe("document");
  });

  test("parses chain parameters and return type", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain go(a: string, b: number) -> boolean {
        step r = check(a)
        return r
      }
    `);
    expect(decl.parameters).toHaveLength(2);
    expect(decl.returnType.kind).toBe("PrimitiveType");
    const rt = decl.returnType as PrimitiveType;
    expect(rt.name).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// 9. Expressions
// ---------------------------------------------------------------------------

describe("Parser — Expressions", () => {
  test("parses identifier expression as chain return", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step y = f(x)
        return y
      }
    `);
    expect(decl.returnExpression.kind).toBe("Identifier");
  });

  test("parses member expression", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step y = f(x)
        return y.output
      }
    `);
    expect(decl.returnExpression.kind).toBe("MemberExpression");
  });

  test("parses call expression with no args", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step y = doSomething()
        return y
      }
    `);
    const step = decl.steps[0]!;
    expect(step.expression.kind).toBe("CallExpression");
    const call = step.expression as CallExpression;
    expect(call.callee).toBe("doSomething");
    expect(call.arguments).toHaveLength(0);
  });

  test("parses call expression with positional identifier arg", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step y = process(x)
        return y
      }
    `);
    const call = decl.steps[0]!.expression as CallExpression;
    expect(call.arguments).toHaveLength(1);
    expect(call.arguments[0]!.kind).toBe("Identifier");
  });

  test("parses call expression with string literal arg", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "t" {
        input: classify("some text")
        expect: result
      }
    `);
    expect(decl.input.kind).toBe("CallExpression");
    const call = decl.input as CallExpression;
    expect(call.arguments[0]!.kind).toBe("StringLiteral");
    const arg = call.arguments[0] as StringLiteral;
    expect(arg.value).toBe("some text");
  });

  test("parses call expression with number literal arg", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step y = limit(x, 100)
        return y
      }
    `);
    const call = decl.steps[0]!.expression as CallExpression;
    expect(call.arguments[1]!.kind).toBe("NumberLiteral");
    const n = call.arguments[1] as NumberLiteral;
    expect(n.value).toBe(100);
  });

  test("parses mixed named and positional args are independent calls", () => {
    const decl = firstDecl<ChainDeclaration>(`
      chain c(x: string) -> string {
        step a = fn(key: x)
        return a
      }
    `);
    const call = decl.steps[0]!.expression as CallExpression;
    const named = call.arguments[0] as NamedArgument;
    expect(named.kind).toBe("NamedArgument");
    expect(named.name).toBe("key");
  });
});

// ---------------------------------------------------------------------------
// 10. TestDeclaration
// ---------------------------------------------------------------------------

describe("Parser — TestDeclaration", () => {
  test("parses test with single bare expect", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "classifies bug" {
        input: classify("app crashes")
        expect: bug
      }
    `);
    expect(decl.kind).toBe("TestDeclaration");
    expect(decl.description).toBe("classifies bug");
    expect(decl.expectations).toHaveLength(1);
    expect(decl.expectations[0]!.path).toEqual(["expect"]);
    expect(decl.expectations[0]!.value.kind).toBe("Identifier");
  });

  test("parses test with field-path expect", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "extracts amount" {
        input: extract("Invoice 100 EUR")
        expect.amount: 100
      }
    `);
    expect(decl.expectations[0]!.path).toEqual(["expect", "amount"]);
    expect(decl.expectations[0]!.value.kind).toBe("NumberLiteral");
    const v = decl.expectations[0]!.value as NumberLiteral;
    expect(v.value).toBe(100);
  });

  test("parses test with multiple expect clauses", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "full extraction" {
        input: extract("some invoice")
        expect.amount: 500
        expect.currency: "EUR"
        expect.vendor: "Acme"
      }
    `);
    expect(decl.expectations).toHaveLength(3);
    expect(decl.expectations[1]!.path).toEqual(["expect", "currency"]);
    const strVal = decl.expectations[1]!.value as StringLiteral;
    expect(strVal.value).toBe("EUR");
  });

  test("parses test expect with boolean value", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "flag check" {
        input: check("x")
        expect.valid: true
      }
    `);
    const v = decl.expectations[0]!.value as BooleanLiteral;
    expect(v.kind).toBe("BooleanLiteral");
    expect(v.value).toBe(true);
  });

  test("parses test with triple-string input", () => {
    const decl = firstDecl<TestDeclaration>(`
      test "long doc" {
        input: summarize("""
          This is a long document.
          With multiple lines.
        """)
        expect: summary
      }
    `);
    const call = decl.input as CallExpression;
    expect(call.arguments[0]!.kind).toBe("StringLiteral");
    const s = call.arguments[0] as StringLiteral;
    expect(s.isTemplate).toBe(false);
    expect(s.value).toContain("long document");
  });
});

// ---------------------------------------------------------------------------
// 11. EvalDeclaration
// ---------------------------------------------------------------------------

describe("Parser — EvalDeclaration", () => {
  test("parses eval declaration", () => {
    const decl = firstDecl<EvalDeclaration>(`
      eval "classify accuracy" {
        dataset: "tickets.jsonl"
        prompt: classify_ticket
        metric: accuracy
        threshold: 0.9
      }
    `);
    expect(decl.kind).toBe("EvalDeclaration");
    expect(decl.description).toBe("classify accuracy");
    expect(decl.dataset).toBe("tickets.jsonl");
    expect(decl.promptName).toBe("classify_ticket");
    expect(decl.metric).toBe("accuracy");
    expect(decl.threshold).toBeCloseTo(0.9);
  });

  test("parses eval with integer threshold", () => {
    const decl = firstDecl<EvalDeclaration>(`
      eval "perf" {
        dataset: "data.jsonl"
        prompt: my_prompt
        metric: f1
        threshold: 1
      }
    `);
    expect(decl.threshold).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Positions (line/column preserved)
// ---------------------------------------------------------------------------

describe("Parser — Positions", () => {
  test("Program node is at line 1, column 1 for empty source", () => {
    const ast = p(``);
    expect(ast.line).toBe(1);
    expect(ast.column).toBe(1);
  });

  test("TypeDeclaration node preserves source position", () => {
    const ast = p(`
type Category = enum { bug, other }
    `);
    const decl = ast.declarations[0] as TypeDeclaration;
    // 'type' keyword is on line 2
    expect(decl.line).toBe(2);
    expect(decl.column).toBe(1);
  });

  test("PromptDeclaration node preserves source position", () => {
    const ast = p(`
      prompt classify(ticket: string) -> string {
        system: "S"
        output: string
      }
    `);
    const decl = ast.declarations[0] as PromptDeclaration;
    expect(decl.line).toBeGreaterThan(0);
    expect(decl.column).toBeGreaterThan(0);
  });

  test("Parameter node preserves source position", () => {
    const ast = p(`
      prompt foo(bar: string) -> string {
        system: "S"
        output: string
      }
    `);
    const decl = ast.declarations[0] as PromptDeclaration;
    const param = decl.parameters[0]!;
    expect(param.line).toBeGreaterThan(0);
    expect(param.name).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// 13. Error cases
// ---------------------------------------------------------------------------

describe("Parser — Errors", () => {
  test("throws ParserError on unknown top-level keyword", () => {
    expect(() => p(`foo bar`)).toThrow(ParserError);
  });

  test("throws ParserError when '=' missing in TypeDeclaration", () => {
    expect(() => p(`type Category enum { bug }`)).toThrow(ParserError);
  });

  test("throws ParserError on missing '->' in PromptDeclaration", () => {
    expect(() => p(`prompt foo() string { system: "S" output: string }`)).toThrow(ParserError);
  });

  test("throws ParserError on missing closing ')' in parameter list", () => {
    expect(() => p(`prompt foo(ticket: string { system: "S" output: string }`)).toThrow(ParserError);
  });

  test("throws ParserError on empty prompt body", () => {
    expect(() => p(`prompt foo() -> string { }`)).toThrow(ParserError);
  });

  test("throws ParserError when prompt body has invalid section keyword", () => {
    expect(() => p(`prompt foo() -> string { invalid: "text" output: string }`)).toThrow(ParserError);
  });

  test("throws ParserError on chain with no steps", () => {
    expect(() => p(`chain c(x: string) -> string { return x }`)).toThrow(ParserError);
  });

  test("throws ParserError on missing 'return' in chain body", () => {
    expect(() => p(`chain c(x: string) -> string { step y = f(x) }`)).toThrow(ParserError);
  });

  test("throws ParserError on test with no expect clause", () => {
    expect(() => p(`test "t" { input: foo("x") }`)).toThrow(ParserError);
  });

  test("throws ParserError on unexpected EOF in enum", () => {
    expect(() => p(`type X = enum {`)).toThrow(ParserError);
  });

  test("ParserError has correct line and column", () => {
    try {
      p(`
prompt foo() string { }`);
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      const err = e as ParserError;
      expect(err.line).toBeGreaterThan(0);
      expect(err.column).toBeGreaterThan(0);
    }
  });

  test("ParserError message is pedagogical", () => {
    try {
      p(`type X =`);
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError);
      const err = e as ParserError;
      expect(err.message).toContain("[Parser]");
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Integration — classify-ticket.prompt
// ---------------------------------------------------------------------------

describe("Parser — Integration: classify-ticket.prompt", () => {
  const CLASSIFY_SOURCE = `
@version "1.0.0"
@model claude-opus-4.7
@temperature 0.3
@description "Support ticket classifier — enum output, multiple tests"

type Category = enum { bug, feature_request, question, other }

prompt classify_ticket(ticket: string) -> Category {
  system: """
    You are a support ticket classifier for a B2B SaaS product.
    Respond with exactly one word — the category name.
  """
  user: "Classify this ticket:\\n\\n{{ticket}}"
  output: Category
}

test "classifies crash reports as bug" {
  input: classify_ticket("The submit button crashes the app on iOS 17")
  expect: bug
}

test "classifies new functionality as feature_request" {
  input: classify_ticket("It would be useful to export data as CSV")
  expect: feature_request
}
  `;

  test("parses metadata section", () => {
    const ast = p(CLASSIFY_SOURCE);
    expect(ast.metadata).toHaveLength(4);
    expect(ast.metadata[0]!.kind).toBe("VersionMetadata");
    expect(ast.metadata[1]!.kind).toBe("ModelMetadata");
    expect(ast.metadata[2]!.kind).toBe("TemperatureMetadata");
    expect(ast.metadata[3]!.kind).toBe("DescriptionMetadata");
  });

  test("parses type declaration", () => {
    const ast = p(CLASSIFY_SOURCE);
    const typDecl = ast.declarations[0] as TypeDeclaration;
    expect(typDecl.kind).toBe("TypeDeclaration");
    expect(typDecl.name).toBe("Category");
    const enumDef = typDecl.definition as EnumType;
    expect(enumDef.values).toEqual(["bug", "feature_request", "question", "other"]);
  });

  test("parses prompt declaration", () => {
    const ast = p(CLASSIFY_SOURCE);
    const prompt = ast.declarations[1] as PromptDeclaration;
    expect(prompt.kind).toBe("PromptDeclaration");
    expect(prompt.name).toBe("classify_ticket");
    expect(prompt.parameters).toHaveLength(1);
    expect(prompt.parameters[0]!.name).toBe("ticket");
    expect(prompt.returnType.kind).toBe("TypeReference");
    const ret = prompt.returnType as TypeReference;
    expect(ret.name).toBe("Category");
  });

  test("parses prompt sections", () => {
    const ast = p(CLASSIFY_SOURCE);
    const prompt = ast.declarations[1] as PromptDeclaration;
    expect(prompt.sections).toHaveLength(3);
    const sys = prompt.sections[0] as MessageSection;
    expect(sys.kind).toBe("MessageSection");
    expect(sys.role).toBe("system");
    const user = prompt.sections[1] as MessageSection;
    expect(user.content.isTemplate).toBe(true);
    const out = prompt.sections[2] as OutputSection;
    expect(out.kind).toBe("OutputSection");
  });

  test("parses test declarations", () => {
    const ast = p(CLASSIFY_SOURCE);
    const test1 = ast.declarations[2] as TestDeclaration;
    expect(test1.kind).toBe("TestDeclaration");
    expect(test1.description).toBe("classifies crash reports as bug");
    expect(test1.expectations[0]!.value.kind).toBe("Identifier");
  });

  test("full program has 4 declarations", () => {
    const ast = p(CLASSIFY_SOURCE);
    expect(ast.declarations).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 15. Integration — extract-invoice.prompt (struct + optional fields)
// ---------------------------------------------------------------------------

describe("Parser — Integration: extract-invoice.prompt", () => {
  const EXTRACT_SOURCE = `
@version "1.0.0"
@model claude-opus-4.7
@description "Invoice data extractor — struct output, field assertions"

type ExtractedInvoice = struct {
  amount: number
  currency: string
  invoice_date: string
  vendor: string
  invoice_number?: string
}

prompt extract_invoice(pdf_text: string) -> ExtractedInvoice {
  system: """
    You are an invoice data extraction specialist.
    Return valid JSON only.
  """
  user: """
    Extract the invoice data from the following text:
    ---
    {{pdf_text}}
    ---
  """
  output: ExtractedInvoice
}

test "extracts EUR invoice" {
  input: extract_invoice("""
    ACME CORPORATION
    Invoice #INV-001
    Total Due: 1250 EUR
  """)
  expect.amount: 1250
  expect.currency: "EUR"
  expect.vendor: "Acme Corporation"
}
  `;

  test("parses struct with optional field", () => {
    const ast = p(EXTRACT_SOURCE);
    const typDecl = ast.declarations[0] as TypeDeclaration;
    const s = typDecl.definition as StructType;
    expect(s.fields).toHaveLength(5);
    const optField = s.fields[4]!;
    expect(optField.name).toBe("invoice_number");
    expect(optField.optional).toBe(true);
  });

  test("parses struct non-optional fields", () => {
    const ast = p(EXTRACT_SOURCE);
    const typDecl = ast.declarations[0] as TypeDeclaration;
    const s = typDecl.definition as StructType;
    expect(s.fields[0]!.optional).toBe(false);
    expect(s.fields[0]!.name).toBe("amount");
  });

  test("parses prompt with TypeReference return type", () => {
    const ast = p(EXTRACT_SOURCE);
    const prompt = ast.declarations[1] as PromptDeclaration;
    expect(prompt.returnType.kind).toBe("TypeReference");
    const tr = prompt.returnType as TypeReference;
    expect(tr.name).toBe("ExtractedInvoice");
  });

  test("parses test with field-path expectations", () => {
    const ast = p(EXTRACT_SOURCE);
    const testDecl = ast.declarations[2] as TestDeclaration;
    expect(testDecl.expectations).toHaveLength(3);
    expect(testDecl.expectations[0]!.path).toEqual(["expect", "amount"]);
    const amountVal = testDecl.expectations[0]!.value as NumberLiteral;
    expect(amountVal.value).toBe(1250);
    expect(testDecl.expectations[1]!.path).toEqual(["expect", "currency"]);
  });

  test("parses triple-string test input", () => {
    const ast = p(EXTRACT_SOURCE);
    const testDecl = ast.declarations[2] as TestDeclaration;
    const call = testDecl.input as CallExpression;
    expect(call.callee).toBe("extract_invoice");
    const arg = call.arguments[0] as StringLiteral;
    expect(arg.kind).toBe("StringLiteral");
    expect(arg.value).toContain("ACME");
  });
});

// ---------------------------------------------------------------------------
// 16. Integration — summarize-and-translate.prompt (chain construct)
// ---------------------------------------------------------------------------

describe("Parser — Integration: summarize-and-translate (chain)", () => {
  // Simplified version: uses positional args and avoids comparison operators
  // (which the lexer does not support in v0.3).
  const CHAIN_SOURCE = `
@version "1.0.0"
@model claude-opus-4.7
@description "Summarize then translate — demonstrates chain composition"

type Language = enum {
  english,
  french,
  german,
  spanish,
  italian
}

prompt summarize(document: string, max_words: number) -> string {
  system: """
    You are a precise document summarizer.
    Return only the summary text.
  """
  user: """
    Summarize this document in {{max_words}} words or fewer:
    {{document}}
  """
  output: string
}

prompt translate(text: string, target_language: Language) -> string {
  system: "You are a professional translator."
  user: "Translate to {{target_language}}:\\n\\n{{text}}"
  output: string
}

chain summarize_and_translate(
  document: string,
  max_words: number,
  target_language: Language
) -> string {
  step english_summary = summarize(document: document, max_words: max_words)
  step translated = translate(text: english_summary, target_language: target_language)
  return translated
}

test "translates to french" {
  input: summarize_and_translate("A long document.", 30, french)
  expect: translated
}
  `;

  test("parses Language enum type", () => {
    const ast = p(CHAIN_SOURCE);
    const typDecl = ast.declarations[0] as TypeDeclaration;
    expect(typDecl.name).toBe("Language");
    const e = typDecl.definition as EnumType;
    expect(e.values).toContain("french");
    expect(e.values).toHaveLength(5);
  });

  test("parses summarize prompt", () => {
    const ast = p(CHAIN_SOURCE);
    const summarize = ast.declarations[1] as PromptDeclaration;
    expect(summarize.kind).toBe("PromptDeclaration");
    expect(summarize.name).toBe("summarize");
    expect(summarize.parameters).toHaveLength(2);
  });

  test("parses translate prompt", () => {
    const ast = p(CHAIN_SOURCE);
    const translate = ast.declarations[2] as PromptDeclaration;
    expect(translate.name).toBe("translate");
    const p2 = translate.parameters[1]!;
    expect(p2.name).toBe("target_language");
    expect(p2.type.kind).toBe("TypeReference");
  });

  test("parses chain declaration", () => {
    const ast = p(CHAIN_SOURCE);
    const chain = ast.declarations[3] as ChainDeclaration;
    expect(chain.kind).toBe("ChainDeclaration");
    expect(chain.name).toBe("summarize_and_translate");
    expect(chain.parameters).toHaveLength(3);
  });

  test("chain has two steps", () => {
    const ast = p(CHAIN_SOURCE);
    const chain = ast.declarations[3] as ChainDeclaration;
    expect(chain.steps).toHaveLength(2);
    expect(chain.steps[0]!.name).toBe("english_summary");
    expect(chain.steps[1]!.name).toBe("translated");
  });

  test("chain steps use named arguments", () => {
    const ast = p(CHAIN_SOURCE);
    const chain = ast.declarations[3] as ChainDeclaration;
    const step1Call = chain.steps[0]!.expression as CallExpression;
    expect(step1Call.callee).toBe("summarize");
    expect(step1Call.arguments).toHaveLength(2);
    const arg0 = step1Call.arguments[0] as NamedArgument;
    expect(arg0.kind).toBe("NamedArgument");
    expect(arg0.name).toBe("document");
  });

  test("chain return expression is an identifier", () => {
    const ast = p(CHAIN_SOURCE);
    const chain = ast.declarations[3] as ChainDeclaration;
    expect(chain.returnExpression.kind).toBe("Identifier");
    if (chain.returnExpression.kind === "Identifier") {
      expect(chain.returnExpression.name).toBe("translated");
    }
  });

  test("full program has 5 declarations", () => {
    const ast = p(CHAIN_SOURCE);
    expect(ast.declarations).toHaveLength(5);
  });
});
