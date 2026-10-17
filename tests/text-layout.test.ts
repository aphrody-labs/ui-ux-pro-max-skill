/** Canonical regression contracts for resilient UI text layouts (ported from test_text_layout_resilience.py). */
import { describe, expect, test } from "bun:test";
import { search, searchStack } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { readRows } from "./helpers.ts";

const UX_PHRASES: Record<string, string[]> = {
  "Heading Line Balance": ["progressive visual heuristic", "natural-wrap fallback"],
  "Long Token Wrapping": ["overflow-wrap anywhere", "text children shrink"],
  "Text Reflow and Spacing": ["narrow widths zoom", "content-driven height"],
  "Essential Text Truncation": ["complete access", "visible full-detail path"],
  "Compact Label Semantics": ["badges communicate state", "meaning and ownership"],
  "Chip Collection Reflow": ["filter chips", "operable +n disclosure"],
  "Compact Label Overflow": ["stay whole on one line", "keyboard pointer and touch"],
  "Compact Control Semantics": ["native role", "pressed or selected state"],
  "Contextual Live Badge Updates": ["meaningful contextual status", "atomic status"],
  "Cancellable State Transitions": ["interrupt an in-flight transition", "final semantic state"],
};
const TAILWIND_PHRASES: Record<string, string[]> = {
  "Balanced heading wrapping": ["text-balance", "natural wrapping fallback"],
  "Long token resilience": ["wrap-anywhere", "min-w-0"],
  "Compact label layout": ["flex flex-wrap gap-2", "whitespace-nowrap", "shrink-0"],
};
const text = (row: Record<string, string>) => Object.values(row).join(" ").toLowerCase();

describe("text layout retrieval", () => {
  test("locked queries return the canonical identity first", async () => {
    for (const [query, expected] of [
      ["orphan heading line balance", "Heading Line Balance"],
      ["long url token breaks layout", "Long Token Wrapping"],
      ["badge chip label wraps to second line", "Compact Label Overflow"],
      ["filter chip collection reflow hidden values", "Chip Collection Reflow"],
      ["live badge count screen reader", "Contextual Live Badge Updates"],
      ["rapid chip animation interrupted", "Cancellable State Transitions"],
    ] as const) {
      const result = await search(query, "ux", 3, true);
      expect([query, result.results?.[0]?.Issue]).toEqual([query, expected]);
    }
  });

  test("tailwind query returns compact label layout first", async () => {
    const result = await searchStack("chip badge overflow nowrap", "html-tailwind", 3, true);
    expect(result.results?.[0]?.Guideline).toBe("Compact label layout");
  });
});

describe("text layout data contracts", () => {
  test("new UX rows are unique, sequential and keep critical guidance", async () => {
    const matches = (await readRows("ux-guidelines.csv")).filter((row) => row.Issue! in UX_PHRASES);
    expect(matches).toHaveLength(Object.keys(UX_PHRASES).length);
    expect(new Set(matches.map((row) => row.Issue)).size).toBe(matches.length);
    expect(matches.map((row) => Number(row.No))).toEqual(Array.from({ length: 10 }, (_, index) => 110 + index));
    for (const row of matches) {
      for (const phrase of UX_PHRASES[row.Issue!]!) expect(text(row)).toContain(phrase.toLowerCase());
      expect(["Medium", "High", "Critical"]).toContain(row.Severity!);
    }
  });

  test("new tailwind rows are unique, current and keep required utilities", async () => {
    const matches = (await readRows("stacks/html-tailwind.csv")).filter((row) => row.Guideline! in TAILWIND_PHRASES);
    expect(matches).toHaveLength(Object.keys(TAILWIND_PHRASES).length);
    expect(matches.map((row) => Number(row.No))).toEqual([57, 58, 59]);
    for (const row of matches) {
      for (const phrase of TAILWIND_PHRASES[row.Guideline!]!) expect(text(row)).toContain(phrase.toLowerCase());
      expect(row.Status).toBe("active");
      expect(row["Applies To"]).toBe("html-tailwind 4.3");
      expect(row["Verified At"]).toBe("2026-08-13");
    }
  });

  test("refined rows are context-sensitive, not universal recipes", async () => {
    const expected: Record<string, string[]> = {
      "8": ["depends on distance complexity platform", "shared motion tokens"],
      "14": ["match how an element changes speed", "linear for constant-rate progress"],
      "19": ["badges validation text", "stable content-driven container"],
      "78": ["avoid flashing for near-instant work", "platform and component guidance"],
    };
    const byNumber = new Map((await readRows("ux-guidelines.csv")).map((row) => [row.No!, row]));
    for (const [number, phrases] of Object.entries(expected)) {
      const row = byNumber.get(number)!;
      const guidance = `${row.Description} ${row.Do}`.toLowerCase();
      for (const phrase of phrases) expect(guidance).toContain(phrase);
      for (const claim of ["use 150-300ms", "operations > 300ms", "linear motion feels robotic"]) expect(guidance).not.toContain(claim);
    }
  });
});
