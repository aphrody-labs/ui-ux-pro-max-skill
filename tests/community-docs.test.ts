/**
 * Community docs must not point at disabled or missing destinations (port of upstream
 * scripts/tests/test_community_docs.py, regression for #542). Discussions are disabled, so
 * questions go to issues and conduct reports stay on the uupm.cc contact. The stack quickstart
 * clones the repository and enters stack/ before ./scripts/setup.ts (the fork ports setup.sh to Bun).
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers.ts";

const DISCUSSIONS_URL = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/discussions";
const ISSUES_URL = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/issues";
const STACK_CLONE = "git clone https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git";
const STACK_CD = "cd ui-ux-pro-max-skill/stack";

const read = (path: string) => Bun.file(join(REPO_ROOT, path)).text();

/** Body under `## heading` up to the next `## ` heading; a missing heading fails instead of passing vacuously. */
function section(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text.replaceAll("\r\n", "\n"));
  if (!match) throw new Error(`missing heading: ## ${heading}`);
  return match[1]!;
}

test("questions go to issues, conduct to the uupm.cc contact, and the stack clone enters stack/", async () => {
  const contributing = await read("CONTRIBUTING.md");
  const questions = section(contributing, "Questions?");
  expect(questions).toContain(ISSUES_URL);
  expect(questions).toContain("README.md");
  expect(contributing).not.toContain(DISCUSSIONS_URL);

  const conduct = await read("CODE_OF_CONDUCT.md");
  const enforcement = section(conduct, "Enforcement");
  expect(enforcement).toContain("https://www.uupm.cc");
  for (const absent of ["/discussions", "/issues", "mailto:"]) expect(enforcement).not.toContain(absent);
  expect(conduct).not.toContain(DISCUSSIONS_URL);

  const quickstart = section(await read("stack/README.md"), "Quickstart");
  expect(quickstart).toContain(STACK_CLONE);
  expect(quickstart).toContain(STACK_CD);
  expect(quickstart.indexOf(STACK_CLONE)).toBeLessThan(quickstart.indexOf(STACK_CD));
  expect(quickstart.indexOf(STACK_CD)).toBeLessThan(quickstart.indexOf("./scripts/setup.ts"));
  expect(quickstart).not.toContain("YMungerDev/claude-website-design-stack");
  expect(existsSync(join(REPO_ROOT, "stack", "scripts", "setup.ts"))).toBe(true);
});
