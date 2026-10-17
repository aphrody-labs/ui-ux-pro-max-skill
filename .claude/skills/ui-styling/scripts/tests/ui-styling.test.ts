/**
 * Tests for shadcn-add.ts (runner stubbed) and tailwind-config-gen.ts
 * (Tailwind v4 CSS-first output).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ShadcnInstaller, type Runner } from "../shadcn-add.ts";
import { main as tailwindMain, TailwindThemeGenerator } from "../tailwind-config-gen.ts";

let dir: string;
const originalLog = console.log;
const originalError = console.error;
let out: string[];
let err: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(import.meta.dir, ".tmp-ui-styling-"));
  out = [];
  err = [];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
});

afterEach(async () => {
  console.log = originalLog;
  console.error = originalError;
  await rm(dir, { recursive: true, force: true });
});

async function shadcnProject(): Promise<string> {
  const root = join(dir, "test-project");
  await Bun.write(join(root, "components.json"), JSON.stringify({ style: "new-york", aliases: { components: "@/components", utils: "@/lib/utils" } }));
  await Bun.write(join(root, "components", "ui", ".keep"), "");
  return root;
}

const ok = (stdout = "done"): Runner => mock(async () => ({ exitCode: 0, stdout, stderr: "" }));

describe("ShadcnInstaller", () => {
  test("defaults to the current directory and live mode", () => {
    const installer = new ShadcnInstaller();
    expect(installer.projectRoot).toBe(process.cwd());
    expect(installer.dryRun).toBe(false);
  });

  test("detects components.json", async () => {
    expect(await new ShadcnInstaller(await shadcnProject()).checkShadcnConfig()).toBe(true);
    expect(await new ShadcnInstaller(dir).checkShadcnConfig()).toBe(false);
  });

  test("lists installed components from the components alias", async () => {
    const root = await shadcnProject();
    const installer = new ShadcnInstaller(root);
    expect(await installer.getInstalledComponents()).toEqual([]);
    await Bun.write(join(root, "components", "ui", "button.tsx"), "export const Button = () => {}");
    await Bun.write(join(root, "components", "ui", "card.tsx"), "export const Card = () => {}");
    expect((await installer.getInstalledComponents()).sort()).toEqual(["button", "card"]);
    expect(await new ShadcnInstaller(dir).getInstalledComponents()).toEqual([]);
  });

  test("rejects empty lists, missing config and existing components", async () => {
    const root = await shadcnProject();
    expect(await new ShadcnInstaller(root).addComponents([])).toEqual([false, "No components specified"]);
    const [okNoConfig, msgNoConfig] = await new ShadcnInstaller(dir).addComponents(["button"]);
    expect(okNoConfig).toBe(false);
    expect(msgNoConfig).toContain("not initialized");
    expect(msgNoConfig).toContain("bunx --bun shadcn@latest init");
    await Bun.write(join(root, "components", "ui", "button.tsx"), "x");
    const [success, message] = await new ShadcnInstaller(root).addComponents(["button"]);
    expect(success).toBe(false);
    expect(message).toContain("already installed");
    expect(message).toContain("button");
  });

  test("--overwrite reinstalls through bun x shadcn", async () => {
    const root = await shadcnProject();
    await Bun.write(join(root, "components", "ui", "button.tsx"), "x");
    const runner = ok("Component added successfully");
    const [success, message] = await new ShadcnInstaller(root, false, runner).addComponents(["button"], true);
    expect(success).toBe(true);
    expect(message).toContain("Successfully added");
    const [cmd, cwd] = (runner as ReturnType<typeof mock>).mock.calls[0] as [string[], string];
    expect(cmd.slice(0, 4)).toEqual([process.execPath, "x", "--bun", "shadcn@latest"]);
    expect(cmd).toContain("--overwrite");
    expect(cwd).toBe(root);
  });

  test("dry run prints the bunx command", async () => {
    const root = await shadcnProject();
    const [success, message] = await new ShadcnInstaller(root, true).addComponents(["button", "card"]);
    expect(success).toBe(true);
    expect(message).toBe("Would run: bunx --bun shadcn@latest add button card");
    const [, all] = await new ShadcnInstaller(root, true).addAllComponents();
    expect(all).toBe("Would run: bunx --bun shadcn@latest add --all");
  });

  test("uses the shadcn version pinned in package.json", async () => {
    const root = await shadcnProject();
    await Bun.write(join(root, "package.json"), JSON.stringify({ devDependencies: { shadcn: "^4.1.0" } }));
    const [, message] = await new ShadcnInstaller(root, true).addComponents(["button"]);
    expect(message).toBe("Would run: bunx --bun shadcn@4.1.0 add button");
  });

  test("reports CLI failures and spawn errors", async () => {
    const root = await shadcnProject();
    const failing: Runner = mock(async () => ({ exitCode: 1, stdout: "", stderr: "Error occurred" }));
    const [s1, m1] = await new ShadcnInstaller(root, false, failing).addComponents(["button"]);
    expect(s1).toBe(false);
    expect(m1).toContain("Failed to add");
    const throwing: Runner = mock(async () => {
      throw new Error("ENOENT");
    });
    const [s2, m2] = await new ShadcnInstaller(root, false, throwing).addComponents(["button"]);
    expect(s2).toBe(false);
    expect(m2).toContain("bun not found");
  });

  test("adds all components and lists them", async () => {
    const root = await shadcnProject();
    const runner = ok("All components added");
    const [success, message] = await new ShadcnInstaller(root, false, runner).addAllComponents();
    expect(success).toBe(true);
    expect(message).toContain("Successfully added all");
    expect((runner as ReturnType<typeof mock>).mock.calls[0]![0]).toContain("--all");
    expect(await new ShadcnInstaller(dir).listInstalled()).toEqual([false, "shadcn not initialized"]);
    expect(await new ShadcnInstaller(root).listInstalled()).toEqual([true, "No components installed"]);
    await Bun.write(join(root, "components", "ui", "card.tsx"), "x");
    await Bun.write(join(root, "components", "ui", "button.tsx"), "x");
    expect(await new ShadcnInstaller(root).listInstalled()).toEqual([true, "Installed components:\n  - button\n  - card"]);
  });
});

describe("TailwindThemeGenerator", () => {
  test("default entry per framework and source() base relative to the project root", () => {
    expect(new TailwindThemeGenerator("nextjs", null, false, dir).outputPath).toBe(join(dir, "app", "globals.css"));
    expect(new TailwindThemeGenerator("react", null, false, dir).outputPath).toBe(join(dir, "src", "index.css"));
    expect(new TailwindThemeGenerator("svelte", null, false, dir).outputPath).toBe(join(dir, "src", "app.css"));
    expect(new TailwindThemeGenerator("vue", null, false, dir).outputPath).toBe(join(dir, "src", "style.css"));
    const css = new TailwindThemeGenerator("nextjs", null, false, dir).generate();
    expect(css).toContain('@import "tailwindcss" source("..");');
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(css).toContain("@aphrody/bun-plugin-tailwind");
    expect(new TailwindThemeGenerator("react", "theme.css", false, dir).generate()).toContain('source(".")');
  });

  test("theme tokens become @theme variables", () => {
    const gen = new TailwindThemeGenerator("react", null, false, dir);
    gen.addColors({ brand: "#3b82f6", accent: "oklch(0.7 0.2 300)" });
    gen.addColors({ muted: "#e5e7eb" });
    gen.addFonts({ sans: ["Inter", "system-ui", "sans-serif"], display: ["Playfair Display", "serif"] });
    gen.addSpacing({ "18": "4.5rem", navbar: "4rem" });
    gen.addBreakpoints({ "3xl": "1920px", tablet: "768px" });
    const css = gen.generate();
    expect(css).toContain("@theme {");
    expect(css).toContain("  --color-brand: #3b82f6;");
    expect(css).toContain("  --color-accent: oklch(0.7 0.2 300);");
    expect(css).toContain("  --color-muted: #e5e7eb;");
    expect(css).toContain('  --font-sans: "Inter", system-ui, sans-serif;');
    expect(css).toContain('  --font-display: "Playfair Display", serif;');
    expect(css).toContain("  --spacing-18: 4.5rem;");
    expect(css).toContain("  --spacing-navbar: 4rem;");
    expect(css).toContain("  --breakpoint-3xl: 1920px;");
    expect(css).not.toContain("module.exports");
    expect(css).not.toContain("tailwind.config");
  });

  test("color palettes derive 50-950 shades with color-mix", () => {
    const gen = new TailwindThemeGenerator("react", null, false, dir);
    gen.addColorPalette("brand", "#3b82f6");
    const css = gen.generate();
    expect(css).toContain("--color-brand-50: color-mix(in oklch, #3b82f6 10%, white);");
    expect(css).toContain("--color-brand-500: #3b82f6;");
    expect(css).toContain("--color-brand-950: color-mix(in oklch, #3b82f6 25%, black);");
  });

  test("plugins and sources: recommendations, no duplicates, validation", () => {
    const gen = new TailwindThemeGenerator("nextjs", null, false, dir);
    expect(gen.recommendPlugins()).toEqual(["tw-animate-css", "@tailwindcss/typography"]);
    expect(new TailwindThemeGenerator("react").recommendPlugins()).toEqual(["tw-animate-css"]);
    gen.addPlugins(["tw-animate-css", "@tailwindcss/typography", "@tailwindcss/typography"]);
    gen.addSources(["../../packages/rg-ui/src"]);
    const css = gen.generate();
    expect(css).toContain('@import "tw-animate-css";');
    expect(css.match(/@plugin "@tailwindcss\/typography";/g)?.length).toBe(1);
    expect(css).toContain('@source "../../packages/rg-ui/src";');
    expect(() => gen.addPlugins(["evil'); alert(1); ('"])).toThrow("Invalid plugin name");
    expect(() => gen.addSources(['x"; } body { color: red'])).toThrow("Invalid @source value");
    expect(() => gen.addColors({ "bad name": "#fff" })).toThrow("Invalid color name");
    expect(() => gen.addColors({ brand: "#fff; } :root {" })).toThrow("Invalid color value");
  });

  test("validation warns on an empty theme", () => {
    const gen = new TailwindThemeGenerator("react", null, false, dir);
    expect(gen.validate()).toEqual([true, "Warning: No theme tokens defined"]);
    gen.addColors({ brand: "#000" });
    expect(gen.validate()).toEqual([true, "Configuration valid"]);
  });

  test("write creates the entry and refuses to overwrite without force", async () => {
    const gen = new TailwindThemeGenerator("react", null, false, dir);
    gen.addColors({ brand: "#3b82f6" });
    const [success, message] = await gen.write();
    expect(success).toBe(true);
    expect(message).toContain("written to");
    expect(await Bun.file(join(dir, "src", "index.css")).text()).toContain("--color-brand");

    const [again, refusal] = await new TailwindThemeGenerator("react", null, false, dir).write();
    expect(again).toBe(false);
    expect(refusal).toContain("already exists");
    expect(refusal).toContain("--force");

    const forced = new TailwindThemeGenerator("react", null, true, dir);
    forced.addColors({ accent: "#8b5cf6" });
    expect((await forced.write())[0]).toBe(true);
    expect(await Bun.file(join(dir, "src", "index.css")).text()).toContain("--color-accent");
  });

  test("an invalid output path fails cleanly", async () => {
    await Bun.write(join(dir, "file"), "x");
    const [success, message] = await new TailwindThemeGenerator("react", join(dir, "file", "nested", "a.css"), true, dir).write();
    expect(success).toBe(false);
    expect(message).toContain("Failed to write");
  });
});

describe("tailwind-config-gen CLI", () => {
  test("refuses an existing entry without --force", async () => {
    const entry = join(dir, "src", "index.css");
    await Bun.write(entry, "/* existing */\n");
    expect(await tailwindMain(["--colors", "brand:#3b82f6"], dir)).toBe(1);
    expect(err.join("\n")).toContain("already exists");
    expect(err.join("\n")).toContain("--force");
    expect(await Bun.file(entry).text()).toBe("/* existing */\n");
  });

  test("refuses a legacy tailwind.config.js beside the project without --force", async () => {
    await Bun.write(join(dir, "tailwind.config.js"), "module.exports = {}\n");
    expect(await tailwindMain(["--colors", "brand:#3b82f6"], dir)).toBe(1);
    expect(err.join("\n")).toContain("tailwind.config.js");
    expect(err.join("\n")).toContain("@config");
    expect(await Bun.file(join(dir, "src", "index.css")).exists()).toBe(false);
    expect(await tailwindMain(["--colors", "brand:#3b82f6", "--force"], dir)).toBe(0);
    expect(await Bun.file(join(dir, "tailwind.config.js")).text()).toBe("module.exports = {}\n");
  });

  test("full configuration with nargs-style lists", async () => {
    const code = await tailwindMain(
      [
        "--framework", "nextjs",
        "--colors", "brand:#3b82f6", "accent:#8b5cf6",
        "--palette", "primary:oklch(0.55 0.2 260)",
        "--fonts", "sans:Inter,system-ui", "display:'Playfair Display',serif",
        "--spacing", "navbar:4rem",
        "--breakpoints", "3xl:1920px",
        "--source", "../packages/ui/src",
        "--plugins",
      ],
      dir,
    );
    expect(code).toBe(0);
    const css = await Bun.file(join(dir, "app", "globals.css")).text();
    for (const needle of ["--color-brand: #3b82f6", "--color-accent", "--color-primary-500: oklch(0.55 0.2 260)", '"Inter"', '--font-display: "Playfair Display", serif', "--spacing-navbar", "--breakpoint-3xl", "tw-animate-css", "@tailwindcss/typography", '@source "../packages/ui/src"']) {
      expect(css).toContain(needle);
    }
    expect(out.join("\n")).toContain("bun add -d tailwindcss tw-animate-css @tailwindcss/typography");
  });

  test("--validate-only prints the stylesheet without writing", async () => {
    expect(await tailwindMain(["--validate-only"], dir)).toBe(0);
    expect(out.join("\n")).toContain('@import "tailwindcss"');
    expect(await Bun.file(join(dir, "src", "index.css")).exists()).toBe(false);
  });

  test("invalid specs fail", async () => {
    expect(await tailwindMain(["--colors", "brand"], dir)).toBe(1);
    expect(err.join("\n")).toContain("Invalid color spec");
    expect(await tailwindMain(["--framework", "angular"], dir)).toBe(2);
  });
});
