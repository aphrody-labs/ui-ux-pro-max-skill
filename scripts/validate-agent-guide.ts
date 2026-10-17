#!/usr/bin/env bun
/** Validate agent guide claims and run its locked semantic examples. */
import { basename, join } from "node:path";
import { CSV_CONFIG } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { parseCsvRecords, type Row } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { DATA_DIR, REPO_ROOT, SEARCH_SCRIPT, SKILL_DIR } from "./lib/paths.ts";

const TEMPLATES = join(REPO_ROOT, "cli", "templates");
const PLATFORMS = join(TEMPLATES, "platforms");
const GUIDE = join(TEMPLATES, "base", "skill-content.md");
const CLAUDE_GUIDE = join(SKILL_DIR, "SKILL.md");
const README = join(REPO_ROOT, "README.md");
const README_ZH = join(REPO_ROOT, "README.zh.md");
export const DOMAINS: ReadonlySet<string> = new Set(Object.keys(CSV_CONFIG));
export const FLAGS: ReadonlySet<string> = new Set([
  "--domain", "-d", "--stack", "-s", "--max-results", "-n", "--json",
  "--full", "--design-system", "-ds", "--project-name", "-p", "--format",
  "-f", "--persist", "--page", "--output-dir", "-o", "--force",
  "--variance", "--motion", "--density", "--brand", "-b",
]);
export const PLATFORM_COUNT = 23;
const GUIDE_REQUIREMENTS = [
  "## Query Contract", "one dominant intent", "Retry once",
  "Do not persist unverified output", "explicit accessibility outcome terms",
];
const SEARCH_COMMAND = /search\.ts|\{\{SCRIPT_PATH\}\}/;
const QUOTED_QUERY = /search\.ts"?\s+"[^"]+"/;
const DOMAIN_FLAG = /--domain\s+(\S+)/;
const STACK_FLAG = /--stack\s+(\S+)/;

const rowCache = new Map<string, Row[]>();
async function rowsOf(name: string): Promise<Row[]> {
  let rows = rowCache.get(name);
  if (!rows) {
    rows = parseCsvRecords(await Bun.file(join(DATA_DIR, name)).text());
    rowCache.set(name, rows);
  }
  return rows;
}
const rowCount = async (name: string) => (await rowsOf(name)).length;

async function styleCounts() {
  const rows = await rowsOf("styles.csv");
  return {
    searchable: rows.filter((row) => row.Status !== "deprecated").length,
    active: rows.filter((row) => row.Status === "active").length,
  };
}

export function stackNames(): Set<string> {
  return new Set([...new Bun.Glob("*.csv").scanSync({ cwd: join(DATA_DIR, "stacks") })].map((p) => basename(p, ".csv")));
}

/** Canonical skill description; SKILL.md frontmatter and every platform config must carry it verbatim. */
export async function expectedDescription(): Promise<string> {
  const styles = await styleCounts();
  const brands = (await Bun.file(join(DATA_DIR, "brands.csv")).exists()) ? `${await rowCount("brands.csv")} Aphrody brand themes, ` : "";
  return (
    "UI/UX design intelligence for web, mobile, and desktop. This skill should be used when designing, " +
    "building, reviewing, or fixing interfaces, including pages, components, design " +
    "systems, accessibility, interaction, responsive layout, typography, color, " +
    "charts, and stack-specific UI implementation. Searchable local data: " +
    `${styles.searchable} searchable styles (${styles.active} active), ` +
    `${await rowCount("colors.csv")} product palettes ` +
    `and reasoning profiles, ${await rowCount("typography.csv")} font pairings, ` +
    `${await rowCount("ux-guidelines.csv")} UX guidelines, ${await rowCount("icons.csv")} icons, ` +
    `${await rowCount("motion.csv")} GSAP presets, ${await rowCount("charts.csv")} chart types, ` +
    `${brands}and ${stackNames().size} stacks (including Bun OS Material 3 and rg-ui).`
  );
}

/** POSIX-shell-like word splitting (single/double quotes, backslash escapes). */
export function shellSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) current += command[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < command.length) {
      current += command[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) throw new Error("No closing quotation");
  if (started) tokens.push(current);
  return tokens;
}

