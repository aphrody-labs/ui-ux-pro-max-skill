import { join } from "node:path";

/** Repository root: the CLI runs from the checkout or global install of this repository. */
export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
/** Canonical skill tree shipped with the repository (also what the Claude Code plugin loads). */
export const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");
export const CORE_SKILL = "ui-ux-pro-max";
export const CORE_SKILL_DIR = join(SKILLS_DIR, CORE_SKILL);
export const TEMPLATES_DIR = join(REPO_ROOT, "cli", "templates");
export const PACKAGE_JSON = join(REPO_ROOT, "package.json");
export const REPO_SLUG = "aphrody-labs/ui-ux-pro-max-skill";
export const INSTALL_SPEC = `github:${REPO_SLUG}`;

export async function packageVersion(): Promise<string> {
  const pkg = (await Bun.file(PACKAGE_JSON).json()) as { version: string };
  return pkg.version;
}
