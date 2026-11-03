/**
 * The interface of a prompt, and how it changed between two versions of a file.
 * Definitions and rationale: docs/adr/0002-prompt-interface.md.
 */
import type {
  ChainDeclaration,
  Metadata,
  Parameter,
  Program,
  PromptDeclaration,
  TypeExpression,
} from "../ast/nodes";
import { buildTypeRegistry } from "../compiler/code-generator";

export type Level = "major" | "minor" | "patch";

export interface Change {
  level: Level;
  /** The prompt or chain the change is inside; absent when the declaration itself was added or removed. */
  declaration?: string;
  description: string;
}

const RANK: Record<Level | "none", number> = { none: 0, patch: 1, minor: 2, major: 3 };

/** The strictest level among `changes`, or "none". */
export function requiredLevel(changes: readonly Change[]): Level | "none" {
  let best: Level | "none" = "none";
  for (const c of changes) if (RANK[c.level] > RANK[best]) best = c.level;
  return best;
}

/** One line per change, e.g. "major: classify: parameter 'x' removed". */
export function formatChange(c: Change): string {
  return `${c.level}: ${c.declaration ? `${c.declaration}: ` : ""}${c.description}`;
}

export function levelRank(level: Level | "none"): number {
  return RANK[level];
}

/** A type with named references replaced by their structure, enum values sorted. */
type Shape =
  | { kind: "primitive"; name: string }
  | { kind: "enum"; values: string[] }
  | { kind: "struct"; fields: Record<string, { optional: boolean; type: Shape }> }
  | { kind: "unresolved"; name: string };

function shapeOf(
  type: TypeExpression,
  types: Map<string, TypeExpression>,
  seen = new Set<string>()
): Shape {
  switch (type.kind) {
    case "PrimitiveType":
      return { kind: "primitive", name: type.name };
    case "EnumType":
      return { kind: "enum", values: [...type.values].sort() };
    case "StructType": {
      const fields: Record<string, { optional: boolean; type: Shape }> = {};
      for (const f of [...type.fields].sort((a, b) => a.name.localeCompare(b.name))) {
        fields[f.name] = { optional: f.optional, type: shapeOf(f.type, types, seen) };
      }
      return { kind: "struct", fields };
    }
    case "TypeReference": {
      const target = types.get(type.name);
      if (!target || seen.has(type.name)) return { kind: "unresolved", name: type.name };
      return shapeOf(target, types, new Set([...seen, type.name]));
    }
  }
}

function render(s: Shape): string {
  switch (s.kind) {
    case "primitive":
    case "unresolved":
      return s.name;
    case "enum":
      return `enum { ${s.values.join(", ")} }`;
    case "struct":
      return `struct { ${Object.entries(s.fields)
        .map(([n, f]) => `${n}${f.optional ? "?" : ""}: ${render(f.type)}`)
        .join(", ")} }`;
  }
}

interface Callable {
  kind: "prompt" | "chain";
  params: Map<string, { optional: boolean; type: string }>;
  output: Shape;
  /**
   * Everything that is not interface: a prompt's sections (an `output:` section
   * is not read by the code generators, so it counts as text), or a chain's steps.
   */
  body: string;
}

/** JSON of an AST fragment without source positions, so moving code is not a change. */
function positionless(value: unknown): string {
  return JSON.stringify(value, (key, v) => (key === "line" || key === "column" ? undefined : v));
}

function callables(program: Program): Map<string, Callable> {
  const types = buildTypeRegistry(program);
  const params = (ps: Parameter[]) =>
    new Map(
      ps.map((p) => [
        p.name,
        { optional: p.optional === true, type: render(shapeOf(p.type, types)) },
      ])
    );
  const out = new Map<string, Callable>();
  for (const d of program.declarations) {
    if (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") {
      out.set(d.name, {
        kind: d.kind === "PromptDeclaration" ? "prompt" : "chain",
        params: params(d.parameters),
        output: shapeOf(d.returnType, types),
        body: d.kind === "PromptDeclaration" ? promptBody(d) : chainBody(d),
      });
    }
  }
  return out;
}

function promptBody(d: PromptDeclaration): string {
  return positionless(d.sections);
}

function chainBody(d: ChainDeclaration): string {
  return positionless({ steps: d.steps, returnExpression: d.returnExpression });
}

function directive(program: Program, kind: Metadata["kind"]): string | null {
  const m = program.metadata.find((x) => x.kind === kind);
  return m && "value" in m ? String(m.value) : null;
}

function diffParams(name: string, base: Callable, cur: Callable, push: (c: Change) => void): void {
  for (const [p, b] of base.params) {
    const c = cur.params.get(p);
    if (!c) push({ level: "major", declaration: name, description: `parameter '${p}' removed` });
    else if (c.type !== b.type)
      push({
        level: "major",
        declaration: name,
        description: `parameter '${p}' type changed: ${b.type} → ${c.type}`,
      });
    else if (b.optional && !c.optional)
      push({ level: "major", declaration: name, description: `parameter '${p}' became required` });
    else if (!b.optional && c.optional)
      push({ level: "minor", declaration: name, description: `parameter '${p}' became optional` });
  }
  for (const [p, c] of cur.params) {
    if (base.params.has(p)) continue;
    push(
      c.optional
        ? { level: "minor", declaration: name, description: `optional parameter '${p}' added` }
        : { level: "major", declaration: name, description: `required parameter '${p}' added` }
    );
  }
}

