/** Metric math and relevance fixture validation (ported from test_relevance_evaluator.py). */
import { describe, expect, test, afterAll } from "bun:test";
import { join } from "node:path";
import { FIXTURE_DIR, oracleFingerprint, RUNTIME_FILES, runtimeFingerprint } from "../scripts/evaluate-relevance.ts";
import {
  checkThresholds,
  gradesForResults,
  ndcgAtK,
  precisionAtK,
  reciprocalRank,
  REQUIRED_METRICS,
  validateFixture,
  validateManifest,
} from "../scripts/lib/relevance-metrics.ts";
import { cleanScratch, scratchDir } from "./helpers.ts";

afterAll(cleanScratch);

describe("metric math", () => {
  test("precision counts missing ranks as non-relevant", () => {
    expect(precisionAtK([2], 1)).toBe(1);
    expect(precisionAtK([2], 3)).toBeCloseTo(1 / 3);
    expect(precisionAtK([], 3)).toBe(0);
    expect(precisionAtK([2], 0)).toBe(0);
  });

  test("reciprocal rank stops at k", () => {
    expect(reciprocalRank([0, 2, 0])).toBe(0.5);
    expect(reciprocalRank([0, 0, 0, 2])).toBe(0);
    expect(reciprocalRank([])).toBe(0);
  });

  test("ndcg uses graded gain and handles empty ideal", () => {
    expect(ndcgAtK([2, 1], [2, 1])).toBe(1);
    expect(ndcgAtK([1, 2], [2, 1])).toBeLessThan(1);
    expect(ndcgAtK([], [], 3)).toBe(0);
  });

  test("result grades match identity subsets", () => {
    const results = [
      { Category: "State", Guideline: "Use useState", Severity: "Medium" },
      { Category: "State", Guideline: "Use useReducer", Severity: "Medium" },
    ];
    const judgments = [
      { identity: { Guideline: "Use useReducer" }, grade: 2 },
      { identity: { Category: "State" }, grade: 1 },
    ];
    expect(gradesForResults(results, judgments)).toEqual([1, 2]);
  });
});

describe("fixture validation", () => {
  const validFixture = () => {
    const base = {
      split: "calibration",
      mode: "domain",
      domain: "style",
      query: "minimal grid",
      judgments: [{ identity: { "Style Category": "Minimalism" }, grade: 2 }],
    };
    return {
      schemaVersion: 1,
      globalNegativeApplicability: { domains: ["style"], stacks: [] },
      cases: Array.from({ length: 60 }, (_, index) => ({ ...structuredClone(base), id: `case-${index}` })),
    };
  };

  test("valid schema", () => {
    expect(validateFixture(validFixture(), ["style"], [])).toEqual([]);
  });

  test("rejects bad count, duplicate id and grade", () => {
    const fixture = validFixture();
    fixture.cases = fixture.cases.slice(0, 2);
    fixture.cases[1]!.id = fixture.cases[0]!.id;
    fixture.cases[0]!.judgments[0]!.grade = 3;
    const errors = validateFixture(fixture, ["style"], []).join("\n");
    expect(errors).toContain("60-100");
    expect(errors).toContain("duplicate case id");
    expect(errors).toContain("grade 1 or 2");
  });
});

describe("threshold gate", () => {
  test("runtime fingerprint binds the reasoning contract", async () => {
    const root = await scratchDir("fingerprint");
    const scriptsDir = join(root, "scripts");
    const dataDir = join(root, "data");
    for (const name of RUNTIME_FILES) await Bun.write(join(scriptsDir, name), name);
    await Bun.write(join(dataDir, "styles.csv"), "No,Style\n1,Test\n");
    const before = await runtimeFingerprint({ root, scriptsDir, dataDir });
    await Bun.write(join(scriptsDir, "reasoning-contract.ts"), "changed");
    expect(await runtimeFingerprint({ root, scriptsDir, dataDir })).not.toBe(before);
  });

  test("oracle fingerprint hashes the selected cases file", async () => {
    const canonical = join(FIXTURE_DIR, "relevance-cases.json");
    const selected = join(await scratchDir("oracle"), "cases.json");
    const bytes = new Uint8Array(await Bun.file(canonical).arrayBuffer());
    await Bun.write(selected, bytes);
    expect(await oracleFingerprint(selected)).toBe(await oracleFingerprint(canonical));
    await Bun.write(selected, new Uint8Array([...bytes, 0x20]));
    expect(await oracleFingerprint(selected)).not.toBe(await oracleFingerprint(canonical));
  });

  test("metric, sample and locked-case failures are actionable", () => {
    const report = {
      metrics: { precisionAt1: 0.5 },
      samples: { retrieval: 1 },
      cases: [{ id: "locked", grades: [0], actual: [{ "Style Category": "Wrong" }] }],
      splits: { calibration: { metrics: {}, samples: {} }, held_out: { metrics: {}, samples: {} } },
    };
    const manifest = {
      metrics: { precisionAt1: { floor: 0.8, tolerance: 0.01 } },
      sampleMinimums: { retrieval: 2 },
      lockedCases: { locked: { withinTop: 1, minimumGrade: 2 } },
      splits: { calibration: { metrics: {}, sampleMinimums: {} }, held_out: { metrics: {}, sampleMinimums: {} } },
    };
    const failures = checkThresholds(report, manifest);
    expect(failures).toHaveLength(3);
    expect(failures.some((failure) => failure.includes("Wrong"))).toBe(true);
  });

  test("manifest rejects missing contract sections", () => {
    const errors = validateManifest({}, "fingerprint");
    expect(errors.some((error) => error.includes("missing sections"))).toBe(true);
    expect(errors.some((error) => error.includes("missing metrics"))).toBe(true);
  });

  const manifestWith = (overrides: object) => ({
    schemaVersion: 1,
    status: "approved",
    approvingMaintainer: "maintainer",
    units: "ratios",
    splitPolicy: {},
    runtimeFingerprint: "runtime",
    oracleFingerprint: "oracle",
    baselineRevision: "97eb2a2",
    metrics: Object.fromEntries([...REQUIRED_METRICS].map((name) => [name, { floor: 0 }])),
    sampleMinimums: { cases: 1 },
    lockedCases: { case: {} },
    splits: Object.fromEntries(
      ["calibration", "held_out"].map((split) => [split, { metrics: Object.fromEntries([...REQUIRED_METRICS].map((name) => [name, { floor: 0 }])), sampleMinimums: { cases: 1 } }]),
    ),
    ...overrides,
  });

  test("manifest rejects non-finite and invalid sample values", () => {
    const manifest = manifestWith({
      metrics: Object.fromEntries([...REQUIRED_METRICS].map((name) => [name, { floor: Number.NaN }])),
      sampleMinimums: { cases: true },
    });
    const errors = validateManifest(manifest, "runtime", "oracle");
    expect(errors.some((error) => error.includes("finite"))).toBe(true);
    expect(errors.some((error) => error.includes("non-negative integer"))).toBe(true);
  });

  test("manifest binds the oracle and validates the baseline revision", () => {
    const errors = validateManifest(manifestWith({ oracleFingerprint: "wrong", baselineRevision: "not-a-revision" }), "runtime", "expected");
    expect(errors.some((error) => error.includes("oracleFingerprint"))).toBe(true);
    expect(errors.some((error) => error.includes("baselineRevision"))).toBe(true);
  });
});
