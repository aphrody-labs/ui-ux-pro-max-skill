/** Public style taxonomy and search contract (ported from test_style_taxonomy.py). */
import { describe, expect, test } from "bun:test";
import { search } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { styleIsDarkPrimary } from "../.claude/skills/ui-ux-pro-max/scripts/design-system.ts";
import { readJson, readRows } from "./helpers.ts";

const styles = await readRows("styles.csv");
const byId = new Map(styles.map((row) => [row["Style ID"]!, row]));
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

describe("style taxonomy", () => {
  test("curated state distribution is explicit", () => {
    const counts = Object.fromEntries(["active", "supplemental", "deprecated"].map((status) => [status, styles.filter((row) => row.Status === status).length]));
    expect(counts).toEqual({ active: 50, supplemental: 29, deprecated: 9 });
  });

  test("every style name and alias has a deterministic destination", async () => {
    for (const row of styles) {
      for (const query of [row["Style Category"]!, ...row.Aliases!.split("|").filter(Boolean)]) {
        const result = await search(query, null, 1);
        if (row.Status === "deprecated" && row["Replacement Domain"] === "landing") {
          expect(result.count).toBe(0);
          expect(result.redirect).toEqual({ domain: row["Replacement Domain"]!, id: row["Replacement ID"]! });
        } else {
          const expected = row.Status === "deprecated" ? row["Replacement ID"] : row["Style ID"];
          expect([query, result.results?.[0]?.["Style ID"]]).toEqual([query, expected]);
        }
      }
    }
  });

  test("deprecated rows never appear in generic results", async () => {
    for (const query of ["modern interface", "marketing page", "trust design"]) {
      const statuses = new Set((await search(query, "style", 20)).results!.map((row) => row.Status));
      expect([...statuses].every((status) => status === "active")).toBe(true);
    }
  });

  test("style arbitration does not steal product intent", async () => {
    expect((await search("design a financial dashboard for my bank", null, 1)).domain).toBe("product");
  });

  test("family variants and mobile intent remain distinct", async () => {
    const parents: Record<string, string> = {
      "gradient-mesh-aurora-evolved": "aurora-ui",
      "swiss-modernism-2-0": "minimalism-and-swiss-style",
      "neumorphism-mobile": "neumorphism",
      "claymorphism-mobile": "claymorphism",
      "spectrum-2": "spectrum-design-system",
    };
    for (const [id, parent] of Object.entries(parents)) {
      expect(byId.get(id)!["Parent Style ID"]).toBe(parent);
      expect(["supplemental", "deprecated"]).toContain(byId.get(id)!.Status!);
    }
    expect(byId.get("bento-grids")!["Replacement Domain"]).toBe("style");
    expect(byId.get("bento-grids")!["Replacement ID"]).toBe("bento-box-grid");
    const top = async (query: string) => (await search(query, "style", 1)).results![0]!["Style ID"];
    expect(await top("Neumorphism (Mobile)")).toBe("neumorphism-mobile");
    expect(await top("Claymorphism (Mobile)")).toBe("claymorphism-mobile");
    expect(await top("M3 Expressive")).toBe("material-you-md3-mobile");
    expect(await top("mobile neumorphism UI")).toBe("neumorphism-mobile");
    expect(await top("mobile app with claymorphism")).toBe("claymorphism-mobile");
    expect(await top("design system for Spectrum 2")).toBe("spectrum-2");
  });

  test("claim fields use controlled non-guarantee language", () => {
    for (const row of styles) {
      expect(["cost:low", "cost:moderate", "cost:high"]).toContain(row.Performance!.split("|")[0]!);
      expect(["risk:low", "risk:conditional", "risk:high"]).toContain(row.Accessibility!.split("|")[0]!);
      expect(["supported", "conditional", "not-recommended"]).toContain(row["Light Mode ✓"]!);
      expect(["supported", "conditional", "not-recommended"]).toContain(row["Dark Mode ✓"]!);
      expect(["auto", "light", "dark"]).toContain(row["Preferred Mode"]!);
      const claim = Object.values(row).join(" ");
      expect(claim).not.toMatch(/\bWCAG\s+A{2,3}\+?\b/i);
      expect(claim).not.toMatch(/\bWCAG\b.{0,40}\b(?:compliant|compliance)\b/i);
      expect(row["Framework Compatibility"]).not.toMatch(/\d+\/10/);
    }
    expect(styleIsDarkPrimary(byId.get("dark-mode-oled"))).toBe(true);
    expect(styleIsDarkPrimary(byId.get("minimalism-and-swiss-style"))).toBe(false);
  });

  test("searchable prompt lengths are balanced", () => {
    const lengths = new Map<string, number[]>();
    for (const row of styles) {
      const length = row["AI Prompt Keywords"]!.split(/\s+/).filter(Boolean).length;
      expect(length).toBeLessThanOrEqual(40);
      lengths.set(row.Type!, [...(lengths.get(row.Type!) ?? []), length]);
    }
    expect(median(lengths.get("Mobile")!)).toBeLessThanOrEqual(median(lengths.get("General")!) * 1.6);
  });

  test("new rows have first-party provenance", async () => {
    const payload = await readJson("data-provenance.json");
    const records = new Map(payload.records.filter((record: any) => record.entityKind === "style").map((record: any) => [record.entityId, record]));
    const newRows = styles.filter((row) => Number(row.No) > 85);
    expect(newRows.length).toBeGreaterThanOrEqual(4);
    for (const row of newRows) {
      const record: any = records.get(row["Style ID"]);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.sources.some((source: any) => source.type === "official")).toBe(true);
    }
  });
});
