#!/usr/bin/env bun
/** Deterministic relevance evaluator for the shipped search data (Bun built-ins only). */
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { AVAILABLE_STACKS, CSV_CONFIG, DATA_DIR, search, searchStack, STACK_CONFIG } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { parseCsvRecords, type Row } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { DesignSystemGenerator, paletteIsDark } from "../.claude/skills/ui-ux-pro-max/scripts/design-system.ts";
import { REPO_ROOT, SKILL_SCRIPTS_DIR } from "./lib/paths.ts";
import {
  checkThresholds,
  gradesForResults,
  ndcgAtK,
  precisionAtK,
  reciprocalRank,
  validateFixture,
  validateManifest,
} from "./lib/relevance-metrics.ts";

export const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures");
type Json = any;

export class EvaluationError extends Error {}

export async function loadJson(path: string): Promise<Json> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (error) {
    throw new EvaluationError(`Invalid JSON file ${path}: ${(error as Error).message}`);
  }
  if (/(?<!["\w])(NaN|-?Infinity)(?!["\w])/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
    throw new EvaluationError(`Invalid JSON file ${path}: non-RFC JSON numeric constant`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new EvaluationError(`Invalid JSON file ${path}: ${(error as Error).message}`);
  }
}

async function sha256Of(entries: [string, string][]): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const [label, path] of entries) {
    hasher.update(`${label}\0`);
    hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()));
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

/** Binds a threshold approval to the search runtime and every shipped CSV. */
export const RUNTIME_FILES = ["core.ts", "csv.ts", "difflib.ts", "design-system.ts", "reasoning-contract.ts"];

export async function runtimeFingerprint({ root = REPO_ROOT, scriptsDir = SKILL_SCRIPTS_DIR, dataDir = DATA_DIR } = {}): Promise<string> {
  const label = (path: string) => relative(root, path).replaceAll("\\", "/");
  const paths = RUNTIME_FILES.map((name) => join(scriptsDir, name));
  const csvs = [...new Bun.Glob("**/*.csv").scanSync({ cwd: dataDir })].map((path) => join(dataDir, path));
  const all = [...paths, ...csvs.sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0))];
  return sha256Of(all.map((path) => [label(path), path]));
}

/** Binds approvals to the judgments and the code that grades them. */
export async function oracleFingerprint(casesPath = join(FIXTURE_DIR, "relevance-cases.json")): Promise<string> {
  return sha256Of([
    ["scripts/evaluate-relevance.ts", join(REPO_ROOT, "scripts", "evaluate-relevance.ts")],
    ["scripts/lib/relevance-metrics.ts", join(REPO_ROOT, "scripts", "lib", "relevance-metrics.ts")],
    ["relevance-cases.json", casesPath],
  ]);
}

export async function validateIdentities(fixture: Json): Promise<string[]> {
  const errors: string[] = [];
  const cache = new Map<string, Row[]>();
  for (const testCase of fixture.cases) {
    if (!testCase.judgments?.length) continue;
    const mode = testCase.mode;
    const domain = mode === "domain" ? testCase.domain : testCase.expectedRoute;
    const file =
      mode === "stack"
        ? STACK_CONFIG[testCase.stack]!.file
        : (CSV_CONFIG as Record<string, { file: string }>)[mode !== "design-system" ? domain : "product"]!.file;
    const path = join(DATA_DIR, file);
    if (!cache.has(path)) cache.set(path, parseCsvRecords(await Bun.file(path).text()));
    for (const judgment of testCase.judgments) {
      const identity = judgment.identity as Record<string, unknown>;
      const matches = cache.get(path)!.filter((row) => Object.entries(identity).every(([key, value]) => String(row[key] ?? "") === String(value)));
      if (matches.length !== 1) errors.push(`${testCase.id}: identity resolves to ${matches.length} rows in ${file.split("/").pop()}: ${JSON.stringify(identity)}`);
    }
  }
  return errors;
}

const IDENTITY_FIELDS = [
  "Style Category", "Product Type", "Data Type", "Pattern Name",
  "Font Pairing Name", "Family", "Category", "Issue", "Icon Name",
  "Intensity Tier", "Trigger", "Guideline", "Brand ID",
];