async function runJson(...args: string[]): Promise<Record<string, any>> {
  const proc = Bun.spawnSync([process.execPath, SEARCH_SCRIPT, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`search.ts ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  return JSON.parse(proc.stdout.toString());
}

export function validateCommands(label: string, text: string): string[] {
  const errors: string[] = [];
  const commands = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((command) => command.startsWith("bun ") && SEARCH_COMMAND.test(command))
    .map((command) => command.replaceAll("{{SCRIPT_PATH}}", "search.ts"));
  if (commands.length === 0) errors.push(`${label}: no documented search commands found`);
  const stacks = stackNames();
  for (const command of commands) {
    if (!QUOTED_QUERY.test(command)) errors.push(`${label}: query must immediately follow search.ts: ${command}`);
    let tokens: string[];
    try {
      tokens = shellSplit(command.replaceAll("[", "").replaceAll("]", ""));
    } catch (error) {
      errors.push(`${label}: invalid shell command (${(error as Error).message}): ${command}`);
      continue;
    }
    const unknown = [...new Set(tokens.filter((token) => token.startsWith("-") && !FLAGS.has(token)))].sort();
    if (unknown.length) errors.push(`${label}: unknown flags [${unknown.map((f) => `'${f}'`).join(", ")}]: ${command}`);
    const domain = DOMAIN_FLAG.exec(command)?.[1];
    if (domain && !DOMAINS.has(domain) && domain !== "<domain>") errors.push(`${label}: unknown domain '${domain}'`);
    const stack = STACK_FLAG.exec(command)?.[1];
    if (stack && !stacks.has(stack) && stack !== "<stack>") errors.push(`${label}: unknown stack '${stack}'`);
    if (command.includes("--persist") && !command.includes("--output-dir")) errors.push(`${label}: persisted command lacks --output-dir`);
  }
  return errors;
}

export async function validate(): Promise<string[]> {
  const errors: string[] = [];
  const productCounts = {
    products: await rowCount("products.csv"),
    palettes: await rowCount("colors.csv"),
    "reasoning profiles": await rowCount("ui-reasoning.csv"),
  };
  if (new Set(Object.values(productCounts)).size !== 1) errors.push(`product/palette/reasoning counts differ: ${JSON.stringify(productCounts)}`);

  const description = await expectedDescription();
  const claudeText = await Bun.file(CLAUDE_GUIDE).text();
  if (!claudeText.includes(description)) errors.push("claude: frontmatter description/counts differ from canonical metadata");
  const styles = await styleCounts();
  const guideClaims = [
    `${styles.searchable} searchable styles (${styles.active} active)`,
    `${await rowCount("typography.csv")} font pairings`,
    `${await rowCount("ux-guidelines.csv")} UX guidelines`,
    `${await rowCount("icons.csv")} curated icons`,
    `${await rowCount("motion.csv")} GSAP presets`,
    `${await rowCount("charts.csv")} chart types`,
    `${stackNames().size} technology stacks`,
  ];
  for (const claim of guideClaims) if (!claudeText.includes(claim)) errors.push(`claude: missing live count claim '${claim}'`);

  const reasoningCount = await rowCount("ui-reasoning.csv");
  const uxCount = await rowCount("ux-guidelines.csv");
  const publicClaims: [string, string[]][] = [
    [README, [`${reasoningCount} Reasoning Rules`, `${uxCount} UX Guidelines`]],
    [README_ZH, [`${reasoningCount} 条推理规则`, `${uxCount} 条 UX 指南`]],
  ];
  for (const [path, claims] of publicClaims) {
    const text = await Bun.file(path).text();
    for (const claim of claims) if (!text.includes(claim)) errors.push(`${basename(path)}: missing live count claim '${claim}'`);
  }

  const configs = [...new Bun.Glob("*.json").scanSync({ cwd: PLATFORMS })].sort();
  if (configs.length !== PLATFORM_COUNT) errors.push(`expected ${PLATFORM_COUNT} platform configs, got ${configs.length}`);
  for (const name of configs) {
    const config = (await Bun.file(join(PLATFORMS, name)).json()) as { description?: string; frontmatter?: { description?: string } | null };
    if (config.description !== description) errors.push(`${name}: stale description`);
    const fm = config.frontmatter ?? {};
    if (fm.description && fm.description !== description) errors.push(`${name}: stale frontmatter description`);
  }

  for (const [label, path] of [["canonical", GUIDE], ["claude", CLAUDE_GUIDE]] as const) {
    const text = await Bun.file(path).text();
    for (const phrase of GUIDE_REQUIREMENTS) if (!text.includes(phrase)) errors.push(`${label}: missing '${phrase}'`);
    errors.push(...validateCommands(label, text));
  }

  const design = await runJson("beauty spa wellness service", "--design-system");
  if (design.design_system?.category !== "Beauty/Spa/Wellness Service") errors.push("design-system example resolved wrong product category");
  const ux = await runJson("keyboard focus modal", "--domain", "ux");
  if (ux.domain !== "ux" || !ux.results?.length) errors.push("focused UX example did not return an explicit UX match");
  const stack = await runJson("virtualized list", "--stack", "react-native");
  if (stack.stack !== "react-native" || !stack.results?.length) errors.push("React Native stack example did not return a stack match");
  return errors;
}

if (import.meta.main) {
  const problems = await validate();
  if (problems.length) {
    console.error(`Agent guide validation failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Agent guide validation passed: ${PLATFORM_COUNT} platforms and 3 locked examples checked.`);
}
