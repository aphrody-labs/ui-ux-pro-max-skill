/** Cross-file semantic contracts for curated design data (ported from test_data_contracts.py). */
import { describe, expect, test, afterAll } from "bun:test";
import { join } from "node:path";
import { AVAILABLE_STACKS, search, STACK_CONFIG } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { DesignSystemGenerator } from "../.claude/skills/ui-ux-pro-max/scripts/design-system.ts";
import { applyDecisionRules, parseDecisionRules } from "../.claude/skills/ui-ux-pro-max/scripts/reasoning-contract.ts";
import {
  checkCatalogSummary,
  checkFontCatalog,
  checkPhosphorCatalog,
  checkProvenance,
  checkReasoningContract,
  validate,
  validDatasetSourceKey,
} from "../.claude/skills/ui-ux-pro-max/scripts/validate-data.ts";
import { DATA_DIR, readJson, readRows, cleanScratch, scratchDir } from "./helpers.ts";

afterAll(cleanScratch);

const split = (value: string, delimiter: string) => value.split(delimiter).map((part) => part.trim()).filter(Boolean);
const clone = <T>(value: T): T => structuredClone(value);

describe("style identity contract", () => {
  test("ids, aliases, status and parents are unambiguous", async () => {
    const styles = await readRows("styles.csv");
    const ids = new Set(styles.map((row) => row["Style ID"]!));
    expect(ids.size).toBe(styles.length);
    const aliases = new Map<string, string>();
    for (const row of styles) {
      const styleId = row["Style ID"]!;
      expect(styleId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(["active", "supplemental", "deprecated"]).toContain(row.Status!);
      const parent = row["Parent Style ID"]!;
      if (parent) {
        expect(ids.has(parent)).toBe(true);
        expect(parent).not.toBe(styleId);
      }
      if (row.Status === "supplemental") expect(parent).toBeTruthy();
      if (row.Status === "deprecated") expect(!!parent).not.toBe(!!(row["Replacement Domain"] && row["Replacement ID"]));
      for (const alias of split(row.Aliases!, "|")) {
        expect(aliases.has(alias.toLowerCase())).toBe(false);
        aliases.set(alias.toLowerCase(), styleId);
      }
    }
  });

  test("every product and reasoning style reference resolves", async () => {
    const lookup = new Set<string>();
    for (const row of await readRows("styles.csv")) {
      for (const identity of [row["Style ID"]!, row["Style Category"]!, ...split(row.Aliases!, "|")]) lookup.add(identity.toLowerCase());
    }
    const references: string[] = [];
    for (const row of await readRows("products.csv")) references.push(...split(row["Primary Style Recommendation"]!, "+"), ...split(row["Secondary Styles"]!, ","));
    for (const row of await readRows("ui-reasoning.csv")) references.push(...split(row.Style_Priority!, "+"));
    expect([...new Set(references.filter((reference) => !lookup.has(reference.toLowerCase())))].sort()).toEqual([]);
  });
});

describe("reasoning contract", () => {
  test("known product sets match exactly", async () => {
    const products = await readRows("products.csv");
    const colors = await readRows("colors.csv");
    const reasoning = await readRows("ui-reasoning.csv");
    expect([products.length, colors.length, reasoning.length]).toEqual([192, 192, 192]);
    const names = new Set(products.map((row) => row["Product Type"]!));
    expect(new Set(colors.map((row) => row["Product Type"]!))).toEqual(names);
    expect(new Set(reasoning.map((row) => row.UI_Category!))).toEqual(names);
    expect(names.size).toBe(192);
  });

  test("decision rules use closed array grammar", async () => {
    for (const row of await readRows("ui-reasoning.csv")) {
      for (const actions of parseDecisionRules(row.Decision_Rules!).values()) expect(Array.isArray(actions)).toBe(true);
    }
  });

  test("duplicate, unknown keys and unknown actions fail closed", () => {
    for (const raw of [
      '{"must_have":["constraint:first"],"must_have":["constraint:second"]}',
      '{"if_not_supported":["constraint:test"]}',
      '{"must_have":["execute:arbitrary"]}',
      '{"must_have":[["constraint:nested"]]}',
      '{"must_have":[{"constraint":"nested"}]}',
    ]) {
      expect(() => parseDecisionRules(raw)).toThrow();
    }
  });

  test("must_have and explicit signals are applied and reported", () => {
    const rules = parseDecisionRules('{"must_have":["constraint:keyboard-navigation"],"if_mobile":["constraint:optimize-touch-targets"]}');
    const desktop = applyDecisionRules(rules, "accessible government portal");
    const mobile = applyDecisionRules(rules, "accessible mobile government portal");
    expect(desktop.constraints).toEqual(["keyboard-navigation"]);
    expect(mobile.constraints).toEqual(["keyboard-navigation", "optimize-touch-targets"]);
    expect(mobile.activated.map((item) => item.condition)).toEqual(["must_have", "if_mobile"]);
  });

  test("generator matches reasoning exactly and defaults only for unknown", async () => {
    const generator = await DesignSystemGenerator.create();
    for (const row of await readRows("products.csv")) expect(generator.findReasoningRule(row["Product Type"]!).UI_Category).toBe(row["Product Type"]!);
    expect(generator.findReasoningRule("Government")).toEqual({});
    expect(generator.applyReasoning("External Unknown", "unknown").is_default).toBe(true);
  });

  test("reasoning patterns reference landing identities", async () => {
    const patterns = new Set<string>();
    for (const row of await readRows("landing.csv")) {
      patterns.add(row["Pattern Name"]!);
      for (const alias of row.Aliases!.split("|")) if (alias) patterns.add(alias);
    }
    const reasoning = await readRows("ui-reasoning.csv");
    expect(reasoning).toHaveLength(192);
    for (const row of reasoning) expect([row.UI_Category, patterns.has(row.Recommended_Pattern!)]).toEqual([row.UI_Category, true]);
  });

  test("every known product generates a traceable landing pattern and resolves to itself", async () => {
    const generator = await DesignSystemGenerator.create();
    const patterns = new Set((await readRows("landing.csv")).map((row) => row["Pattern Name"]!));
    for (const row of await readRows("products.csv")) {
      const category = row["Product Type"]!;
      const result = await generator.generate(category);
      expect([category, patterns.has(result.source_identities.landing ?? "")]).toEqual([category, true]);
      const reasoning = generator.applyReasoning(category, category);
      const expected = reasoning.style_priority.map((priority) => generator.resolveStyle(priority)["Style ID"]).filter(Boolean);
      expect(result.category).toBe(category);
      expect(result.reasoning_default).toBe(false);
      expect(expected.length).toBeGreaterThan(0);
      expect([category, result.style.id]).toEqual([category, expected[0]!]);
    }
  }, 120_000);

  test("representative new products generate traceable sources", async () => {
    const generator = await DesignSystemGenerator.create();
    const styles = new Set((await readRows("styles.csv")).map((row) => row["Style ID"]!));
    const colors = new Set((await readRows("colors.csv")).map((row) => row["Product Type"]!));
    const typography = new Set((await readRows("typography.csv")).map((row) => row["Font Pairing Name"]!));
    const patterns = new Set((await readRows("landing.csv")).map((row) => row["Pattern Name"]!));
    const cases: Record<string, string> = {
      "government grant portal accessible trustworthy": "Grant / Funding Portal",
      "API developer portal documentation": "API Developer Portal",
      "academic journal scholarly publishing accessible": "Academic Journal / Scholarly Publishing",
      "patient portal mobile secure": "Patient Portal / Health Records",
      "status page outage monitoring": "Status Page / Incident Management",
    };
    for (const [query, category] of Object.entries(cases)) {
      const result = await generator.generate(query);
      const sources = result.source_identities;
      expect(result.category).toBe(category);
      expect(result.reasoning_default).toBe(false);
      expect(sources.product).toBe(category);
      expect(sources.reasoning).toBe(category);
      expect(styles.has(sources.style ?? "")).toBe(true);
      expect(colors.has(sources.color ?? "")).toBe(true);
      expect(typography.has(sources.typography ?? "")).toBe(true);
      expect(patterns.has(sources.landing ?? "")).toBe(true);
    }
  });

  test("constraints reach domain queries", async () => {
    const generator = await DesignSystemGenerator.create();
    const reasoning = {
      ...generator.applyReasoning("External Unknown", "public portal"),
      pattern: "Unmapped Pattern",
      color_mood: "Trustworthy",
      typography_mood: "Readable",
      constraints: ["keyboard-navigation", "touch-targets"],
    };
    const results = await generator.multiDomainSearch("public portal", "Government Portal", reasoning, ["Minimalism"]);
    // The constraint text must be part of each query: domains echo their query back.
    for (const domain of ["style", "color", "typography", "landing"]) expect([domain, results[domain]!.query]).toEqual([domain, expect.stringContaining("keyboard navigation")]);
  });

  test("canonical style priority is not limited to the BM25 top three", async () => {
    const generator = await DesignSystemGenerator.create();
    const unrelated = [generator.resolveStyle("Kinetic Brutalism (Mobile)"), generator.resolveStyle("Glassmorphism")];
    expect(generator.selectBestMatch(unrelated, ["Brutalism"])["Style ID"]).toBe("brutalism");
  });

  test("duplicate semantic reasoning labels fail validation", () => {
    const product = { "Product Type": "Duplicate" };
    const reasoning = { UI_Category: "Duplicate", Decision_Rules: "{}", Confidence: "" };
    const problems: string[] = [];
    checkReasoningContract([product, { ...product }], [{ ...product }, { ...product }], [reasoning, { ...reasoning }], new Set(), new Set(), problems);
    expect(problems.some((problem) => problem.toLowerCase().includes("duplicate"))).toBe(true);
  });

  test("style aliases have one exact owner", async () => {
    const generator = await DesignSystemGenerator.create();
    expect(generator.resolveStyle("Minimalism")["Style ID"]).toBe("minimalism-and-swiss-style");
    expect(generator.resolveStyle("Clean Science")).toEqual({});
    expect(generator.resolveStyle("Holographic/HUD")["Style ID"]).toBe("hud-sci-fi-fui");
  });
});

describe("landing and stack contract", () => {
  test("landing sections use one delimiter", async () => {
    for (const row of await readRows("landing.csv")) {
      const sections = row["Section Order"]!.split(" > ");
      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections.every((section) => section.trim())).toBe(true);
      expect(sections.some((section) => /^\d+\.\s/.test(section))).toBe(false);
    }
  });

  test("stack schema is additive and uniform", async () => {
    for (const stack of AVAILABLE_STACKS) {
      const text = await Bun.file(join(DATA_DIR, STACK_CONFIG[stack]!.file)).text();
      const header = text.split("\n")[0]!;
      for (const field of ["Applies To", "Status", "Verified At"]) expect([stack, header.includes(field)]).toEqual([stack, true]);
      for (const row of await readRows(STACK_CONFIG[stack]!.file)) expect(["active", "supplemental", "deprecated", "unverified"]).toContain(row.Status!);
    }
  });

  test("provenance sidecar has stable shape", async () => {
    const payload = await readJson("data-provenance.json");
    expect(payload.schemaVersion).toBe(1);
    expect(Array.isArray(payload.records)).toBe(true);
    for (const record of payload.records) {
      for (const key of ["entityKind", "entityId", "sourceFile", "status", "verifiedAt", "sources"]) expect(record).toHaveProperty(key);
      const types = new Set(record.sources.map((source: any) => source.type));
      if ([...types].every((type) => type === "derived")) expect(record.sla).toBe("needs-review");
    }
  });

  test("provenance rejects bad shapes, enums and hosts without crashing", async () => {
    const canonical = await readJson("data-provenance.json");
    const cases: string[] = [JSON.stringify([]), "null", JSON.stringify("invalid")];
    const malformedRecord = clone(canonical);
    malformedRecord.records.push(null);
    cases.push(JSON.stringify(malformedRecord));
    const malformedSource = clone(canonical);
    malformedSource.records[0].sources = [null];
    cases.push(JSON.stringify(malformedSource));
    const unapproved = clone(canonical);
    const official = unapproved.records.find((record: any) => record.sources.some((source: any) => source.type === "official"));
    official.sources = [{ type: "official", ref: "https://evil.example/fake" }];
    cases.push(JSON.stringify(unapproved));
    const invalidEnums = clone(canonical);
    Object.assign(invalidEnums.records[0], { status: "invented", sla: "whenever", confidence: "__NAN__" });
    cases.push(JSON.stringify(invalidEnums).replace('"__NAN__"', "NaN"));
    const reasoning = await readRows("ui-reasoning.csv");
    const styles = await readRows("styles.csv");
    for (const [index, payload] of cases.entries()) {
      const path = join(await scratchDir(`provenance-${index}`), "data-provenance.json");
      await Bun.write(path, payload);
      const problems: string[] = [];
      await checkProvenance(reasoning, styles, problems, path);
      expect([index, problems.length > 0]).toEqual([index, true]);
    }
  });

  test("dataset provenance scope binds real rows and fields", async () => {
    let problems: string[] = [];
    expect(await validDatasetSourceKey("colors.csv", { Scope: "No 1-192; Notes field" }, "valid", problems)).toBe(true);
    expect(problems).toEqual([]);
    problems = [];
    expect(await validDatasetSourceKey("stacks/html-tailwind.csv", { Scope: "No 57-59; Guideline field" }, "valid-stack", problems)).toBe(true);
    expect(problems).toEqual([]);
    for (const [file, key] of [
      ["unknown.csv", { Scope: "No 1; Notes field" }],
      ["colors.csv", { Scope: "No 999; Notes field" }],
      ["colors.csv", { Scope: "No 1; Invented Field" }],
    ] as const) {
      const local: string[] = [];
      expect(await validDatasetSourceKey(file, key, "bad", local)).toBe(false);
      expect(local.length).toBeGreaterThan(0);
    }
  });
});

