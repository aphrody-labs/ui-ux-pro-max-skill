/** Pure metric, schema, and threshold helpers for relevance evaluation. */

export const REQUIRED_METRICS: ReadonlySet<string> = new Set([
  "routingAccuracy", "precisionAt1", "precisionAt3", "mrrAt3", "ndcgAt3",
  "negativeAbstention", "typoRecoveryAt3", "designSystemCoherence",
]);

type Json = any;

export function precisionAtK(grades: number[], k: number): number {
  return k ? grades.slice(0, k).filter((grade) => grade > 0).length / k : 0;
}

export function reciprocalRank(grades: number[], k = 3): number {
  const index = grades.slice(0, k).findIndex((grade) => grade > 0);
  return index === -1 ? 0 : 1 / (index + 1);
}

export function ndcgAtK(grades: number[], idealGrades: number[], k = 3): number {
  const dcg = (values: number[]) => values.slice(0, k).reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...idealGrades].sort((a, b) => b - a));
  return ideal ? dcg(grades) / ideal : 0;
}

export function gradesForResults(results: Record<string, unknown>[], judgments: { grade: number; identity: Record<string, unknown> }[]): number[] {
  const matches = (result: Record<string, unknown>, identity: Record<string, unknown>) =>
    Object.entries(identity).every(([field, value]) => String(result[field] ?? "") === String(value));
  return results.map((result) => Math.max(0, ...judgments.filter((item) => matches(result, item.identity)).map((item) => item.grade)));
}

const sorted = (values: Iterable<string>) => [...values].sort();
const setEquals = (a: Iterable<string>, b: Iterable<string>) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((value) => y.has(value));
};

export function validateFixture(fixture: Json, domains: Iterable<string>, stacks: Iterable<string>, requireCoverage = true): string[] {
  const domainList = [...domains];
  const stackList = [...stacks];
  const errors: string[] = [];
  const seen = new Set<string>();
  const domainCoverage = new Set<string>();
  const stackCoverage = new Set<string>();
  const cases: Json[] = fixture.cases ?? [];
  if (fixture.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!(cases.length >= 60 && cases.length <= 100)) errors.push("fixture must contain 60-100 cases");
  const applicability = fixture.globalNegativeApplicability ?? {};
  if (!setEquals(applicability.domains ?? [], domainList)) errors.push("hard-negative domain applicability must cover every registered domain");
  if (!setEquals(applicability.stacks ?? [], stackList)) errors.push("hard-negative stack applicability must cover every registered stack");
  for (const testCase of cases) {
    const id = testCase.id ?? "<missing>";
    if (seen.has(id)) errors.push(`duplicate case id: ${id}`);
    seen.add(id);
    if (!["calibration", "held_out"].includes(testCase.split)) errors.push(`${id}: invalid split`);
    if (!["domain", "stack", "auto", "design-system"].includes(testCase.mode)) errors.push(`${id}: invalid mode`);
    if (testCase.domain && !domainList.includes(testCase.domain)) errors.push(`${id}: unknown domain ${testCase.domain}`);
    if (testCase.stack && !stackList.includes(testCase.stack)) errors.push(`${id}: unknown stack ${testCase.stack}`);
    if (testCase.judgments?.length) {
      if (testCase.mode === "domain") domainCoverage.add(testCase.domain);
      if (testCase.mode === "stack") stackCoverage.add(testCase.stack);
    }
    for (const judgment of testCase.judgments ?? []) {
      if (![1, 2].includes(judgment.grade) || !judgment.identity || !Object.keys(judgment.identity).length) {
        errors.push(`${id}: judgment needs identity and grade 1 or 2`);
      }
    }
  }
  if (requireCoverage) {
    const missingDomains = sorted(domainList.filter((domain) => !domainCoverage.has(domain)));
    const missingStacks = sorted(stackList.filter((stack) => !stackCoverage.has(stack)));
    if (missingDomains.length) errors.push(`positive coverage missing domains: ${missingDomains.join(", ")}`);
    if (missingStacks.length) errors.push(`positive coverage missing stacks: ${missingStacks.join(", ")}`);
  }
  return errors;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateManifest(manifest: Json, runtimeFingerprint: string, oracleFingerprint: string | null = null): string[] {
  const errors: string[] = [];
  const required = [
    "schemaVersion", "status", "approvingMaintainer", "units", "splitPolicy",
    "runtimeFingerprint", "oracleFingerprint", "baselineRevision",
    "metrics", "sampleMinimums", "lockedCases", "splits",
  ];
  const missing = sorted(required.filter((key) => !(key in manifest)));
  if (missing.length) errors.push(`threshold manifest missing sections: ${missing.join(", ")}`);
  if (manifest.schemaVersion !== 1) errors.push("threshold schemaVersion must be 1");
  if (!["provisional-baseline-regression-gate", "approved"].includes(manifest.status)) errors.push("threshold status must explicitly be provisional or approved");
  if (!manifest.approvingMaintainer) errors.push("approvingMaintainer must be recorded");
  if (manifest.runtimeFingerprint !== runtimeFingerprint) errors.push("runtimeFingerprint does not match canonical runtime/data");
  if (oracleFingerprint !== null && manifest.oracleFingerprint !== oracleFingerprint) errors.push("oracleFingerprint does not match judgments/evaluator logic");
  const revision = manifest.baselineRevision;
  if (typeof revision !== "string" || !/^[0-9a-f]{7,40}$/.test(revision)) errors.push("baselineRevision must be a 7-40 character lowercase git revision");
  const splits = manifest.splits ?? {};
  const ruleSets: [string, Json][] = [
    ["aggregate", manifest.metrics ?? {}],
    ...(["calibration", "held_out"] as const).map((name): [string, Json] => [name, splits[name]?.metrics ?? {}]),
  ];
  for (const [label, rules] of ruleSets) {
    const absent = sorted([...REQUIRED_METRICS].filter((metric) => !(metric in rules)));
    if (absent.length) errors.push(`${label} thresholds missing metrics: ${absent.join(", ")}`);
  }
  for (const name of ["calibration", "held_out"]) {
    const minimums = splits[name]?.sampleMinimums;
    if (!minimums || !Object.keys(minimums).length) errors.push(`${name} sample minimums are required`);
  }
  if (!manifest.sampleMinimums || !Object.keys(manifest.sampleMinimums).length || !manifest.lockedCases || !Object.keys(manifest.lockedCases).length) {
    errors.push("aggregate sampleMinimums and lockedCases must not be empty");
  }
  for (const [label, rules] of ruleSets) {
    for (const [metric, rule] of Object.entries<Json>(rules)) {
      if (Object.keys(rule).some((key) => key !== "floor" && key !== "tolerance") || !("floor" in rule)) {
        errors.push(`${label}.${metric}: rule allows only floor and tolerance`);
        continue;
      }
      const floor = rule.floor;
      const tolerance = rule.tolerance ?? 0;
      if (!isFiniteNumber(floor) || floor < 0 || floor > 1) errors.push(`${label}.${metric}: floor must be finite in [0,1]`);
      if (!isFiniteNumber(tolerance) || tolerance < 0 || tolerance > 1) errors.push(`${label}.${metric}: tolerance must be finite in [0,1]`);
    }
  }
  const sampleSets: [string, Json][] = [
    ["aggregate", manifest.sampleMinimums ?? {}],
    ...(["calibration", "held_out"] as const).map((name): [string, Json] => [name, splits[name]?.sampleMinimums ?? {}]),
  ];
  for (const [label, samples] of sampleSets) {
    for (const [sample, minimum] of Object.entries(samples)) {
      if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) errors.push(`${label}.${sample}: sample minimum must be a non-negative integer`);
    }
  }
  return errors;
}