/**
 * Output rule: the schema is what consumers read and what the model must
 * produce, so any change is major except adding optional struct fields.
 * `subject` names what is compared in the messages: a prompt's output, or a
 * declared type (`lead` prefixes its messages), which consumers read the same way.
 */
function diffOutput(
  name: string | undefined,
  base: Shape,
  cur: Shape,
  push: (c: Change) => void,
  prefix = "",
  subject: { lead?: string; whole: string; field: string } = {
    whole: "output type",
    field: "output field",
  }
): void {
  if (render(base) === render(cur)) return;
  const at = (c: Omit<Change, "declaration">): Change => {
    const described = { ...c, description: `${subject.lead ?? ""}${c.description}` };
    return name === undefined ? described : { ...described, declaration: name };
  };
  if (base.kind !== "struct" || cur.kind !== "struct") {
    const what = prefix === "" ? subject.whole : `${subject.field} '${prefix.slice(0, -1)}' type`;
    push(at({ level: "major", description: `${what} changed: ${render(base)} → ${render(cur)}` }));
    return;
  }
  for (const [f, b] of Object.entries(base.fields)) {
    const c = cur.fields[f];
    const path = `${prefix}${f}`;
    if (!c) {
      push(at({ level: "major", description: `${subject.field} '${path}' removed` }));
      continue;
    }
    if (c.optional !== b.optional)
      push(
        at({
          level: "major",
          description: `${subject.field} '${path}' became ${c.optional ? "optional" : "required"}`,
        })
      );
    // A nested struct is judged field by field, so adding an optional field inside it stays minor.
    diffOutput(name, b.type, c.type, push, `${path}.`, subject);
  }
  for (const [f, c] of Object.entries(cur.fields)) {
    if (f in base.fields) continue;
    const path = `${prefix}${f}`;
    push(
      at(
        c.optional
          ? { level: "minor", description: `optional ${subject.field} '${path}' added` }
          : { level: "major", description: `required ${subject.field} '${path}' added` }
      )
    );
  }
}

/**
 * The generated TypeScript and Python export each declared type under its own
 * name, so a consumer can import it: removing or renaming one breaks that import
 * even when every prompt's contract is structurally the same. A changed type is
 * judged like an output, as consumers read it the same way. It is reported even
 * when a prompt's diff also shows it: a prompt may reach the type only now, or
 * through another path, and then shows nothing.
 */
function diffTypes(base: Program, current: Program, push: (c: Change) => void): void {
  const b = buildTypeRegistry(base);
  const c = buildTypeRegistry(current);
  for (const [name, def] of b) {
    const now = c.get(name);
    if (!now) {
      push({ level: "major", description: `type '${name}' removed` });
      continue;
    }
    // Seeded with its own name, a recursive type is compared once, not unrolled into itself.
    const own = () => new Set([name]);
    diffOutput(undefined, shapeOf(def, b, own()), shapeOf(now, c, own()), push, "", {
      lead: `type '${name}': `,
      whole: "definition",
      field: "field",
    });
  }
  for (const name of c.keys())
    if (!b.has(name)) push({ level: "minor", description: `type '${name}' added` });
}

/** Every interface and behaviour change between two versions of one file. */
export function diffPrograms(base: Program, current: Program): Change[] {
  const changes: Change[] = [];
  const push = (c: Change) => changes.push(c);
  const b = callables(base);
  const c = callables(current);

  const fileLevel: Array<[Metadata["kind"], string, Level]> = [
    ["ModelMetadata", "target model", "major"],
    ["TemperatureMetadata", "temperature", "patch"],
    ["MaxTokensMetadata", "max_tokens", "patch"],
  ];

  for (const [name, bc] of b) {
    const cc = c.get(name);
    if (!cc) {
      push({ level: "major", description: `${bc.kind} '${name}' removed` });
      continue;
    }
    if (bc.kind !== cc.kind) {
      // A chain has no target model of its own, so the swap changes what the model contract covers.
      push({ level: "major", declaration: name, description: `${bc.kind} became a ${cc.kind}` });
      continue;
    }
    const isPrompt = bc.kind === "prompt";
    diffParams(name, bc, cc, push);
    diffOutput(name, bc.output, cc.output, push);
    if (isPrompt) {
      for (const [kind, label, level] of fileLevel) {
        const before = directive(base, kind);
        const after = directive(current, kind);
        if (before !== after)
          push({
            level,
            declaration: name,
            description: `${label} changed: ${before ?? "(none)"} → ${after ?? "(none)"}`,
          });
      }
    }
    if (bc.body !== cc.body)
      push({
        level: "patch",
        declaration: name,
        description: isPrompt ? "prompt text changed" : "chain steps changed",
      });
  }
  for (const [name, cc] of c) {
    if (!b.has(name)) push({ level: "minor", description: `${cc.kind} '${name}' added` });
  }
  diffTypes(base, current, push);
  return changes;
}
