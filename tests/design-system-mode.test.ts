/** Color-mode coherence of the design-system generator (issue #428; ported from test_design_system_mode.py). */
import { beforeAll, describe, expect, test } from "bun:test";
import {
  BOX_WIDTH,
  contrastRatio,
  DesignSystemGenerator,
  type DesignSystem,
  filterAntiPatternsForMode,
  formatAsciiBox,
  formatMarkdown,
  formatMasterMd,
  modeSupportLabels,
  paletteIsDark,
  queryWantsDark,
  relativeLuminance,
  resolveColorMode,
  selectPaletteForMode,
  styleIsDarkPrimary,
} from "../.claude/skills/ui-ux-pro-max/scripts/design-system.ts";

const LIGHT_PALETTE = { "Product Type": "SaaS", Background: "#F8FAFC", Foreground: "#020617" };
const DARK_PALETTE = { "Product Type": "Fintech/Crypto", Background: "#0F172A", Foreground: "#F8FAFC" };
const DARK_PRIMARY_STYLE = {
  "Style Category": "Modern Dark (Cinema Mobile)",
  "Light Mode ✓": "✓ Light mode only as exception",
  "Dark Mode ✓": "✓ Dark Mode Primary",
};
const DUAL_MODE_STYLE = { "Style Category": "Minimalism", "Light Mode ✓": "✓ Full", "Dark Mode ✓": "✓ Full" };

let generator: DesignSystemGenerator;
beforeAll(async () => {
  generator = await DesignSystemGenerator.create();
});

describe("luminance", () => {
  test("parses six and three digit hex", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("#FFF")).toBeCloseTo(1, 6);
  });

  test("returns null for unparseable", () => {
    for (const value of ["", "nope", "#12", "#GGGGGG", null]) expect(relativeLuminance(value)).toBeNull();
  });

  test("classifies backgrounds from the shipped data", () => {
    expect(paletteIsDark({ Background: "#1F2937" })).toBe(true);
    expect(paletteIsDark({ Background: "#E8ECF1" })).toBe(false);
  });

  test("missing background is not dark", () => {
    expect(paletteIsDark({})).toBe(false);
    expect(paletteIsDark(null)).toBe(false);
  });
});

describe("mode resolution", () => {
  test("dark primary style detected; dual mode is not", () => {
    expect(styleIsDarkPrimary(DARK_PRIMARY_STYLE)).toBe(true);
    expect(styleIsDarkPrimary(DUAL_MODE_STYLE)).toBe(false);
    expect(styleIsDarkPrimary({})).toBe(false);
  });

  test("query keywords", () => {
    expect(queryWantsDark("fintech B2B professional dark mode")).toBe(true);
    expect(queryWantsDark("gaming app OLED")).toBe(true);
    expect(queryWantsDark("healthcare clinic booking app")).toBe(false);
    expect(queryWantsDark("")).toBe(false);
  });

  test("either signal resolves dark", () => {
    expect(resolveColorMode("saas dark mode", DUAL_MODE_STYLE)).toBe("dark");
    expect(resolveColorMode("saas", DARK_PRIMARY_STYLE)).toBe("dark");
    expect(resolveColorMode("saas", DUAL_MODE_STYLE)).toBe("light");
  });
});

describe("palette selection", () => {
  test("dark mode skips light palettes", () => {
    expect(selectPaletteForMode([LIGHT_PALETTE, DARK_PALETTE], "dark").Background).toBe("#0F172A");
  });

  test("dark mode falls back to top hit when no dark ramp exists", () => {
    expect(selectPaletteForMode([LIGHT_PALETTE], "dark").Background).toBe("#F8FAFC");
  });

  test("light mode keeps the existing top hit behaviour", () => {
    expect(selectPaletteForMode([DARK_PALETTE, LIGHT_PALETTE], "light").Background).toBe("#0F172A");
  });

  test("empty results", () => {
    expect(selectPaletteForMode([], "dark")).toEqual({});
  });

  test("category identity wins over unrelated dark palette", () => {
    const chosen = selectPaletteForMode([LIGHT_PALETTE, DARK_PALETTE], "dark", "SaaS");
    expect(chosen["Product Type"]).toBe("SaaS");
    expect(chosen._mode_derivation).toBe("derived-dark");
    expect(paletteIsDark(chosen)).toBe(true);
    expect(contrastRatio(chosen.Ring, chosen.Background)!).toBeGreaterThanOrEqual(3);
  });
});

