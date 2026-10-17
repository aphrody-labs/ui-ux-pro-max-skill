/**
 * Regression tests for sync-brand-to-tokens.ts, run against throwaway
 * projects. The script must parse the bundled starter template, keep dark
 * scales graded, regenerate CSS through the sibling design-system skill and
 * refuse to replace existing token sources without --force.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..");
const SCRIPT = join(SCRIPTS, "sync-brand-to-tokens.ts");
const BRAND_STARTER = join(SCRIPTS, "..", "templates", "brand-guidelines-starter.md");
const TOKENS_STARTER = join(SCRIPTS, "..", "..", "design-system", "templates", "design-tokens-starter.json");

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(import.meta.dir, ".tmp-brand-sync-"));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const write = (relative: string, content: string) => Bun.write(join(project, relative), content);
const copy = async (from: string, relative: string) => Bun.write(join(project, relative), Bun.file(from));
const exists = (relative: string) => Bun.file(join(project, relative)).exists();
const read = (relative: string) => Bun.file(join(project, relative)).text();

async function run(...args: string[]) {
  const proc = Bun.spawn([process.execPath, SCRIPT, ...args], { cwd: project, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

const withStarter = () => copy(BRAND_STARTER, "docs/brand-guidelines.md");

describe("sync-brand-to-tokens", () => {
  test("parses the bundled starter template and regenerates CSS from the sibling skill", async () => {
    await withStarter();
    await copy(TOKENS_STARTER, "assets/design-tokens.json");
    const result = await run("--force");
    expect(result.stderr).not.toContain("TypeError");
    expect(result.code).toBe(0);

    const tokens = JSON.parse(await read("assets/design-tokens.json"));
    const primitive = tokens.primitive.color;
    expect(primitive.primary["500"].$value).toBe("#2563EB");
    expect(primitive.secondary["500"].$value).toBe("#8B5CF6");
    expect(primitive.accent["500"].$value).toBe("#10B981");

    // #474: resolved from this skill's own location, not from the working directory.
    expect(result.stdout).toContain("Regenerated");
    expect((await read("assets/design-tokens.css")).length).toBeGreaterThan(0);
  });

  test("dark base color does not collapse shades to black", async () => {
    await copy(TOKENS_STARTER, "assets/design-tokens.json");
    await write(
      "docs/brand-guidelines.md",
      "## Quick Reference\n\n| Element | Value |\n|---------|-------|\n| Primary Color | #4A3228 |\n| Secondary Color | #C08A3E |\n| Accent Color | #6B8F71 |\n",
    );
    const result = await run("--force");
    expect(result.code).toBe(0);
    const primary = JSON.parse(await read("assets/design-tokens.json")).primitive.color.primary;
    const dark = ["700", "800", "900"].map((shade) => primary[shade].$value);
    expect(new Set(dark).size).toBe(3);
    expect(dark).not.toContain("#000000");
  });

  test("reports missing guidelines", async () => {
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Brand guidelines not found");
  });

  test("creates the default output directory when missing", async () => {
    await withStarter();
    const result = await run();
    expect(result.code).toBe(0);
    expect(await exists("assets/design-tokens.json")).toBe(true);
    expect(await exists("assets/design-tokens.css")).toBe(true);
  });

  test("refuses existing design tokens without --force", async () => {
    await withStarter();
    const existing = '{"existing": true}\n';
    await write("assets/design-tokens.json", existing);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("assets/design-tokens.json");
    expect(result.stderr).toContain("--force");
    expect(await read("assets/design-tokens.json")).toBe(existing);
  });

  const refusing: Array<[string, string, string]> = [
    ["CSS custom property source", "src/index.css", ":root {\n  --primary: #2563eb;\n  --foreground: #0f172a;\n}\n"],
    ["grouped :root selector", "src/index.css", ':root, [data-theme="light"] {\n  --primary: #2563eb;\n}\n'],
    ["Tailwind v4 @theme source", "src/index.css", "@theme {\n  --color-brand-500: #2563eb;\n}\n"],
    ["src/styles/global.css", "src/styles/global.css", ":root {\n  --dawn: #f5a524;\n  --ink: #1c1626;\n}\n"],
    ["src/global.css", "src/global.css", ":root {\n  --dawn: #f5a524;\n}\n"],
    ["src/main.css", "src/main.css", ":root {\n  --dawn: #f5a524;\n}\n"],
    ["src/styles/theme.css", "src/styles/theme.css", ":root {\n  --dawn: #f5a524;\n}\n"],
    ["styles/variables.css", "styles/variables.css", ":root {\n  --dawn: #f5a524;\n}\n"],
  ];
  for (const [label, path, css] of refusing) {
    test(`refuses ${label} without --force`, async () => {
      await withStarter();
      await write(path, css);
      const result = await run();
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(path);
      expect(result.stderr).toContain("--force");
      expect(await exists("assets/design-tokens.json")).toBe(false);
    });
  }

  test("follows local CSS imports to the actual token source", async () => {
    await withStarter();
    await write("src/index.css", '@import "./styles/theme.css";\n');
    await write("src/styles/theme.css", "@theme {\n  --color-brand-500: #2563eb;\n}\n");
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("src/styles/theme.css");
    expect(await exists("assets/design-tokens.json")).toBe(false);
  });

  const allowed: Array<[string, Record<string, string>]> = [
    ["commented :root custom properties", { "src/index.css": "/* Example only:\n:root {\n  --primary: #2563eb;\n}\n*/\n" }],
    ["custom properties outside :root", { "src/index.css": ":root {\n  color-scheme: light;\n}\n\n.progress {\n  --progress-value: 50%;\n}\n" }],
    ["external CSS imports", { "src/index.css": '@import "https://example.com/theme.css";\n@import "tailwindcss";\n' }],
    ["plain stylesheets", { "src/styles/global.css": ".btn {\n  color: red;\n}\n", "src/styles/reset.css": "* {\n  margin: 0;\n}\n" }],
  ];
  for (const [label, files] of allowed) {
    test(`ignores ${label}`, async () => {
      await withStarter();
      for (const [path, css] of Object.entries(files)) await write(path, css);
      const result = await run();
      expect(result.code).toBe(0);
      expect(await exists("assets/design-tokens.json")).toBe(true);
    });
  }

  test("refuses Tailwind v3 theme colors and presets without --force", async () => {
    await withStarter();
    await write("tailwind.config.js", "module.exports = { theme: { extend: { colors: { brand: '#2563eb' } } } }\n");
    let result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("tailwind.config.js");
    expect(result.stderr).toContain("--force");

    await write("tailwind.config.js", "const preset = require('./tailwind.preset');\nmodule.exports = { presets: [preset] };\n");
    result = await run();
    expect(result.code).toBe(1);
    expect(await exists("assets/design-tokens.json")).toBe(false);
  });

  test("--force overrides token-source detection", async () => {
    await withStarter();
    await write("src/index.css", ":root {\n  --primary: #2563eb;\n}\n");
    const result = await run("--force");
    expect(result.code).toBe(0);
    expect(await exists("assets/design-tokens.json")).toBe(true);
    expect(dirname(SCRIPT)).toBe(SCRIPTS);
  });
});
