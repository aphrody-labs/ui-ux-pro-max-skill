import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const SKILL_DIR = join(REPO_ROOT, ".claude", "skills", "ui-ux-pro-max");
export const DATA_DIR = join(SKILL_DIR, "data");
export const SKILL_SCRIPTS_DIR = join(SKILL_DIR, "scripts");
export const SEARCH_SCRIPT = join(SKILL_SCRIPTS_DIR, "search.ts");

/** Repository-relative POSIX path, for messages. */
export function rel(path: string): string {
  return path.slice(REPO_ROOT.length + 1).replaceAll("\\", "/");
}

/** Today's date as YYYY-MM-DD in local time (Python's date.today()). */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
