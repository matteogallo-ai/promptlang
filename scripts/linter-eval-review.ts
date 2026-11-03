#!/usr/bin/env bun
/**
 * Human check of the corpus labels, which are set by construction
 * (scripts/linter-eval-corpus.ts) and so are only as good as the generator.
 *
 *   bun run scripts/linter-eval-review.ts build    # writes evals/linter/human-review/
 *   bun run scripts/linter-eval-review.ts score    # agreement once review.csv is annotated
 *
 * `build` draws 30 cases (6 clean, 4 per category, seeded) and writes two claims
 * per case, in shuffled order, to review.csv: the designed one ("has defect X",
 * or "has none of the six" for a clean case) and a decoy naming a category that
 * was not designed in. The answer key goes to key.json. The CSV has the columns
 * of verity's annotation tool (scripts/annotate.py: item_id, claim, cited_passage,
 * extracts, human_verdict), which shows only the claim, the prompt and the
 * definitions: no case id, no file name, no label.
 *
 * `score` reads the annotated CSV and the key: a designed claim marked
 * unsupported means the label is wrong; a decoy marked supported means the case
 * has a defect nobody designed. Each is reported with k, n and a Wilson 95%
 * interval, plus Cohen's kappa between the annotator and the construction.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AI_LINTER_SYSTEM_PROMPT } from "../src/analyzer/ai/prompts/analysis-prompt";
import { buildCorpus } from "./linter-eval-corpus";
import { type Rate, wilson } from "./linter-eval-metrics";

const ROOT = resolve(import.meta.dir, "..");
const DIR = resolve(ROOT, "evals/linter/human-review");
const SEED = 20261103;
const CLEAN = 6;
const PER_CATEGORY = 4;

/** The six definitions, as the linter reads them: one source, so the annotator sees the same words. */
export function definitions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of AI_LINTER_SYSTEM_PROMPT.matchAll(/^\d\. ([A-Z_]+): (.+)$/gm))
    out.set(m[1]!, m[2]!);
  if (out.size !== 6) throw new Error(`expected 6 category definitions, found ${out.size}`);
  return out;
}

/** mulberry32: a seeded PRNG, so the same seed always draws the same sample. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface KeyEntry {
  item_id: string;
  case: string;
  kind: "designed" | "decoy";
  /** The category the claim names; null for "has none of the six". */
  category: string | null;
  /** What the construction says the answer is. */
  expected: "supported" | "unsupported";
}

/** The prompt as the annotator reads it: without the leading comment that names its label. */
export function shownText(source: string): string {
  return source
    .split("\n")
    .filter((l) => !l.startsWith("//"))
    .join("\n")
    .trim();
}

export function buildReview(seed: number = SEED): {
  rows: Array<Record<string, string>>;
  key: KeyEntry[];
} {
  const { files, labels } = buildCorpus();
  const defs = definitions();
  const rand = rng(seed);
  const pick = (cases: typeof labels.cases, n: number) => shuffle(cases, rand).slice(0, n);
  const sample = [
    ...pick(
      labels.cases.filter((c) => c.defects.length === 0),
      CLEAN
    ),
    ...labels.categories.flatMap((cat) =>
      pick(
        labels.cases.filter((c) => c.defects.includes(cat)),
        PER_CATEGORY
      )
    ),
  ];
  const claims = sample.flatMap((c) => {
    const designed = c.defects[0] ?? null;
    const others = labels.categories.filter((x) => x !== designed);
    const decoy = others[Math.floor(rand() * others.length)]!;
    return [
      { case: c, kind: "designed" as const, category: designed },
      { case: c, kind: "decoy" as const, category: decoy },
    ];
  });
  const rows: Array<Record<string, string>> = [];
  const key: KeyEntry[] = [];
  shuffle(claims, rand).forEach((x, i) => {
    const item_id = `r${String(i + 1).padStart(2, "0")}`;
    rows.push({
      item_id,
      claim:
        x.category === null
          ? "This prompt has none of the six defects."
          : `This prompt has the defect ${x.category}: ${defs.get(x.category)}.`,
      cited_passage: shownText(files.get(x.case.file)!),
      extracts: [...defs].map(([k, v]) => `${k}: ${v}`).join("\n"),
      human_verdict: "",
      comment: "",
    });
    key.push({
      item_id,
      case: x.case.id,
      kind: x.kind,
      category: x.category,
      expected: x.kind === "designed" ? "supported" : "unsupported",
    });
  });
  return { rows, key };
}

const COLUMNS = ["item_id", "claim", "cited_passage", "extracts", "human_verdict", "comment"];

export function toCsv(rows: Array<Record<string, string>>): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return `${[COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c] ?? ""))].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}

/** RFC 4180 rows, as Python's csv module writes them (quoted fields may span lines). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records;
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ""])));
}

const rate = (k: number, n: number): Rate => ({
  k,
  n,
  value: n === 0 ? null : k / n,
  ci95: wilson(k, n),
});

export interface ReviewScore {
  annotated: number;
  total: number;
  /** Designed claims the annotator confirmed: the labels' validity. */
  designed_confirmed: Rate;
  /** Decoys the annotator rejected: cases without an undesigned defect. */
  decoys_rejected: Rate;
  /** Cohen's kappa, annotator vs construction, over the annotated claims. */
  kappa: number | null;
  disagreements: Array<KeyEntry & { human_verdict: string; comment: string }>;
}

export function scoreReview(rows: Array<Record<string, string>>, key: KeyEntry[]): ReviewScore {
  const byId = new Map(key.map((k) => [k.item_id, k]));
  const answered = rows.filter((r) => r.human_verdict);
  for (const r of answered)
    if (!byId.has(r.item_id!)) throw new Error(`item ${r.item_id} is not in the key`);
  const pairs = answered.map((r) => ({ k: byId.get(r.item_id!)!, r }));
  const agree = (p: (typeof pairs)[number]) => p.r.human_verdict === p.k.expected;
  const designed = pairs.filter((p) => p.k.kind === "designed");
  const decoys = pairs.filter((p) => p.k.kind === "decoy");
  const n = pairs.length;
  let kappa: number | null = null;
  if (n > 0) {
    const po = pairs.filter(agree).length / n;
    const hs = pairs.filter((p) => p.r.human_verdict === "supported").length / n;
    const ks = pairs.filter((p) => p.k.expected === "supported").length / n;
    const pe = hs * ks + (1 - hs) * (1 - ks);
    kappa = pe === 1 ? null : (po - pe) / (1 - pe);
  }
  return {
    annotated: n,
    total: rows.length,
    designed_confirmed: rate(designed.filter(agree).length, designed.length),
    decoys_rejected: rate(decoys.filter(agree).length, decoys.length),
    kappa,
    disagreements: pairs
      .filter((p) => !agree(p))
      .map((p) => ({
        ...p.k,
        human_verdict: p.r.human_verdict!,
        comment: p.r.comment ?? "",
      })),
  };
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "build") {
    const { rows, key } = buildReview();
    await mkdir(DIR, { recursive: true });
    await Bun.write(resolve(DIR, "review.csv"), toCsv(rows));
    await Bun.write(resolve(DIR, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
    console.error(
      `wrote ${rows.length} claims to evals/linter/human-review/review.csv and the key`
    );
  } else if (command === "score") {
    const rows = parseCsv(await Bun.file(resolve(DIR, "review.csv")).text());
    const key = (await Bun.file(resolve(DIR, "key.json")).json()) as KeyEntry[];
    console.log(JSON.stringify(scoreReview(rows, key), null, 2));
  } else {
    console.error("usage: linter-eval-review.ts build | score");
    process.exit(2);
  }
}