function checkRules(report: Json, rules: Json, prefix = ""): string[] {
  const failures: string[] = [];
  for (const [metric, rule] of Object.entries<Json>(rules.metrics)) {
    const value = report.metrics[metric];
    if (value === undefined || value === null || value + (rule.tolerance ?? 0) < rule.floor) failures.push(`${prefix}${metric}: ${value} below floor ${rule.floor}`);
  }
  for (const [sample, minimum] of Object.entries<number>(rules.sampleMinimums)) {
    if ((report.samples[sample] ?? 0) < minimum) failures.push(`${prefix}${sample}: sample count below ${minimum}`);
  }
  return failures;
}

export function checkThresholds(report: Json, manifest: Json, selectedSplit = "all"): string[] {
  if (selectedSplit !== "all") return checkRules(report, manifest.splits[selectedSplit], `${selectedSplit}.`);
  const failures = checkRules(report, manifest);
  for (const [split, rules] of Object.entries(manifest.splits)) failures.push(...checkRules(report.splits[split], rules, `${split}.`));
  const records = new Map<string, Json>(report.cases.map((record: Json) => [record.id, record]));
  for (const [caseId, rule] of Object.entries<Json>(manifest.lockedCases ?? {})) {
    const record = records.get(caseId) ?? {};
    const grades: number[] = record.grades ?? [];
    const withinTop = rule.withinTop ?? 1;
    if (Math.max(0, ...grades.slice(0, withinTop)) < (rule.minimumGrade ?? 2)) {
      failures.push(`${caseId}: locked result missing from top ${withinTop}; actual=${JSON.stringify(record.actual ?? [])}`);
    }
  }
  return failures;
}
