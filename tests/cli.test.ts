/**
 * uipro CLI contracts (ported from the Playwright specs in cli/tests/e2e: detect, dry-run,
 * agent-query-contract, template-script-paths, banner-design-path-contract, copilot-skills).
 */
import { describe, expect, test, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { removeSkillDir } from "../cli/src/commands/uninstall.ts";
import { detectAIType, getAITypeDescription } from "../cli/src/utils/detect.ts";
import {
  generatePlatformFiles,
  listBundledSubSkills,
  loadAllPlatformConfigs,
  loadPlatformConfig,
  planAllPlatformInstallActions,
  planPlatformInstallActions,
  renderSkillFile,
} from "../cli/src/utils/template.ts";
import { expectedDescription } from "../scripts/validate-agent-guide.ts";
import { REPO_ROOT, runBun, cleanScratch, scratchDir, SKILLS_DIR } from "./helpers.ts";

afterAll(cleanScratch);

const SUB_SKILL_COUNT = (await listBundledSubSkills()).length;
const SEARCH_COMMAND_COUNT = 17;
const searchScriptPaths = (content: string) => [...content.matchAll(/^bun\s+(\S*search\.ts)\b/gm)].map((match) => match[1]!);

describe("detect", () => {
  test("a sole .agents directory detects every consumer and still suggests codex", async () => {
    const scratch = await scratchDir("detect-agents");
    await mkdir(join(scratch, ".agents"));
    const { detected, suggested } = detectAIType(scratch);
    expect(detected).toEqual(["antigravity", "codex", "universal", "openclaw"]);
    expect(suggested).toBe("codex");
  });

  test("openclaw has a platform description", () => {
    expect(getAITypeDescription("openclaw")).toBe("OpenClaw (.agents/skills/)");
  });
});

describe("dry run", () => {
  test("plan lists the install actions for one platform and writes nothing", async () => {
    const scratch = await scratchDir("dry-run");
    const actions = (await planPlatformInstallActions(scratch, "claude")).join("\n");
    expect(actions).toContain(join(scratch, ".claude", "skills", "ui-ux-pro-max", "SKILL.md"));
    expect(actions).toContain("Would copy data + scripts:");
    expect(actions).toContain(`Would copy ${SUB_SKILL_COUNT} sub-skills (`);
    await planAllPlatformInstallActions(scratch);
    expect(await readdir(scratch)).toEqual([]);
  });

  test("zcode and openclaw layouts", async () => {
    for (const [platform, root] of [
      ["zcode", ".zcode"],
      ["openclaw", ".agents"],
    ] as const) {
      const scratch = await scratchDir(`dry-run-${platform}`);
      const actions = (await planPlatformInstallActions(scratch, platform)).join("\n");
      expect(actions).toContain(join(scratch, root, "skills", "ui-ux-pro-max", "SKILL.md"));
      expect(actions).toContain(`Would copy ${SUB_SKILL_COUNT} sub-skills (`);
    }
  });

  test("amazonq data and sub-skills stay out of the rules folder", async () => {
    const scratch = await scratchDir("dry-run-amazonq");
    const actions = await planPlatformInstallActions(scratch, "amazonq");
    expect(actions[0]).toBe(`Would write: ${join(scratch, ".amazonq", "rules", "ui-ux-pro-max.md")}`);
    expect(actions[1]).toBe(`Would copy data + scripts: ${join(scratch, ".amazonq", "skills", "ui-ux-pro-max")}`);
    expect(actions[2]).toMatch(/^Would copy \d+ sub-skills \(/);
    expect(actions[2]!.endsWith(`: ${join(scratch, ".amazonq", "skills")}`)).toBe(true);
  });

  test("plan for all platforms covers every unique layout", async () => {
    const planned = await planAllPlatformInstallActions(await scratchDir("dry-run-all"));
    expect(planned.size).toBeGreaterThan(1);
    expect(planned.get("claude")!.length).toBeGreaterThan(0);
  });
});

describe("agent query contract", () => {
  test("all platform metadata uses one accurate activation description", async () => {
    const description = await expectedDescription();
    const configs = await loadAllPlatformConfigs();
    expect(configs.size).toBe(23);
    for (const [platform, config] of configs) {
      expect([platform, config.description]).toEqual([platform, description]);
      if (config.frontmatter?.description) expect([platform, config.frontmatter.description]).toEqual([platform, description]);
    }
  });

  test("rendered guides expose the deterministic query contract and run with bun", async () => {
    for (const [platform, config] of await loadAllPlatformConfigs()) {
      const content = await renderSkillFile(config);
      for (const phrase of [
        "## Query Contract",
        "one dominant intent",
        "2–5 meaningful terms",
        "Retry once",
        "Do not persist unverified output",
        "explicit accessibility outcome terms",
        "semantic UX outcome first, then the detected stack",
        'orphan heading line balance" --domain ux',
        'badge chip label wraps" --domain ux',
        'live badge count screen reader" --domain ux',
        'rapid chip animation interrupted" --domain ux',
        'chip badge overflow nowrap" --stack html-tailwind',
        "React/Next.js performance",
        "Native/app interface guidance",
        "bun --version",
        "`m3`",
        "`rg-ui`",
        "`brand`",
      ]) {
        expect([platform, phrase, content.includes(phrase)]).toEqual([platform, phrase, true]);
      }
      for (const phrase of ["React Native perf | `react`", "Searches domains in parallel", "Always start with `--design-system`", "python", "search.py"]) {
        expect([platform, phrase, content.includes(phrase)]).toEqual([platform, phrase, false]);
      }
    }
  });

  test("rendered examples encode mode, retry, and persistence boundaries", async () => {
    const content = await renderSkillFile((await loadAllPlatformConfigs()).get("codex")!);
    expect(content).toContain('keyboard focus modal" --domain ux');
    expect(content).toContain('rerender memo list" --domain react');
    expect(content).toContain('virtualized list" --stack react-native');
    expect(content).toContain('--output-dir "<project-root>"');
    expect(content).toContain("Read an existing `MASTER.md` before deciding whether `--force` is justified");
  });

  test("quick-reference copy matches whether the section is inlined", async () => {
    const dangling = /\{\{#(NO)?QR\}\}|\{\{\/(NO)?QR\}\}/;
    for (const [platform, config] of await loadAllPlatformConfigs()) {
      const content = await renderSkillFile(config);
      expect(dangling.test(content)).toBe(false);
      const expectations: [string, boolean][] = config.sections.quickReference
        ? [
            ["## Quick Reference", true],
            ["rely on the Quick Reference sections above", true],
            ["Quick Reference checklist above", true],
            ["Quick Reference → relevant section", true],
            ["Quick Reference §6:", true],
            ["apply the relevant Quick Reference sections and focused searches", true],
            ["Run through Quick Reference **§1–§3**", true],
            ["use the Search Reference, Common Rules, and Pre-Delivery Checklist in this skill", false],
          ]
        : [
            ["## Quick Reference", false],
            ["Quick Reference sections above", false],
            ["Quick Reference checklist above", false],
            ["Quick Reference →", false],
            ["Quick Reference §", false],
            ["use the Search Reference, Common Rules, and Pre-Delivery Checklist in this skill", true],
            ["Step 3 (`ux` domain) + Common Rules", true],
            ['`"color-dark-mode color-accessible-pairs" --domain ux`', true],
            ["apply focused domain searches and the Common Rules below", true],
          ];
      for (const [phrase, present] of expectations) expect([platform, phrase, content.includes(phrase)]).toEqual([platform, phrase, present]);
    }
  });
});

describe("template script paths", () => {
  const cases = [
    ["claude", ".claude/skills/ui-ux-pro-max/scripts/search.ts"],
    ["codex", ".agents/skills/ui-ux-pro-max/scripts/search.ts"],
    ["kiro", ".kiro/steering/ui-ux-pro-max/scripts/search.ts"],
    ["droid", ".factory/skills/ui-ux-pro-max/scripts/search.ts"],
    ["zcode", ".zcode/skills/ui-ux-pro-max/scripts/search.ts"],
    ["amazonq", ".amazonq/skills/ui-ux-pro-max/scripts/search.ts"],
    ["openclaw", ".agents/skills/ui-ux-pro-max/scripts/search.ts"],
  ] as const;
  for (const [platform, localPath] of cases) {
    test(`${platform} renders project-root and global script paths`, async () => {
      const config = await loadPlatformConfig(platform);
      const local = await renderSkillFile(config);
      expect(searchScriptPaths(local)).toHaveLength(SEARCH_COMMAND_COUNT);
      expect(new Set(searchScriptPaths(local))).toEqual(new Set([localPath]));
      expect(local).not.toContain("{{SCRIPT_PATH}}");
      const global = await renderSkillFile(config, true);
      expect(searchScriptPaths(global)).toHaveLength(SEARCH_COMMAND_COUNT);
      expect(new Set(searchScriptPaths(global))).toEqual(new Set([`~/${localPath}`]));
    });
  }

  test("copilot renders .github/skills paths locally and ~/.copilot/skills globally", async () => {
    const config = await loadPlatformConfig("copilot");
    expect(new Set(searchScriptPaths(await renderSkillFile(config)))).toEqual(new Set([".github/skills/ui-ux-pro-max/scripts/search.ts"]));
    expect(new Set(searchScriptPaths(await renderSkillFile(config, true)))).toEqual(new Set(["~/.copilot/skills/ui-ux-pro-max/scripts/search.ts"]));
  });
});

describe("banner-design path contract", () => {
  const unavailable = ["frontend-design", "ai-artist", "ai-multimodal", "chrome-devtools", "assets-organizing", "docs/brand-guidelines.md", "scripts/search.py", "inject-brand-context.cjs", "gemini_batch_process.py", "screenshot.js", "nano-banana-pro-examples.md"];
  async function expectSelfContained(skillFile: string) {
    const content = await Bun.file(skillFile).text();
    for (const dependency of unavailable) expect([dependency, content.includes(dependency)]).toEqual([dependency, false]);
    const references = [...content.matchAll(/`((?:references|scripts)\/[\w./-]+)`/g)].map((match) => match[1]!);
    expect(references).toContain("references/banner-sizes-and-styles.md");
    for (const reference of references) expect([reference, existsSync(join(dirname(skillFile), reference))]).toEqual([reference, true]);
  }

  test("the shipped banner skill is self-contained", async () => {
    await expectSelfContained(join(SKILLS_DIR, "banner-design", "SKILL.md"));
  });

  test("Claude CLI installation preserves the banner path contract and copies the skill verbatim", async () => {
    const target = await scratchDir("banner");
    await generatePlatformFiles(target, "claude");
    const installed = join(target, ".claude", "skills", "banner-design", "SKILL.md");
    await expectSelfContained(installed);
    expect(await Bun.file(installed).text()).toBe(await Bun.file(join(SKILLS_DIR, "banner-design", "SKILL.md")).text());
  });
});

/** Run fn with os.homedir() pointing at home (HOME on POSIX, USERPROFILE on Windows). */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function writeLegacyPromptInstall(dir: string) {
  const prompts = join(dir, ".github", "prompts");
  await Bun.write(join(prompts, "ui-ux-pro-max.prompt.md"), "---\nmode: agent\n---\n");
  await Bun.write(join(prompts, "ui-ux-pro-max", "scripts", "search.py"), "");
  await Bun.write(join(prompts, "design", "SKILL.md"), "---\nname: design\n---\n");
}

describe("copilot Agent Skills", () => {
  test("SKILL.md has the name and description frontmatter Agent Skills require", async () => {
    const config = await loadPlatformConfig("copilot");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(await renderSkillFile(config))?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: ui-ux-pro-max$/m);
    expect(frontmatter).toMatch(/^description: "UI\/UX design intelligence/m);
    expect(frontmatter).not.toMatch(/^mode:/m);
    expect(config.frontmatter!.description!.length).toBeLessThanOrEqual(1024);
  });

  test("dry run plans the .github/skills layout and writes nothing", async () => {
    const scratch = await scratchDir("copilot-dry-run");
    const actions = await planPlatformInstallActions(scratch, "copilot");
    const skillDir = join(scratch, ".github", "skills", "ui-ux-pro-max");
    expect(actions[0]).toBe(`Would write: ${join(skillDir, "SKILL.md")}`);
    expect(actions[1]).toBe(`Would copy data + scripts: ${skillDir}`);
    expect(actions[2]).toMatch(/^Would copy \d+ sub-skills \(/);
    expect(actions[2]!.endsWith(`: ${join(scratch, ".github", "skills")}`)).toBe(true);
    expect(actions).toHaveLength(3);
    expect(await readdir(scratch)).toEqual([]);
  });

  test("--global plans, installs to and uninstalls from ~/.copilot/skills", async () => {
    const home = await scratchDir("copilot-home");
    const project = await scratchDir("copilot-project");
    const actions = await withHome(home, () => planPlatformInstallActions(project, "copilot", true));
    expect(actions[0]).toBe(`Would write: ${join(home, ".copilot", "skills", "ui-ux-pro-max", "SKILL.md")}`);
    await withHome(home, () => generatePlatformFiles(project, "copilot", true));
    expect(existsSync(join(home, ".copilot", "skills", "ui-ux-pro-max", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".github"))).toBe(false);
    const removed = await removeSkillDir(home, "copilot", true);
    expect(removed).toContain(".copilot/skills/ui-ux-pro-max");
    expect(await readdir(join(home, ".copilot", "skills"))).toEqual([]);
  });

  test("installs the skill, its data and the sub-skills under .github/skills", async () => {
    const scratch = await scratchDir("copilot-install");
    await generatePlatformFiles(scratch, "copilot");
    const skills = join(scratch, ".github", "skills");
    expect(existsSync(join(skills, "ui-ux-pro-max", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "ui-ux-pro-max", "scripts", "search.ts"))).toBe(true);
    expect(existsSync(join(skills, "ui-ux-pro-max", "data"))).toBe(true);
    for (const name of await listBundledSubSkills()) expect([name, existsSync(join(skills, name, "SKILL.md"))]).toEqual([name, true]);
    expect(existsSync(join(scratch, ".github", "prompts"))).toBe(false);
  });

  test("the installed search script runs from the target project", async () => {
    const scratch = await scratchDir("copilot-run");
    await generatePlatformFiles(scratch, "copilot");
    const proc = runBun([join(scratch, ".github", "skills", "ui-ux-pro-max", "scripts", "search.ts"), "keyboard focus modal", "--domain", "ux", "--json"], { cwd: scratch });
    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout).count).toBeGreaterThan(0);
  });

  test("replaces an earlier .github/prompts install and keeps the user's prompts", async () => {
    const scratch = await scratchDir("copilot-migrate");
    await writeLegacyPromptInstall(scratch);
    const prompts = join(scratch, ".github", "prompts");
    await Bun.write(join(prompts, "release-notes.prompt.md"), "# mine\n");
    await Bun.write(join(prompts, "slides", "notes.md"), "# mine\n");
    const plan = await planPlatformInstallActions(scratch, "copilot");
    expect(plan.slice(3)).toEqual([
      `Would remove legacy install: ${join(prompts, "ui-ux-pro-max.prompt.md")}`,
      `Would remove legacy install: ${join(prompts, "ui-ux-pro-max")}`,
      `Would remove legacy install: ${join(prompts, "design")}`,
    ]);
    await generatePlatformFiles(scratch, "copilot");
    expect(existsSync(join(scratch, ".github", "skills", "ui-ux-pro-max", "SKILL.md"))).toBe(true);
    expect(existsSync(join(prompts, "ui-ux-pro-max.prompt.md"))).toBe(false);
    expect(existsSync(join(prompts, "ui-ux-pro-max"))).toBe(false);
    expect(existsSync(join(prompts, "design"))).toBe(false);
    expect(existsSync(join(prompts, "release-notes.prompt.md"))).toBe(true);
    expect(existsSync(join(prompts, "slides", "notes.md"))).toBe(true);
  });

  test("a .github folder without Copilot files does not detect copilot", async () => {
    const scratch = await scratchDir("copilot-workflows");
    await mkdir(join(scratch, ".github", "workflows"), { recursive: true });
    await Bun.write(join(scratch, ".github", "dependabot.yml"), "version: 2\n");
    expect(detectAIType(scratch).detected).not.toContain("copilot");
  });

  for (const marker of [".github/copilot-instructions.md", ".github/instructions", ".github/prompts", ".github/agents", ".github/skills", ".github/hooks", ".copilot/skills"]) {
    test(`${marker} detects copilot`, async () => {
      const scratch = await scratchDir("copilot-detect");
      const path = join(scratch, marker);
      if (marker.endsWith(".md")) await Bun.write(path, "");
      else await mkdir(path, { recursive: true });
      expect(detectAIType(scratch)).toEqual({ detected: ["copilot"], suggested: "copilot" });
    });
  }

  test("uninstall removes the .github/skills install and an earlier .github/prompts one", async () => {
    const scratch = await scratchDir("copilot-uninstall");
    await generatePlatformFiles(scratch, "copilot");
    await writeLegacyPromptInstall(scratch);
    await mkdir(join(scratch, ".github", "workflows"));
    const removed = await removeSkillDir(scratch, "copilot");
    expect(removed).toEqual(
      expect.arrayContaining([".github/skills/ui-ux-pro-max", ".github/skills/design", ".github/prompts/ui-ux-pro-max.prompt.md", ".github/prompts/ui-ux-pro-max", ".github/prompts/design"]),
    );
    expect(await readdir(join(scratch, ".github", "skills"))).toEqual([]);
    expect(await readdir(join(scratch, ".github", "prompts"))).toEqual([]);
    expect(existsSync(join(scratch, ".github", "workflows"))).toBe(true);
  });
});

describe("uipro entry point", () => {
  test("help, version and argument validation", async () => {
    const entry = join(REPO_ROOT, "cli", "src", "index.ts");
    const help = runBun([entry, "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage: uipro <command>");
    const version = runBun([entry, "--version"]);
    expect(version.stdout.trim()).toBe((await Bun.file(join(REPO_ROOT, "package.json")).json()).version);
    expect(runBun([entry, "init", "--ai", "not-a-platform"]).exitCode).toBe(1);
    expect(runBun([entry, "bogus"]).exitCode).toBe(1);
  });

  test("init --dry-run writes nothing", async () => {
    const scratch = await scratchDir("uipro-dry-run");
    const proc = runBun([join(REPO_ROOT, "cli", "src", "index.ts"), "init", "--ai", "claude", "--dry-run"], { cwd: scratch });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout).toContain("Dry run complete");
    expect(await readdir(scratch)).toEqual([]);
  });
});
