/**
 * Tests for the design-system scripts: token validation, token generation
 * (CSS and Tailwind v4 @theme), embedding, HTML token validation, slide
 * generation and the slide search engine.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractTokens } from "../embed-tokens.ts";
import { generateCSS, generateTailwind, resolveReference } from "../generate-tokens.ts";
import { generateDeck, safeUrl } from "../generate-slide.ts";
import { validateHtml } from "../html-token-validator.ts";
import { BM25, csvToRows, parseCsv } from "../lib/search-core.ts";
import { calculatePatternBreak, detectDomain, search, searchWithContext, shouldUseFullBleed } from "../slide-search-core.ts";

const SCRIPTS = join(import.meta.dir, "..");
const STARTER = join(SCRIPTS, "..", "templates", "design-tokens-starter.json");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(import.meta.dir, ".tmp-design-system-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(script: string, args: string[], cwd = dir) {
  const proc = Bun.spawn([process.execPath, join(SCRIPTS, script), ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

describe("validate-tokens", () => {
  test("flags a hardcoded hex sharing a line with a token", async () => {
    await Bun.write(join(dir, "sample.css"), ".btn { background: #FF6B6B; color: var(--color-primary); }\n");
    const result = await run("validate-tokens.ts", ["--dir", dir]);
    expect(result.stdout).toContain("#FF6B6B");
    expect(result.code).toBe(1);
  });

  test("a token-only line reports no violation", async () => {
    await Bun.write(join(dir, "sample.css"), ".btn { background: var(--color-bg); color: var(--color-primary); }\n");
    const result = await run("validate-tokens.ts", ["--dir", dir]);
    expect(result.stdout).toContain("No token violations");
    expect(result.code).toBe(0);
  });
});

describe("generate-tokens", () => {
  test("resolves references and emits primitives, semantics and components", async () => {
    const tokens = await Bun.file(STARTER).json();
    const css = generateCSS(tokens);
    expect(css).toContain(":root {");
    expect(css).toContain("--color-primary:");
    expect(css).not.toContain("{primitive.");
    expect(resolveReference("{missing.path}", tokens)).toBe("{missing.path}");
  });

  test("tailwind format is a Tailwind v4 @theme block over the generated variables", async () => {
    const tokens = await Bun.file(STARTER).json();
    const theme = generateTailwind(tokens);
    expect(theme).toContain("@theme inline {");
    expect(theme).toContain("--color-primary: var(--color-primary);");
    expect(theme).toContain('@import "tailwindcss" source("..")');
    expect(theme).not.toContain("module.exports");
  });

  test("CLI writes the output file, creating directories", async () => {
    const result = await run("generate-tokens.ts", ["--config", STARTER, "-o", "out/tokens.css"]);
    expect(result.code).toBe(0);
    expect(await Bun.file(join(dir, "out", "tokens.css")).text()).toContain("Design Tokens - Auto-generated");
  });
});

describe("embed-tokens", () => {
  test("extracts and dedupes :root variables, optionally minimal", () => {
    const css = ":root {\n  --color-primary: #fff;\n  --other: 1px;\n}\n:root {\n  --color-primary: #fff;\n}\n";
    expect(extractTokens(css)).toBe(":root {\n  --color-primary: #fff;\n  --other: 1px;\n}");
    expect(extractTokens(css, true)).toBe(":root {\n  --color-primary: #fff;\n}");
  });
});

describe("html-token-validator and generate-slide", () => {
  test("generated decks pass the token validator", () => {
    const html = generateDeck([{ type: "title" }, { type: "metrics" }, { type: "cta" }], "Deck");
    const result = validateHtml(html, "deck.html");
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("hardcoded colors in <style> are errors; Chart.js scripts are allowed", () => {
    const result = validateHtml(
      '<link href="design-tokens.css"><style>.a { color: #123456; }</style><script>const c = "#abcdef";</script>',
      "x.html",
    );
    expect(result.errors).toEqual(["Hardcoded hex color in <style>: #123456"]);
  });

  test("CTA links reject javascript: URLs and escape values", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl('https://a.b/?q="x"')).toBe("https://a.b/?q=&quot;x&quot;");
    expect(generateDeck([{ type: "title", title: "<b>" }])).toContain("&lt;b&gt;");
  });
});

describe("slide search", () => {
  test("CSV reader handles quotes, commas and newlines like csv.DictReader", () => {
    expect(parseCsv('a,b\n"x, y","multi\nline ""q"""\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'multi\nline "q"'],
    ]);
    expect(csvToRows("h1,h2\nv1\n")).toEqual([{ h1: "v1", h2: "" }]);
  });

  test("BM25 ranks matching documents first and ignores short tokens", () => {
    const bm25 = new BM25();
    bm25.fit(["investor pitch deck", "sales webinar", "the of an"]);
    expect(bm25.tokenize("an Investor's deck")).toEqual(["investor", "deck"]);
    expect(bm25.score("investor")[0]![0]).toBe(0);
  });

  test("domain detection and search", async () => {
    expect(detectDomain("revenue chart")).toBe("chart");
    expect(detectDomain("nothing here")).toBe("strategy");
    const result = await search("investor pitch");
    expect(result.domain).toBe("strategy");
    expect(result.results?.[0]?.strategy_name).toBe("Guy Kawasaki 10/20/30");
  });

  test("contextual search infers the goal and deck rhythm", async () => {
    const result = await searchWithContext("problem slide", 2, 9);
    expect(result.context.inferred_goal).toBe("problem");
    expect(result.context.recommended_layout).toBeTruthy();
    expect(calculatePatternBreak(3, 9)).toBe(true);
    expect(calculatePatternBreak(2, 4)).toBe(false);
    expect(shouldUseFullBleed(1, 9, "hope")).toBe(true);
    expect(shouldUseFullBleed(2, 9, "clarity")).toBe(false);
  });
});
