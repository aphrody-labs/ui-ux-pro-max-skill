/**
 * Every script invocation in the shipped skill markdown resolves from the skill directory
 * (regression test for #474; ported from test_skill_script_paths.py).
 *
 * The skills land in layouts where neither the project root nor ~/.claude/skills/ is a valid
 * anchor (plugin cache, a project's .claude/skills/, ~/.claude/skills/ with --global, a manual
 * copy). The one anchor that exists in all of them is the skill's own directory, so documented
 * commands use `scripts/<file>` for the skill's own scripts and `../<skill>/scripts/<file>` for a
 * sibling sub-skill. The core skill's `${CLAUDE_PLUGIN_ROOT}/.claude/skills/...` form is resolved
 * against the repository root and accepted only in that SKILL.md. Every invocation must run with
 * bun: python/node/bash invocations of shipped scripts are reported as legacy. Commands that run in
 * the Bun OS monorepo (packages/, apps/, crates/) are documentation of that checkout, not shipped scripts.
 */
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { REPO_ROOT, SKILLS_DIR } from "./helpers.ts";

const PLUGIN_ONLY_FILE = join(".claude", "skills", "ui-ux-pro-max", "SKILL.md");
const INVOCATION = /(?<![\w/.-])(bun|python3?|node|bash)\s+(?:run\s+)?"?([^\s"`']+\.(?:ts|py|cjs|js|mjs|sh))/g;
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}/";

async function* shippedInvocations() {
  for (const entry of (await readdir(SKILLS_DIR, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(SKILLS_DIR, entry.name);
    for await (const relativeMd of new Bun.Glob("**/*.md").scan({ cwd: skillDir })) {
      const md = join(skillDir, relativeMd);
      const lines = (await Bun.file(md).text()).split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(INVOCATION)) yield { skillDir, md, lineno: index + 1, runner: match[1]!, path: match[2]! };
      }
    }
  }
}

function resolve(skillDir: string, md: string, path: string): [string | null, string | null] {
  if (path.startsWith(PLUGIN_ROOT)) {
    if (relative(REPO_ROOT, md) !== PLUGIN_ONLY_FILE) return [null, "the ${CLAUDE_PLUGIN_ROOT} form is only valid in the plugin-only core SKILL.md"];
    return [join(REPO_ROOT, path.slice(PLUGIN_ROOT.length)), null];
  }
  if (path.startsWith("scripts/")) return [join(skillDir, path), null];
  if (path.startsWith("../")) {
    const parts = path.split("/");
    if (parts.length > 3 && parts[2] === "scripts") return [join(dirname(skillDir), parts[1]!, ...parts.slice(2)), null];
    return [null, "a sibling invocation must be ../<skill>/scripts/<file> and the sibling must ship"];
  }
  return [null, "not skill-relative (expected scripts/<file> or ../<skill>/scripts/<file>)"];
}

test("every shipped markdown invocation runs with bun and resolves from the skill directory", async () => {
  const problems: string[] = [];
  let seen = 0;
  for await (const { skillDir, md, lineno, runner, path } of shippedInvocations()) {
    // Placeholders ("scripts/<file>.ts") and Bun OS monorepo commands (packages/, apps/, crates/) are not shipped scripts.
    if (path.includes("<") || /^(?:packages|apps|crates)\//.test(path)) continue;
    seen++;
    const location = `${relative(REPO_ROOT, md)}:${lineno}: ${runner} ${path}`;
    if (runner !== "bun") {
      problems.push(`${location} -- shipped scripts run with bun, not ${runner}`);
      continue;
    }
    const [target, reason] = resolve(skillDir, md, path);
    if (reason) problems.push(`${location} -- ${reason}`);
    else if (!(await Bun.file(target!).exists())) problems.push(`${location} -- no such file: ${target}`);
  }
  // Guard against a silently broken extractor: the skill tree documents dozens of invocations.
  expect(seen).toBeGreaterThan(40);
  expect(problems).toEqual([]);
});