describe("generated catalog contract", () => {
  test("canonical catalogs and provenance are release ready", async () => {
    expect((await validate()).filter((problem) => problem.includes("catalog"))).toEqual([]);
  });

  test("font license and typography drift fail closed", async () => {
    const fonts = await readRows("google-fonts.csv");
    const typography = await readRows("typography.csv");
    const licenses = await readJson("google-font-licenses.json");
    licenses.families[0].license = "UNKNOWN";
    let problems: string[] = [];
    checkFontCatalog(fonts, licenses, typography, problems);
    expect(problems.some((problem) => problem.includes("invalid active family"))).toBe(true);

    const missingFont = clone(typography);
    missingFont[0]!["Google Fonts URL"] = "https://fonts.googleapis.com/css2?family=Invented+Sans:wght@400";
    problems = [];
    checkFontCatalog(fonts, await readJson("google-font-licenses.json"), missingFont, problems);
    expect(problems.some((problem) => problem.includes("absent from approved catalog"))).toBe(true);
  });

  test("font source revision and exclusion policy fail closed", async () => {
    const fonts = await readRows("google-fonts.csv");
    const typography = await readRows("typography.csv");
    const licenses = await readJson("google-font-licenses.json");
    licenses.excludedFamilies[0].source = "https://github.com/google/fonts";
    let problems: string[] = [];
    checkFontCatalog(fonts, licenses, typography, problems);
    expect(problems.some((problem) => problem.includes("invalid exclusion"))).toBe(false);
    licenses.excludedFamilies[0].source = "https://github.com/other/fonts";
    licenses.source.revision = "main";
    problems = [];
    checkFontCatalog(fonts, licenses, typography, problems);
    expect(problems.some((problem) => problem.includes("invalid exclusion"))).toBe(true);
    expect(problems.some((problem) => problem.includes("invalid source revision"))).toBe(true);
  });

  test("curated icon and summary drift fail closed", async () => {
    const manifest = await readJson("phosphor-icons-upstream.json");
    manifest.icons[0].clientImport = 'import { Wrong } from "@phosphor-icons/react"';
    let problems: string[] = [];
    checkPhosphorCatalog(await readRows("icons.csv"), manifest, problems);
    expect(problems.some((problem) => problem.includes("invalid identity or imports"))).toBe(true);

    const summary = await readJson("catalog-summary.json");
    summary.counts.googleFonts -= 1;
    problems = [];
    await checkCatalogSummary(summary, await readJson("google-font-licenses.json"), await readJson("phosphor-icons-upstream.json"), problems);
    expect(problems.some((problem) => problem.includes("stale count for googleFonts"))).toBe(true);
  });
});

test("search remains importable alongside the validator", async () => {
  expect((await search("minimalism", "style", 1)).count).toBeGreaterThan(0);
});