describe("anti-pattern gating", () => {
  test("dark clause dropped, others kept", () => {
    expect(filterAntiPatternsForMode("Excessive animation + Dark mode by default", "dark")).toBe("Excessive animation");
  });

  test("light mode is a no-op; unrelated clauses survive; empty input", () => {
    const original = "Excessive animation + Dark mode by default";
    expect(filterAntiPatternsForMode(original, "light")).toBe(original);
    expect(filterAntiPatternsForMode("Complex jargon + Tiny tap targets", "dark")).toBe("Complex jargon + Tiny tap targets");
    expect(filterAntiPatternsForMode("", "dark")).toBe("");
  });
});

describe("end-to-end coherence (issue #428)", () => {
  const QUERY = "SaaS invoicing fintech B2B professional dark mode";

  test("dark query gets a dark background, lighter foreground and no dark-mode anti-pattern", async () => {
    const ds = await generator.generate(QUERY);
    expect(paletteIsDark({ Background: ds.colors.background ?? "" })).toBe(true);
    expect(relativeLuminance(ds.colors.foreground)!).toBeGreaterThan(relativeLuminance(ds.colors.background)!);
    expect(ds.anti_patterns.toLowerCase()).not.toContain("dark mode");
  });

  test("generator exports every semantic foreground pair", async () => {
    const colors = (await generator.generate("SaaS dashboard")).colors;
    for (const [foreground, background] of [
      ["on_primary", "primary"],
      ["on_secondary", "secondary"],
      ["on_accent", "accent"],
      ["foreground", "background"],
      ["card_foreground", "card"],
      ["muted_foreground", "muted"],
      ["on_destructive", "destructive"],
    ] as const) {
      expect(colors[foreground]).toBeTruthy();
      expect(colors[background]).toBeTruthy();
      expect(contrastRatio(colors[foreground], colors[background])!).toBeGreaterThanOrEqual(4.5);
    }
    expect(colors.on_cta).toBe(colors.on_accent);
  });

  test("light query keeps a light background", async () => {
    const ds = await generator.generate("healthcare clinic booking app");
    expect(paletteIsDark({ Background: ds.colors.background ?? "" })).toBe(false);
  });
});

describe("light result output coherence", () => {
  const QUERY = "beauty spa wellness";
  let ds: DesignSystem;
  beforeAll(async () => {
    ds = await generator.generate(QUERY, { projectName: "Serenity Spa" });
  });

  test("dark support is qualified when the product avoids dark mode", () => {
    expect(ds.anti_patterns.toLowerCase()).toContain("dark mode");
    const [, dark] = modeSupportLabels(ds.style, ds.anti_patterns);
    expect(dark).toContain("avoid for this product");
    expect(formatAsciiBox(ds)).toContain("avoid for this product");
    expect(formatMarkdown(ds)).toContain("avoid for this product");
  });

  test("labels unchanged when dark mode is not avoided", () => {
    expect(modeSupportLabels({ light_mode: "supported", dark_mode: "supported" } as DesignSystem["style"], "Harsh animations")).toEqual([
      "supported",
      "supported",
    ]);
  });

  test("ASCII box lines never overflow the border", async () => {
    for (const query of [QUERY, "SaaS invoicing fintech B2B professional dark mode"]) {
      const box = formatAsciiBox(await generator.generate(query, { motion: 7 }));
      const widths = new Set(box.split("\n").map((line) => [...line.replace(/\x1b\[[0-9;]*m/g, "")].length));
      expect([query, [...widths]]).toEqual([query, [BOX_WIDTH + 1]]);
    }
  });

  test("MASTER button text meets contrast on its background", () => {
    const master = formatMasterMd(ds);
    const primary = /\.btn-primary \{\n {2}background: (#\w+);\n {2}color: (#\w+);/.exec(master)!;
    const secondary = /\.btn-secondary \{\n {2}background: transparent;\n {2}color: (#\w+);/.exec(master)!;
    expect(contrastRatio(primary[2], primary[1])!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(secondary[1], ds.colors.background)!).toBeGreaterThanOrEqual(4.5);
  });
});
