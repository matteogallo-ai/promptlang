import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { ParserError } from "./errors";
import { parse } from "./parser";

/**
 * The parser's messages are its user interface: each one names what was
 * expected and where. This table pins the message, position and expected/found
 * token of every reachable error, so a reworded or misplaced error is a test
 * failure rather than a silent regression.
 */

function errorOf(source: string): ParserError {
  try {
    parse(tokenize(source));
  } catch (error) {
    if (error instanceof ParserError) return error;
    throw error;
  }
  throw new Error(`expected a ParserError for: ${source}`);
}

/** [source, message without the "[Parser] Line L, Column C: " prefix, line, column, expected?, found?] */
type Case = [string, string, number, number, string?, string?];

// biome-ignore format: one error case per line keeps the table reviewable
const CASES: Case[] = [
  ["prompt p() -> string { system: \"s\" }\nimport \"a.prompt\" as A", "'import' must appear at the top of the file, before any metadata (@...) or declarations.", 2, 1],
  ["@version \"1.0.0\"\nimport \"a.prompt\" as A", "'import' must appear at the top of the file, before any metadata (@...) or declarations.", 2, 1],
  ["import x as A", "Expected a string path after 'import', e.g. import \"shared/x.prompt\" as X", 1, 8, "STRING", "IDENT"],
  ["import \"{{x}}\" as A", "Import path cannot contain template interpolation '{{...}}'.", 1, 8],
  ["import \"a.prompt\" A", "Expected 'as' after import path — imports must have an alias, e.g. import \"a.prompt\" as MyAlias", 1, 19, "AS", "IDENT"],
  ["import \"a.prompt\" as \"A\"", "Expected an alias identifier after 'as'", 1, 22, "IDENT", "STRING"],
  ["import \"a.prompt\" as A requires 1", "Expected a version range string after 'requires', e.g. requires \"^1.0.0\"", 1, 33, "STRING", "NUMBER"],
  ["import \"a.prompt\" as A requires \"^x\"", "invalid version range part '^x' in \"^x\" (supported: 1.2.3, =1.2.3, ^1.2.3, ~1.2.3, >, >=, <, <=, space-separated)", 1, 33],
  ["@version 1", "@version expects a string value, e.g. @version \"1.0.0\"", 1, 10, "STRING", "NUMBER"],
  ["@version \"1.0\"", "@version \"1.0\" is not a valid SemVer 2.0.0 version: expected MAJOR.MINOR.PATCH with optional -pre-release and +build, e.g. \"1.0.0\" or \"2.1.0-rc.1\"", 1, 10],
  ["@model \"x\"", "@model expects an identifier, e.g. @model claude-opus-5-5", 1, 8, "IDENT", "STRING"],
  ["@temperature \"x\"", "@temperature expects a number, e.g. @temperature 0.3", 1, 14, "NUMBER", "STRING"],
  ["@max_tokens x", "@max_tokens expects a number, e.g. @max_tokens 2048", 1, 13, "NUMBER", "IDENT"],
  ["@breaking_changes 1", "@breaking_changes expects a string", 1, 19, "STRING", "NUMBER"],
  ["@migration_from 1", "@migration_from expects two strings: the old version and the new version", 1, 17, "STRING", "NUMBER"],
  ["@migration_from \"1\" 2", "@migration_from expects a second string for the new version", 1, 21, "STRING", "NUMBER"],
  ["@description 1", "@description expects a string value", 1, 14, "STRING", "NUMBER"],
  ["foo", "Expected a declaration ('type', 'prompt', 'chain', 'test', or 'eval') but found 'foo'.", 1, 1, "declaration keyword", "IDENT"],
  ["type = string", "Expected a type name after 'type'", 1, 6, "IDENT", "EQUAL"],
  ["type T string", "Expected '=' after type name 'T'", 1, 8, "EQUAL", "STRING_TYPE"],
  ["type T = ->", "Expected a type expression (primitive, enum, struct, or a named type) but found '->'.", 1, 10, "type expression", "ARROW"],
  ["type T = enum a", "Expected '{' after 'enum'", 1, 15, "LBRACE", "IDENT"],
  ["type T = enum { \"a\" }", "Expected an enum member name", 1, 17, "IDENT", "STRING"],
  ["type T = enum { a, 1 }", "Expected an enum member name after ','", 1, 20, "IDENT", "NUMBER"],
  ["type T = enum { a b }", "Expected '}' to close enum body", 1, 19, "RBRACE", "IDENT"],
  ["type T = struct a", "Expected '{' after 'struct'", 1, 17, "LBRACE", "IDENT"],
  ["type T = struct { 1 }", "Expected a field name", 1, 19, "IDENT", "NUMBER"],
  ["type T = struct { a string }", "Expected ':' after field name 'a'", 1, 21, "COLON", "STRING_TYPE"],
  ["type T = struct { a? string }", "Expected ':' after field name 'a?'", 1, 22, "COLON", "STRING_TYPE"],
  ["type T = struct { a: string", "Expected '}' to close struct body", 1, 28, "RBRACE", "EOF"],
  ["prompt () -> string { system: \"s\" }", "Expected a prompt name after 'prompt'", 1, 8, "IDENT", "LPAREN"],
  ["prompt p -> string { system: \"s\" }", "Expected '(' after prompt name 'p'", 1, 10, "LPAREN", "ARROW"],
  ["prompt p(a: string b: string) -> string { system: \"s\" }", "Expected ')' to close parameter list. Did you forget a comma between parameters?", 1, 20, "RPAREN", "IDENT"],
  ["prompt p(1) -> string { system: \"s\" }", "Expected a parameter name", 1, 10, "IDENT", "NUMBER"],
  ["prompt p(a string) -> string { system: \"s\" }", "Expected ':' after parameter name 'a'", 1, 12, "COLON", "STRING_TYPE"],
  ["prompt p(a? string) -> string { system: \"s\" }", "Expected ':' after parameter name 'a?'", 1, 13, "COLON", "STRING_TYPE"],
  ["prompt p() string { system: \"s\" }", "Expected '->' after parameter list for prompt 'p'", 1, 12, "ARROW", "STRING_TYPE"],
  ["prompt p() -> string system: \"s\" }", "Expected '{' to open prompt body for 'p'", 1, 22, "LBRACE", "SYSTEM"],
  ["prompt p() -> string { system: \"s\"", "Expected '}' to close prompt body for 'p'", 1, 35, "RBRACE", "EOF"],
  ["prompt p() -> string { }", "Prompt body must contain at least one section (system, user, assistant, or output).", 1, 24],
  ["prompt p() -> string { system \"s\" }", "Expected ':' after 'system'", 1, 31, "COLON", "STRING"],
  ["prompt p() -> string { user: 1 }", "Expected a string after 'user:'", 1, 30, "STRING", "NUMBER"],
  ["prompt p() -> string { output string }", "Expected ':' after 'output'", 1, 31, "COLON", "STRING_TYPE"],
  ["prompt p() -> string { input: \"s\" }", "Expected a prompt section ('system', 'user', 'assistant', or 'output') but found 'input'.", 1, 24],
  ["chain () -> string { step a = f() return a }", "Expected a chain name after 'chain'", 1, 7, "IDENT", "LPAREN"],
  ["chain c -> string { step a = f() return a }", "Expected '(' after chain name 'c'", 1, 9, "LPAREN", "ARROW"],
  ["chain c(a: string -> string { step a = f() return a }", "Expected ')' to close parameter list", 1, 19, "RPAREN", "ARROW"],
  ["chain c() string { step a = f() return a }", "Expected '->' after parameter list for chain 'c'", 1, 11, "ARROW", "STRING_TYPE"],
  ["chain c() -> string step a = f() return a }", "Expected '{' to open chain body for 'c'", 1, 21, "LBRACE", "STEP"],
  ["chain c() -> string { return a }", "Chain body must contain at least one 'step' before 'return'.", 1, 23],
  ["chain c() -> string { step a = f() }", "Expected 'return' statement at the end of chain body", 1, 36, "RETURN", "RBRACE"],
  ["chain c() -> string { step a = f() return a", "Expected '}' to close chain body for 'c'", 1, 44, "RBRACE", "EOF"],
  ["chain c() -> string { foo }", "Expected 'step' inside chain body", 1, 23, "STEP", "IDENT"],
  ["chain c() -> string { step = f() return a }", "Expected a step name after 'step'", 1, 28, "IDENT", "EQUAL"],
  ["chain c() -> string { step a f() return a }", "Expected '=' after step name 'a'", 1, 30, "EQUAL", "IDENT"],
  ["chain c() -> string { step a = -> return a }", "Expected an expression (identifier, call, member access, or literal) but found '->'.", 1, 32],
  ["chain c() -> string { step a = f(x y) return a }", "Expected ')' to close argument list for 'f'. Did you forget a comma?", 1, 36, "RPAREN", "IDENT"],
  ["chain c() -> string { step a = x.1 return a }", "Expected property name after 'x.'", 1, 34, "IDENT", "NUMBER"],
  ["test 1 { input: f() expect: 1 }", "Expected a test description string after 'test'", 1, 6, "STRING", "NUMBER"],
  ["test \"t\" input: f() expect: 1 }", "Expected '{' to open test body", 1, 10, "LBRACE", "INPUT"],
  ["test \"t\" { expect: 1 }", "Expected 'input' as the first statement in a test body", 1, 12, "INPUT", "EXPECT"],
  ["test \"t\" { input f() expect: 1 }", "Expected ':' after 'input'", 1, 18, "COLON", "IDENT"],
  ["test \"t\" { input: f() mock \"m\" expect: 1 }", "Expected ':' after 'mock'", 1, 28, "COLON", "STRING"],
  ["test \"t\" { input: f() mock: 1 expect: 1 }", "Expected the mock model response as a string after 'mock:'", 1, 29, "STRING", "NUMBER"],
  ["test \"t\" { input: f() }", "Test body must contain at least one 'expect' clause.", 1, 23],
  ["test \"t\" { input: f() expect: 1", "Expected '}' to close test body", 1, 32, "RBRACE", "EOF"],
  ["test \"t\" { input: f() expect. 1 }", "Expected a field name after 'expect.'", 1, 31, "IDENT", "NUMBER"],
  ["test \"t\" { input: f() expect 1 }", "After 'expect', expected ':', 'contains', 'matches' or 'schema' but found '1'.", 1, 30],
  ["test \"t\" { input: f() expect.a schema }", "After 'expect.a', expected ':', 'contains', 'matches' or 'schema' ('schema' applies to the whole output, not to a field) but found 'schema'.", 1, 32],
  ["test \"t\" { input: f() expect contains \"x\" }", "Expected ':' after 'expect contains'", 1, 39, "COLON", "STRING"],
  ["test \"t\" { input: f() expect.a matches \"x\" }", "Expected ':' after 'expect.a matches'", 1, 40, "COLON", "STRING"],
  ["test \"t\" { input: f() expect contains: 1 }", "Expected a string after 'contains:'", 1, 40, "STRING", "NUMBER"],
  ["test \"t\" { input: f() expect matches: \"(\" }", "\"(\" is not a valid regular expression: Invalid regular expression: missing )", 1, 39],
  ["test \"t\" { input: f() expect: -> }", "Expected a literal value (string, number, boolean, or identifier) but found '->'.", 1, 31],
  ["eval 1 { }", "Expected a description string after 'eval'", 1, 6, "STRING", "NUMBER"],
  ["eval \"e\" dataset", "Expected '{' to open eval body", 1, 10, "LBRACE", "DATASET"],
  ["eval \"e\" { prompt: p }", "Expected 'dataset' as the first field in an eval body", 1, 12, "DATASET", "PROMPT"],
  ["eval \"e\" { dataset \"d\" }", "Expected ':' after 'dataset'", 1, 20, "COLON", "STRING"],
  ["eval \"e\" { dataset: 1 }", "Expected a string for 'dataset'", 1, 21, "STRING", "NUMBER"],
  ["eval \"e\" { dataset: \"d\" metric: m }", "Expected 'prompt' field in eval body", 1, 25, "PROMPT", "METRIC"],
  ["eval \"e\" { dataset: \"d\" prompt p }", "Expected ':' after 'prompt'", 1, 32, "COLON", "IDENT"],
  ["eval \"e\" { dataset: \"d\" prompt: 1 }", "Expected a prompt name after 'prompt:'", 1, 33, "IDENT", "NUMBER"],
  ["eval \"e\" { dataset: \"d\" prompt: p threshold: 1 }", "Expected 'metric' field in eval body", 1, 35, "METRIC", "THRESHOLD"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric m }", "Expected ':' after 'metric'", 1, 42, "COLON", "IDENT"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric: 1 }", "Expected a metric name after 'metric:'", 1, 43, "IDENT", "NUMBER"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric: m }", "Expected 'threshold' field in eval body", 1, 45, "THRESHOLD", "RBRACE"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric: m threshold 1 }", "Expected ':' after 'threshold'", 1, 55, "COLON", "NUMBER"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric: m threshold: x }", "Expected a number for 'threshold'", 1, 56, "NUMBER", "IDENT"],
  ["eval \"e\" { dataset: \"d\" prompt: p metric: m threshold: 1", "Expected '}' to close eval body", 1, 57, "RBRACE", "EOF"],
];

describe("parser error messages", () => {
  for (const [source, message, line, column, expected, found] of CASES) {
    test(JSON.stringify(source), () => {
      const error = errorOf(source);
      expect(error.name).toBe("ParserError");
      expect(error.message).toBe(`[Parser] Line ${line}, Column ${column}: ${message}`);
      expect([error.line, error.column]).toEqual([line, column]);
      expect([error.expected, error.found]).toEqual([expected, found]);
    });
  }
});