function resultIdentity(result: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(IDENTITY_FIELDS.filter((field) => result[field]).map((field) => [field, result[field]]));
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function designCoherence(testCase: Json, result: Json): boolean[] {
  const expected = testCase.coherence ?? {};
  const checks: boolean[] = [];
  if (expected.productCategory) checks.push(result.category === expected.productCategory);
  if (expected.styleNames?.length) checks.push(expected.styleNames.includes(result.style?.name));
  if (expected.patternNames?.length) checks.push(expected.patternNames.includes(result.pattern?.name));
  if (expected.colorMode) {
    const actual = paletteIsDark({ Background: result.colors?.background ?? "" }) ? "dark" : "light";
    checks.push(actual === expected.colorMode);
  }
  if (expected.colorProductTypes?.length) checks.push(expected.colorProductTypes.includes(result.source_identities?.color));
  return checks;
}

interface Stats {
  retrieval: { p1: number; p3: number; mrr3: number; ndcg3: number }[];
  routes: boolean[];
  typo: boolean[];
  coherence: number[];
  negativePasses: number;
  negativeChecks: number;
  cases: number;
}

const newStats = (): Stats => ({ retrieval: [], routes: [], typo: [], coherence: [], negativePasses: 0, negativeChecks: 0, cases: 0 });

function summarize(stats: Stats) {
  const r = stats.retrieval;
  return {
    metrics: {
      routingAccuracy: mean(stats.routes.map(Number)),
      precisionAt1: mean(r.map((item) => item.p1)),
      precisionAt3: mean(r.map((item) => item.p3)),
      mrrAt3: mean(r.map((item) => item.mrr3)),
      ndcgAt3: mean(r.map((item) => item.ndcg3)),
      negativeAbstention: stats.negativeChecks ? stats.negativePasses / stats.negativeChecks : 0,
      typoRecoveryAt3: mean(stats.typo.map(Number)),
      designSystemCoherence: mean(stats.coherence),
    },
    samples: {
      cases: stats.cases,
      retrieval: r.length,
      routing: stats.routes.length,
      negativeChecks: stats.negativeChecks,
      typo: stats.typo.length,
      designSystem: stats.coherence.length,
    } as Record<string, number>,
  };
}

export async function evaluate(fixture: Json, oracle: string | null = null) {
  const records: Json[] = [];
  const coverage: Record<string, number> = {};
  const buckets: Record<string, Stats> = { all: newStats(), calibration: newStats(), held_out: newStats() };
  const applicability = fixture.globalNegativeApplicability;
  const globalNegatives = applicability === "all-domains-and-stacks" || (typeof applicability === "object" && applicability !== null);
  const domains = Object.keys(CSV_CONFIG);
  const generator = await DesignSystemGenerator.create();
  for (const testCase of fixture.cases) {
    const targets = [buckets.all!, buckets[testCase.split]!];
    for (const stats of targets) stats.cases++;
    const { mode, query } = testCase;
    const judgments = testCase.judgments ?? [];
    const tags: string[] = testCase.tags ?? [];
    if (tags.includes("hard-negative") && globalNegatives) {
      const labels = [...domains.map((d) => `domain:${d}`), ...AVAILABLE_STACKS.map((s) => `stack:${s}`)];
      const outputs = [
        ...(await Promise.all(domains.map((domain) => search(query, domain as never, 3)))),
        ...(await Promise.all(AVAILABLE_STACKS.map((stack) => searchStack(query, stack, 3)))),
      ];
      const counts = outputs.map((output) => (output as Json).count ?? 0);
      for (const stats of targets) {
        stats.negativeChecks += counts.length;
        stats.negativePasses += counts.filter((count) => count === 0).length;
      }
      records.push({
        id: testCase.id,
        negativeChecks: counts.length,
        falsePositives: counts.filter((count) => count > 0).length,
        falsePositiveTargets: labels.filter((_, index) => counts[index]),
      });
      continue;
    }
    if (mode === "design-system") {
      const result = await generator.generate(query, {});
      const checks = designCoherence(testCase, result);
      for (const stats of targets) stats.coherence.push(mean(checks.map(Number)));
      records.push({ id: testCase.id, coherence: checks, actual: { category: result.category, style: result.style?.name, pattern: result.pattern?.name } });
      continue;
    }
    let output: Json;
    if (mode === "stack") {
      output = await searchStack(query, testCase.stack, 3, true);
      coverage[`stack:${testCase.stack}`] = (coverage[`stack:${testCase.stack}`] ?? 0) + 1;
    } else {
      output = await search(query, mode === "auto" ? undefined : testCase.domain, 3, true);
      if (mode === "domain") coverage[`domain:${testCase.domain}`] = (coverage[`domain:${testCase.domain}`] ?? 0) + 1;
    }
    if (testCase.expectedRoute) for (const stats of targets) stats.routes.push(output.domain === testCase.expectedRoute);
    const grades = gradesForResults(output.results ?? [], judgments);
    let scores = {};
    if (judgments.length) {
      const ideal = judgments.map((item: Json) => item.grade);
      const s = { p1: precisionAtK(grades, 1), p3: precisionAtK(grades, 3), mrr3: reciprocalRank(grades), ndcg3: ndcgAtK(grades, ideal) };
      scores = s;
      for (const stats of targets) stats.retrieval.push(s);
      if (tags.includes("typo")) for (const stats of targets) stats.typo.push(grades.slice(0, 3).some((grade) => grade > 0));
    }
    records.push({
      id: testCase.id,
      route: output.domain,
      expectedRoute: testCase.expectedRoute ?? null,
      grades,
      scores,
      diagnostics: output.diagnostics ?? {},
      actual: (output.results ?? []).map(resultIdentity),
    });
  }
  const summary = summarize(buckets.all!);
  Object.assign(summary.samples, coverage);
  return {
    schemaVersion: 1,
    runtimeFingerprint: await runtimeFingerprint(),
    oracleFingerprint: oracle ?? (await oracleFingerprint()),
    metrics: summary.metrics,
    samples: summary.samples,
    splits: { calibration: summarize(buckets.calibration!), held_out: summarize(buckets.held_out!) },
    cases: records,
  };
}

/** JSON with recursively sorted keys (json.dumps(sort_keys=True, indent=2)). */
export function sortedJson(value: unknown): string {
  const sortDeep = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortDeep) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Json)[k])])) : v;
  return JSON.stringify(sortDeep(value), null, 2);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      cases: { type: "string", default: join(FIXTURE_DIR, "relevance-cases.json") },
      thresholds: { type: "string", default: join(FIXTURE_DIR, "relevance-thresholds.json") },
      baseline: { type: "string", default: join(FIXTURE_DIR, "relevance-baseline.json") },
      split: { type: "string", default: "all" },
      "write-baseline": { type: "string" },
      "no-thresholds": { type: "boolean" },
    },
  });
  try {
    const split = values.split!;
    if (!["all", "calibration", "held_out"].includes(split)) throw new EvaluationError(`--split must be one of all, calibration, held_out`);
    let fixture = await loadJson(values.cases!);
    const fingerprint = await runtimeFingerprint();
    const oracle = await oracleFingerprint(values.cases);
    const errors = [...validateFixture(fixture, Object.keys(CSV_CONFIG), AVAILABLE_STACKS), ...(await validateIdentities(fixture))];
    if (errors.length) throw new EvaluationError(`Invalid relevance fixture:\n- ${errors.join("\n- ")}`);
    if (split !== "all") fixture = { ...fixture, cases: fixture.cases.filter((testCase: Json) => testCase.split === split) };
    const report = await evaluate(fixture, oracle);
    if (values["write-baseline"]) await Bun.write(values["write-baseline"], `${sortedJson(report)}\n`);
    console.log(sortedJson({ metrics: report.metrics, samples: report.samples, splits: report.splits }));
    const manifest = await loadJson(values.thresholds!);
    const manifestErrors = validateManifest(manifest, fingerprint, oracle);
    if (manifestErrors.length && !values["no-thresholds"]) throw new EvaluationError(`Invalid threshold manifest:\n- ${manifestErrors.join("\n- ")}`);
    const failures = values["no-thresholds"] ? [] : checkThresholds(report, manifest, split);
    if (failures.length) {
      const baseline = await loadJson(values.baseline!);
      const old = new Map<string, Json>(baseline.cases.map((record: Json) => [record.id, record]));
      let suspect = report.cases.filter((record: Json) => !deepEqual(old.get(record.id), record));
      if (!suspect.length) {
        suspect = report.cases.filter(
          (record: Json) => (record.grades?.length && record.grades[0] < 2) || record.falsePositives || ("coherence" in record && !record.coherence.every(Boolean)),
        );
      }
      const detail = suspect.map((item: Json) => `  ${item.id}: ${JSON.stringify(item.actual ?? item)}`).join("\n");
      throw new EvaluationError(`Relevance gate failed:\n- ${failures.join("\n- ")}${detail ? `\nProblem cases:\n${detail}` : ""}`);
    }
  } catch (error) {
    if (error instanceof EvaluationError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
