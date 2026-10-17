#!/usr/bin/env bun
/** Generate or verify deterministic catalog counts and snapshot hashes. */
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { parseCsvRecords, type Row } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { DATA_DIR, REPO_ROOT, today } from "./lib/paths.ts";

export const OUTPUT = join(DATA_DIR, "catalog-summary.json");

async function rows(name: string, dataDir = DATA_DIR): Promise<Row[]> {
  return parseCsvRecords(await Bun.file(join(dataDir, name)).text());
}

/** sha256 over the bytes with CRLF normalized to LF (checkout-independent). */
export async function digest(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(bytes[i]!);
  }
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(out)).digest("hex");
}

export function checkedDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error("verified-at must use YYYY-MM-DD");
  }
  if (Number(value.slice(0, 4)) <= 1970 || value > today()) throw new Error(`verified-at has suspicious date '${value}'`);
  return value;
}

export async function build(verifiedAt: string, dataDir = DATA_DIR) {
  const styles = await rows("styles.csv", dataDir);
  const stackNames = [...new Bun.Glob("*.csv").scanSync({ cwd: join(dataDir, "stacks") })].map((p) => basename(p)).sort();
  const licenses = (await Bun.file(join(dataDir, "google-font-licenses.json")).json()) as {
    excludedFamilies?: { name: string; reason: string }[];
  };
  const icons = (await Bun.file(join(dataDir, "phosphor-icons-upstream.json")).json()) as { iconCount?: number };
  let stackGuidelines = 0;
  for (const name of stackNames) stackGuidelines += (await rows(`stacks/${name}`, dataDir)).length;
  const brandsFile = Bun.file(join(dataDir, "brands.csv"));
  const counts: Record<string, unknown> = {
    styles: {
      total: styles.length,
      searchable: styles.filter((row) => row.Status !== "deprecated").length,
      active: styles.filter((row) => row.Status === "active").length,
      supplemental: styles.filter((row) => row.Status === "supplemental").length,
      deprecated: styles.filter((row) => row.Status === "deprecated").length,
    },
    products: (await rows("products.csv", dataDir)).length,
    palettes: (await rows("colors.csv", dataDir)).length,
    reasoningProfiles: (await rows("ui-reasoning.csv", dataDir)).length,
    fontPairings: (await rows("typography.csv", dataDir)).length,
    googleFonts: (await rows("google-fonts.csv", dataDir)).length,
    curatedIcons: (await rows("icons.csv", dataDir)).length,
    upstreamPhosphorIcons: icons.iconCount ?? null,
    uxGuidelines: (await rows("ux-guidelines.csv", dataDir)).length,
    motionPresets: (await rows("motion.csv", dataDir)).length,
    chartTypes: (await rows("charts.csv", dataDir)).length,
    stacks: stackNames.length,
    stackGuidelines,
  };
  if (await brandsFile.exists()) counts.brands = (await rows("brands.csv", dataDir)).length;
  const snapshots: Record<string, { sha256: string }> = {};
  for (const name of ["google-fonts.csv", "google-font-licenses.json", "icons.csv", "phosphor-icons-upstream.json"]) {
    snapshots[name] = { sha256: await digest(join(dataDir, name)) };
  }
  return {
    schemaVersion: 1,
    verifiedAt: checkedDate(verifiedAt),
    counts,
    snapshots,
    promotionPolicy: {
      changedFamilySetRequiresExplicitApproval: true,
      relevanceGateRequired: true,
      unlicensedFamiliesExcluded: true,
    },
    pendingCandidates: (licenses.excludedFamilies ?? [])
      .map((item) => ({ family: item.name, reason: item.reason }))
      .sort((a, b) => (a.family.toLowerCase() < b.family.toLowerCase() ? -1 : a.family.toLowerCase() > b.family.toLowerCase() ? 1 : 0)),
  };
}

const fmt = (value: unknown) => Number(value).toLocaleString("en-US");

export async function checkReadmeCounts(summary: Awaited<ReturnType<typeof build>>): Promise<void> {
  const counts = summary.counts;
  const exclusions = summary.pendingCandidates.length;
  const expected: Record<string, string[]> = {
    "README.md": [
      `**${fmt(counts.googleFonts)} approved Google Fonts**`,
      `**${exclusions} review exclusions**`,
      `**${counts.curatedIcons} curated rows**`,
      `**${fmt(counts.upstreamPhosphorIcons)}-icon upstream Phosphor manifest**`,
    ],
    "README.zh.md": [
      `**${fmt(counts.googleFonts)} 个已批准的 Google Fonts**`,
      `**${exclusions} 个待审核的排除项**`,
      `**${counts.curatedIcons} 条精选记录**`,
      `**${fmt(counts.upstreamPhosphorIcons)}-icon Phosphor upstream manifest**`,
    ],
  };
  for (const [name, tokens] of Object.entries(expected)) {
    const text = await Bun.file(join(REPO_ROOT, name)).text();
    const missing = tokens.filter((token) => !text.includes(token));
    if (missing.length) throw new Error(`${name} catalog counts are stale: ${missing.join(", ")}`);
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { "verified-at": { type: "string" }, check: { type: "boolean" } },
  });
  try {
    let verifiedAt = values["verified-at"];
    const output = Bun.file(OUTPUT);
    if (values.check && !verifiedAt) {
      if (!(await output.exists())) throw new Error("catalog-summary.json is missing");
      verifiedAt = ((await output.json()) as { verifiedAt?: string }).verifiedAt;
    }
    if (!verifiedAt) throw new Error("--verified-at is required when generating the summary");
    const summary = await build(verifiedAt);
    const content = `${JSON.stringify(summary, null, 2)}\n`;
    if (values.check) {
      if (!(await output.exists()) || (await output.text()) !== content) throw new Error("catalog-summary.json is stale; regenerate it");
      await checkReadmeCounts(summary);
    } else {
      await Bun.write(OUTPUT, content);
    }
  } catch (error) {
    console.error(`generate-catalog-summary: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  console.log(values.check ? "Catalog summary is current." : "Generated catalog summary.");
  return 0;
}

if (import.meta.main) process.exit(await main());
