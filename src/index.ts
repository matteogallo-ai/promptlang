/**
 * Public entry point of `@promptlang/core`: the compiler pipeline
 * (tokenize → parse → resolve → compile) and the static analyzer.
 * The runtime clients live behind the `@promptlang/core/runtime` subpath so that
 * generated code does not pull the compiler into application bundles.
 */
import packageJson from "../package.json";

/** Version of this package, read from package.json so it cannot drift. */
export const VERSION: string = packageJson.version;

export { tokenize } from "./lexer/lexer";
export { LexerError } from "./lexer/errors";
export type { Token } from "./lexer/token";
export { TokenType } from "./lexer/token";

export { parse } from "./parser/parser";
export { ParserError } from "./parser/errors";
export type * from "./ast/nodes";

export {
  resolveGraph,
  resolveImport,
  ResolverError,
  VersionMismatchError,
} from "./registry/resolver";
export type { ResolutionResult, ResolvedImport, ResolverOptions } from "./registry/resolver";

export { compile } from "./compiler/compiler";
export { compilePython } from "./compiler/python/python-compiler";
export { CompilerError } from "./compiler/errors";

export { analyze } from "./analyzer/analyzer";
export type { AnalysisContext, Issue, Rule } from "./analyzer/analyzer";
