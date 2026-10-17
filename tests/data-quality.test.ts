/** Semantic quality contracts for the core UI/UX datasets (ported from test_core_data_quality.py). */
import { describe, expect, test } from "bun:test";
import { search } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import {
  CHART_NON_COLOR_GUIDANCE,
  CHART_RISKS,
  CHART_TEXT_FALLBACK,
  checkChartContract,
  checkIconContract,
  checkTypographyContract,
  COLOR_CONTRAST_PAIRS,
  configuredFontNames,
  contrastRatio,
  CSS_IMPORT,
  fontFamilies,
  fontNames,
  ICON_CONTEXTS,
  ICON_ROLES,
  ICON_USAGE_REQUIREMENTS,
  WCAG_GRADE,
} from "../.claude/skills/ui-ux-pro-max/scripts/validate-data.ts";
import { casefold, readRows } from "./helpers.ts";

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((value) => b.has(value));

describe("semantic colors", () => {
  test("declared text and UI pairs meet role thresholds", async () => {
    for (const row of await readRows("colors.csv")) {
      for (const [foreground, [background, role, minimum]] of Object.entries(COLOR_CONTRAST_PAIRS)) {
        const ratio = contrastRatio(row[foreground]!, row[background]!);
        expect({ product: row["Product Type"], role, pass: ratio >= minimum }).toEqual({ product: row["Product Type"], role, pass: true });
      }
    }
  });

  test("destructive tokens are not success green", async () => {
    for (const row of await readRows("colors.csv")) {
      const value = row.Destructive!.replace(/^#/, "");
      const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
      expect([row["Product Type"], green > red * 1.1 && green > blue * 1.1]).toEqual([row["Product Type"], false]);
    }
  });
});

describe("accessibility guidance", () => {
  test("WCAG 2.2 topics have explicit rows and are retrievable", async () => {
    const rows = await readRows("ux-guidelines.csv");
    const expectedPlatforms: Record<string, string> = {
      "Focus Not Obscured (Minimum)": "Web",
      "Focus Not Obscured (Enhanced)": "Web",
      "Focus Appearance": "Web",
      "Dragging Movements": "All",
      "Target Size (Minimum)": "Web",
      "Consistent Help": "All",
      "Redundant Entry": "All",
      "Accessible Authentication (Minimum)": "All",
      "Auto-Rotating Content Controls": "All",
    };
    const issues = new Set(rows.map((row) => row.Issue!));
    expect(isSubset(new Set(Object.keys(expectedPlatforms)), issues)).toBe(true);
    for (const [issue, platform] of Object.entries(expectedPlatforms)) {
      const row = rows.find((candidate) => candidate.Issue === issue)!;
      expect(row.Platform).toBe(platform);
      expect(["Medium", "High", "Critical"]).toContain(row.Severity!);
      expect(row.Do).not.toBe(row.Description!);
      const result = await search(issue, "ux", 3);
      expect([issue, result.results!.some((hit) => hit.Issue === issue)]).toEqual([issue, true]);
    }
  });

  test("native and web target sizes remain distinct", async () => {
    const native = (await readRows("app-interface.csv")).find((row) => row.Issue === "Touch Target Size")!;
    const web = (await readRows("ux-guidelines.csv")).find((row) => row.Issue === "Target Size (Minimum)")!;
    const nativeText = Object.values(native).join(" ");
    expect(nativeText).toContain("44pt");
    expect(nativeText).toContain("48dp");
    expect(Object.values(web).join(" ")).toContain("24 CSS px");
  });

  test("motion recipes offer reduced motion or user control", async () => {
    for (const row of await readRows("motion.csv")) {
      const text = casefold(Object.values(row).join(" "));
      expect([row.No, text.includes("reduced-motion") || text.includes("user-controlled")]).toEqual([row.No, true]);
    }
  });
});

describe("charts, typography and icons", () => {
  test("mutated accessibility and import contracts fail", async () => {
    const chart = { ...(await readRows("charts.csv"))[0]!, "A11y Fallback": "A visible table is available." };
    const typography = {
      ...(await readRows("typography.csv"))[0]!,
      "CSS Import": "@import url('https://fonts.googleapis.com/css2?family=Comic+Sans');",
    };
    const base = (await readRows("typography.csv"))[0]!;
    const missingWeight = { ...base, Notes: `${base.Notes} Recommended weight 900.` };
    const icon = { ...(await readRows("icons.csv"))[0]!, "Import Code": "import { IconName } from '@phosphor-icons/react'" };
    const mutations: [(rows: any[], problems: string[]) => void, object, string][] = [
      [checkChartContract, chart, "keyboard"],
      [checkTypographyContract, typography, "differ"],
      [checkTypographyContract, missingWeight, "weights"],
      [checkIconContract, icon, "import"],
    ];
    for (const [checker, row, expected] of mutations) {
      const problems: string[] = [];
      checker([row], problems);
      expect([checker.name, problems.some((problem) => problem.includes(expected))]).toEqual([checker.name, true]);
    }
  });

  test("chart risk is not a conformance grade", async () => {
    for (const row of await readRows("charts.csv")) {
      expect(CHART_RISKS.has(row["Accessibility Risk"]!)).toBe(true);
      expect(row["Accessibility Grade"]).toBe("deprecated: use Accessibility Risk");
      const text = `${row["Accessibility Notes"]} ${row["A11y Fallback"]}`;
      expect(WCAG_GRADE.test(text)).toBe(false);
      expect(CHART_TEXT_FALLBACK.test(casefold(text))).toBe(true);
      expect(CHART_NON_COLOR_GUIDANCE.test(casefold(text))).toBe(true);
      expect(casefold(text)).toContain("keyboard");
    }
  });

  test("named fonts match Google import, CSS import and Tailwind config", async () => {
    for (const row of await readRows("typography.csv")) {
      const urlFamilies = fontFamilies(row["Google Fonts URL"]!);
      const named = new Set([row["Heading Font"]!, row["Body Font"]!]);
      expect([row["Font Pairing Name"], isSubset(named, fontNames(urlFamilies)), isSubset(named, configuredFontNames(row["Tailwind Config"]!))]).toEqual([
        row["Font Pairing Name"],
        true,
        true,
      ]);
      const match = CSS_IMPORT.exec(row["CSS Import"]!);
      expect(match).not.toBeNull();
      expect([...urlFamilies].sort()).toEqual([...fontFamilies(match![2]!)].sort());
    }
  });

  test("icon semantics are explicit and imports are concrete", async () => {
    for (const row of await readRows("icons.csv")) {
      expect(ICON_ROLES.has(row["Semantic Role"]!)).toBe(true);
      expect(new Set(row["Allowed Contexts"]!.split("|"))).toEqual(ICON_CONTEXTS);
      expect(row.Usage).not.toMatch(/[㐀-鿿]/);
      expect(row["Import Code"]).not.toContain("IconName");
      for (const requirement of ICON_USAGE_REQUIREMENTS) expect(casefold(row.Usage!)).toMatch(requirement);
    }
  });

  test("natural accessibility queries are retrievable", async () => {
    const cases: Record<string, [string, string]> = {
      chart: ["keyboard accessible chart", "keyboard"],
      landing: ["accessible drag interaction", "keyboard controls"],
      icons: ["decorative icon aria hidden", "aria-hidden"],
      gsap: ["stop animation offscreen", "visibility"],
      ux: ["error summary validation", "error summary"],
    };
    for (const [domain, [query, expected]] of Object.entries(cases)) {
      const result = await search(query, domain, 3);
      expect(result.count).toBeGreaterThan(0);
      expect(casefold(Object.values(result.results![0]!).join(" "))).toContain(casefold(expected));
    }
  });
});

test("effect event is scoped and community useLatest is removed", async () => {
  const rows = await readRows("react-performance.csv");
  const text = casefold(Object.values(rows.find((row) => row.Issue === "Effect Events")!).join(" "));
  expect(text).toContain("inside effects");
  expect(text).toContain("dependencies");
  expect(rows.some((row) => casefold(Object.values(row).join(" ")).includes("uselatest"))).toBe(false);
});
