/**
 * RTL support contracts: rtl_level data, --rtl filtering, and CLI wiring (port of upstream
 * scripts/tests/test_rtl_support.py). The filter must run after BM25 scoring and before
 * max_results truncation, otherwise `--rtl=full -n 1` can report zero results while compatible
 * rows exist.
 */
import { describe, expect, test } from "bun:test";
import { CSV_CONFIG, RTL_LEVELS, search } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { readRows, runBun, SEARCH_SCRIPT } from "./helpers.ts";

const RTL_COLUMN = "rtl_level";
const RTL_DOMAINS = ["style", "product"] as const;
const identity = (row: Record<string, string>) => row["Style ID"] || row["Product Type"];

describe("rtl data contract", () => {
  test("both domains declare rtl_level as output metadata, never as a search column", () => {
    for (const domain of RTL_DOMAINS) {
      expect(CSV_CONFIG[domain].outputCols).toContain(RTL_COLUMN);
      expect(CSV_CONFIG[domain].searchCols).not.toContain(RTL_COLUMN);
    }
  });

  test("every row declares a supported rtl level", async () => {
    for (const name of ["styles.csv", "products.csv"]) {
      const rows = await readRows(name);
      expect(rows.length).toBeGreaterThan(0);
      expect([name, rows.filter((row) => !row[RTL_COLUMN]).map((row) => row.No)]).toEqual([name, []]);
      const invalid = [...new Set(rows.map((row) => row[RTL_COLUMN]).filter((level) => level && !(RTL_LEVELS as readonly string[]).includes(level)))];
      expect([name, invalid]).toEqual([name, []]);
    }
  });

  test("known layouts keep their expected level", async () => {
    const styles = new Map((await readRows("styles.csv")).map((row) => [row["Style ID"], row[RTL_COLUMN]]));
    for (const [id, level] of Object.entries({
      "minimalism-and-swiss-style": "full",
      "data-dense-dashboard": "partial",
      "kinetic-typography": "caveats",
      "terminal-cli-mobile": "caveats",
      "editorial-grid-magazine": "caveats",
      "fluent-2": "full",
    }))
      expect([id, styles.get(id)]).toEqual([id, level]);
    const products = new Map((await readRows("products.csv")).map((row) => [row["Product Type"], row[RTL_COLUMN]]));
    for (const [type, level] of Object.entries({
      "Hotel/Hospitality": "full",
      "Financial Dashboard": "partial",
      "Developer Tool / IDE": "caveats",
      "Calendar & Scheduling App": "caveats",
    }))
      expect([type, products.get(type)]).toEqual([type, level]);
  });
});

describe("rtl filter", () => {
  test("rtl all returns results for every level", async () => {
    const result = await search("mobile", "style", 20, false, "all");
    expect(result.count).toBeGreaterThan(0);
    expect(new Set(result.results!.map((row) => row[RTL_COLUMN])).size).toBeGreaterThan(1);
  });

  test("rtl_level is projected into results", async () => {
    const result = await search("dashboard", "style", 1, false, "partial");
    expect(result.count).toBe(1);
    expect(result.results![0]![RTL_COLUMN]).toBe("partial");
    expect((await search("dashboard", "style", 1)).results![0]).toHaveProperty(RTL_COLUMN);
  });

  test("a level filter keeps only rows of that level in the CSV", async () => {
    for (const [domain, query] of [
      ["style", "mobile"],
      ["product", "hotel"],
    ] as const) {
      const rows = await readRows(CSV_CONFIG[domain].file);
      for (const level of RTL_LEVELS) {
        const expected = new Set(rows.filter((row) => row[RTL_COLUMN] === level).map(identity));
        for (const row of (await search(query, domain, 20, false, level)).results ?? []) {
          expect(row[RTL_COLUMN]).toBe(level);
          expect(expected.has(identity(row))).toBe(true);
        }
      }
    }
  });

  test("the filter runs before result truncation", async () => {
    expect((await search("saas", "product", 1)).results![0]![RTL_COLUMN]).toBe("partial");
    const filtered = await search("saas", "product", 1, false, "full");
    expect(filtered.count).toBe(1);
    expect(filtered.results![0]![RTL_COLUMN]).toBe("full");
  });

  test("omitting rtl keeps the previous ranking", async () => {
    const ids = async (rtl: string | null) => ((await search("mobile", "style", 3, false, rtl)).results ?? []).map((row) => row["Style ID"]);
    expect(await ids("all")).toEqual(await ids(null));
  });

  test("rtl rejects domains without the column", async () => {
    for (const domain of ["color", "ux", "typography", "chart", null]) expect(search("blue", domain, 3, false, "full")).rejects.toThrow();
  });
});

describe("rtl cli", () => {
  test("--rtl=full filters JSON results", () => {
    const { exitCode: code, stdout, stderr } = runBun([SEARCH_SCRIPT, "saas", "--domain", "product", "--rtl=full", "-n", "1", "--json"]);
    expect([code, stderr]).toEqual([0, ""]);
    const payload = JSON.parse(stdout);
    expect(payload.count).toBe(1);
    expect(payload.results[0][RTL_COLUMN]).toBe("full");
  });

  test("--rtl without a value accepts every level", () => {
    const { exitCode: code, stdout } = runBun([SEARCH_SCRIPT, "mobile", "--domain", "style", "--rtl", "-n", "20", "--json"]);
    expect(code).toBe(0);
    expect(new Set(JSON.parse(stdout).results.map((row: Record<string, string>) => row[RTL_COLUMN])).size).toBeGreaterThan(1);
  });

  test("--rtl rejects an unsupported domain, --stack and --design-system", () => {
    const color = runBun([SEARCH_SCRIPT, "blue", "--domain", "color", "--rtl", "--json"]);
    expect(color.exitCode).not.toBe(0);
    expect(color.stderr).toContain("style");
    expect(color.stderr).toContain("product");
    expect(runBun([SEARCH_SCRIPT, "form", "--stack", "react", "--rtl"]).exitCode).toBe(2);
    expect(runBun([SEARCH_SCRIPT, "saas", "--design-system", "--rtl=full"]).exitCode).toBe(2);
  });
});
