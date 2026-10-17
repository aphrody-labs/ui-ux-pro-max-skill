/** Shared helpers for the bun:test suites. Scratch space stays inside the repository (tests/.tmp, gitignored). */
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseCsvRecords, type Row } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";

export const REPO_ROOT = join(import.meta.dir, "..");
export const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");
export const SKILL_DIR = join(SKILLS_DIR, "ui-ux-pro-max");
export const DATA_DIR = join(SKILL_DIR, "data");
export const SCRIPTS_DIR = join(SKILL_DIR, "scripts");
export const SEARCH_SCRIPT = join(SCRIPTS_DIR, "search.ts");
export const FIXTURES = join(REPO_ROOT, "tests", "fixtures");
const TMP_ROOT = join(REPO_ROOT, "tests", ".tmp");

/** Remove all scratch space; every test file that uses scratchDir registers it with afterAll. */
export function cleanScratch(): void {
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

/** A fresh scratch directory under tests/.tmp, removed by cleanScratch. */
export async function scratchDir(name = "scratch"): Promise<string> {
  const dir = join(TMP_ROOT, `${name}-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readRows(name: string): Promise<Row[]> {
  return parseCsvRecords(await Bun.file(join(DATA_DIR, name)).text());
}

export async function readJson<T = any>(name: string): Promise<T> {
  return Bun.file(join(DATA_DIR, name)).json() as Promise<T>;
}

/** Run a bun script and capture its output. */
export function runBun(args: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const proc = Bun.spawnSync([process.execPath, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ? (options.env as Record<string, string>) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

export const casefold = (text: string) => text.toLowerCase();
