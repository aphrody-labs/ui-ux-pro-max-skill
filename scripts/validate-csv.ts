#!/usr/bin/env bun
/**
 * Validate UI/UX Pro Max CSV data files.
 *
 * Checks every CSV under .claude/skills/ui-ux-pro-max/data for structural
 * issues that a dict reader otherwise accepts silently:
 * - duplicate or blank header names
 * - rows with too many fields (unquoted commas)
 * - rows with too few fields (missing trailing columns)
 * - unexpected empty rows inside the dataset
 */
import { join } from "node:path";
import { parseCsv } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { DATA_DIR, rel } from "./lib/paths.ts";

/** Line number (1-based) at which each parsed row starts. */
function rowStartLines(text: string): number[] {
  const starts: number[] = [1];
  let line = 1;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "\n") {
      line++;
      if (!inQuotes) starts.push(line);
    }
  }
  return starts;
}

export async function validateFile(path: string): Promise<string[]> {
  const errors: string[] = [];
  const name = rel(path);
  const text = await Bun.file(path).text();
  const rows = parseCsv(text);
  const lines = rowStartLines(text);
  const header = rows[0];
  if (!header) return [`${name}: empty file`];
  if (header.length === 0 || header.every((col) => !col.trim())) return [`${name}: missing header`];

  const blank = header.flatMap((col, index) => (col.trim() ? [] : [index + 1]));
  if (blank.length) errors.push(`${name}: blank header columns [${blank.join(", ")}]`);
  const duplicates = [...new Set(header.filter((col) => col && header.filter((other) => other === col).length > 1))].sort();
  if (duplicates.length) errors.push(`${name}: duplicate headers [${duplicates.map((d) => `'${d}'`).join(", ")}]`);

  const expected = header.length;
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index]!;
    const lineNo = lines[index] ?? index + 1;
    if (row.length === 0 || row.every((cell) => !cell.trim())) {
      errors.push(`${name}:${lineNo}: blank row`);
      continue;
    }
    if (row.length !== expected) errors.push(`${name}:${lineNo}: expected ${expected} fields, got ${row.length}`);
  }
  return errors;
}

async function main(): Promise<number> {
  const paths = [...new Bun.Glob("**/*.csv").scanSync({ cwd: DATA_DIR })].sort().map((p) => join(DATA_DIR, p));
  if (paths.length === 0) {
    console.error(`CSV data directory not found or empty: ${DATA_DIR}`);
    return 2;
  }
  const errors: string[] = [];
  for (const path of paths) errors.push(...(await validateFile(path)));
  if (errors.length) {
    console.error("CSV validation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\nChecked ${paths.length} runtime CSV files.`);
    return 1;
  }
  console.log(`CSV validation passed: ${paths.length} runtime CSV files checked.`);
  return 0;
}

if (import.meta.main) process.exit(await main());
