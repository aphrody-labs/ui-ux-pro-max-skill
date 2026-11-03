#!/usr/bin/env bun
/**
 * Rewrites package-manager commands in the catalogs to their Bun equivalents.
 *
 * Upstream rows say `npx shadcn@latest add`, `pnpm add @nuxt/ui` or `npm install three`; this fork
 * runs everything on Bun, so the rows say `bunx --bun shadcn@latest add`, `bun add @nuxt/ui` and
 * `bun add three`. The rewrite is idempotent and only touches command text, never prose such as
 * "install from npm". After an upstream merge, resolve a conflicting catalog by taking the upstream
 * side and running this script:
 *
 *   bun scripts/bunify-catalogs.ts            # rewrite every data/*.csv and data/stacks/*.csv
 *   bun scripts/bunify-catalogs.ts --check    # exit 1 when a catalog still has npm/pnpm/yarn commands
 */
import { Glob } from "bun";
import { join } from "node:path";

const DATA = join(import.meta.dir, "..", ".claude", "skills", "ui-ux-pro-max", "data");

/** Ordered rules; earlier rules win because later ones no longer match the rewritten text. */
export const RULES: readonly [RegExp, string][] = [
  [/\b(?:npx|pnpm dlx|yarn dlx)\s+(?:--yes\s+)?shadcn@/g, "bunx --bun shadcn@"],
  [/\b(?:npx|pnpm dlx|yarn dlx)\s+(?:--yes\s+)?/g, "bunx "],
  [/\b(?:npm|pnpm|yarn)\s+create\s+/g, "bun create "],
  [/\b(?:npm\s+(?:install|i)|pnpm\s+(?:add|install|i)|yarn\s+add)\s+(?:--save-dev|-D)\s+(?=[@\w])/g, "bun add -d "],
  [/\b(?:npm\s+(?:install|i)|pnpm\s+(?:add|install|i)|yarn\s+add)\s+(?=[@\w-])/g, "bun add "],
  [/\b(?:npm|pnpm|yarn)\s+run\s+/g, "bun run "],
  [/\b(?:npm|pnpm|yarn)\s+install\b/g, "bun install"],
];

export function bunify(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

if (import.meta.main) {
  const check = Bun.argv.includes("--check");
  const stale: string[] = [];
  for await (const rel of new Glob("**/*.csv").scan(DATA)) {
    const file = Bun.file(join(DATA, rel));
    const before = await file.text();
    const after = bunify(before);
    if (after === before) continue;
    stale.push(rel);
    if (!check) await Bun.write(file, after);
  }
  if (check && stale.length > 0) {
    console.error(`npm/pnpm/yarn commands left in: ${stale.join(", ")} (run bun scripts/bunify-catalogs.ts)`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? "stale" : "rewrote"}: ${stale.join(", ")}` : "catalogs already use Bun commands");
}
