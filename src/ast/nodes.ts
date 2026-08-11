// AST node interfaces for PromptLang v0.3.
// Every node carries line/column for precise error reporting in downstream phases.

export interface AstNode {
  line: number;
  column: number;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

export interface Program extends AstNode {
  kind: "Program";
  metadata: Metadata[];
  declarations: Declaration[];
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export type Metadata =
  | VersionMetadata
  | ModelMetadata
  | TemperatureMetadata
  | MaxTokensMetadata
  | BreakingChangesMetadata
  | MigrationFromMetadata
  | DescriptionMetadata;

export interface VersionMetadata extends AstNode {
  kind: "VersionMetadata";
  value: string;
}

export interface ModelMetadata extends AstNode {
  kind: "ModelMetadata";
  value: string;
}

export interface TemperatureMetadata extends AstNode {
  kind: "TemperatureMetadata";
  value: number;
}

export interface MaxTokensMetadata extends AstNode {
  kind: "MaxTokensMetadata";
  value: number;
}

export interface BreakingChangesMetadata extends AstNode {
  kind: "BreakingChangesMetadata";
  value: string;
}

export interface MigrationFromMetadata extends AstNode {
  kind: "MigrationFromMetadata";
  from: string;
  to: string;
}

export interface DescriptionMetadata extends AstNode {
  kind: "DescriptionMetadata";
  value: string;
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export type Declaration =
  | TypeDeclaration
  | PromptDeclaration
  | ChainDeclaration
  | TestDeclaration
  | EvalDeclaration;

// ---------------------------------------------------------------------------
// TypeDeclaration
// ---------------------------------------------------------------------------

export interface TypeDeclaration extends AstNode {
  kind: "TypeDeclaration";
  name: string;
  definition: TypeExpression;
}

// ---------------------------------------------------------------------------
// TypeExpression
// ---------------------------------------------------------------------------

export type TypeExpression =
  | PrimitiveType
  | EnumType
  | StructType
  | TypeReference;

export interface PrimitiveType extends AstNode {
  kind: "PrimitiveType";
  name: "string" | "number" | "boolean" | "date";
}

export interface EnumType extends AstNode {
  kind: "EnumType";
  values: string[];
}

export interface StructType extends AstNode {
  kind: "StructType";
  fields: Field[];
}

export interface TypeReference extends AstNode {
  kind: "TypeReference";
  name: string;
}

export interface Field extends AstNode {
  kind: "Field";
  name: string;
  /** True when the field was declared with `?` (e.g. `field?: type`). */
  optional: boolean;
  type: TypeExpression;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export interface Parameter extends AstNode {
  kind: "Parameter";
  name: string;
  type: TypeExpression;
}

// ---------------------------------------------------------------------------
// PromptDeclaration
// ---------------------------------------------------------------------------

export interface PromptDeclaration extends AstNode {
  kind: "PromptDeclaration";
  name: string;
  parameters: Parameter[];
  returnType: TypeExpression;
  sections: PromptSection[];
}

// ---------------------------------------------------------------------------
// PromptSection
// ---------------------------------------------------------------------------

export type PromptSection = MessageSection | OutputSection;

export interface MessageSection extends AstNode {
  kind: "MessageSection";
  role: "system" | "user" | "assistant";
  content: StringLiteral;
}

export interface OutputSection extends AstNode {
  kind: "OutputSection";
  type: TypeExpression;
}

// ---------------------------------------------------------------------------
// ChainDeclaration
// ---------------------------------------------------------------------------

export interface ChainDeclaration extends AstNode {
  kind: "ChainDeclaration";
  name: string;
  parameters: Parameter[];
  returnType: TypeExpression;
  steps: ChainStep[];
  returnExpression: Expression;
}

export interface ChainStep extends AstNode {
  kind: "ChainStep";
  name: string;
  expression: Expression;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expression =
  | CallExpression
  | MemberExpression
  | Identifier
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral;

/** An argument in a call expression, either positional or named (`key: value`). */
export type CallArgument = Expression | NamedArgument;

export interface CallExpression extends AstNode {
  kind: "CallExpression";
  callee: string;
  arguments: CallArgument[];
}

export interface NamedArgument extends AstNode {
  kind: "NamedArgument";
  name: string;
  value: Expression;
}

export interface MemberExpression extends AstNode {
  kind: "MemberExpression";
  object: string;
  property: string;
}

export interface Identifier extends AstNode {
  kind: "Identifier";
  name: string;
}

// ---------------------------------------------------------------------------
// TestDeclaration
// ---------------------------------------------------------------------------

export interface TestDeclaration extends AstNode {
  kind: "TestDeclaration";
  description: string;
  input: Expression;
  expectations: Expectation[];
}

export interface Expectation extends AstNode {
  kind: "Expectation";
  /** ["expect"] for bare `expect: val`, ["expect", "field"] for `expect.field: val`. */
  path: string[];
  value: Literal;
}

// ---------------------------------------------------------------------------
// EvalDeclaration
// ---------------------------------------------------------------------------

export interface EvalDeclaration extends AstNode {
  kind: "EvalDeclaration";
  description: string;
  dataset: string;
  promptName: string;
  metric: string;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export type Literal =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | Identifier;

export interface StringLiteral extends AstNode {
  kind: "StringLiteral";
  value: string;
  /** True when the source token was a TEMPLATE_STRING containing `{{...}}`. */
  isTemplate: boolean;
}

export interface NumberLiteral extends AstNode {
  kind: "NumberLiteral";
  value: number;
}

export interface BooleanLiteral extends AstNode {
  kind: "BooleanLiteral";
  value: boolean;
}
