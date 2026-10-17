#!/usr/bin/env bun
/** Normalize the pinned Phosphor catalog and validate curated recommendations. */
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { casefoldCompare, checkedDate as checkedIsoDate, codepointCompare, fail, isInt, sameKeys } from "./lib/py.ts";

const PACKAGE = "@phosphor-icons/core";
const PACKAGE_VERSION = "2.1.1";
const REACT_PACKAGE = "@phosphor-icons/react";
const REACT_VERSION = "2.1.10";
const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];
const CLIENT_MODULE = "@phosphor-icons/react";
const SSR_MODULE = "@phosphor-icons/react/ssr";
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PASCAL_RE = /^[A-Z][A-Za-z0-9]*$/;
const IMPORT_RE = /^import \{ ([A-Z][A-Za-z0-9]*) \} from ['"](@phosphor-icons\/react)['"];?$/;

type Json = any;
interface Icon {
  name: string;
  component: string;
  [key: string]: unknown;
}

const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);
const pyList = (values: string[]) => `[${values.map((value) => `'${value}'`).join(", ")}]`;

async function readJson(path: string, maxBytes = 25_000_000): Promise<Json> {
  const file = Bun.file(path);
  if (file.size > maxBytes) fail(`${path}: input exceeds ${maxBytes} bytes`);
  try {
    return JSON.parse(await file.text());
  } catch (error) {
    fail(`${path}: invalid JSON: ${(error as Error).message}`);
  }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item)) fail(`${label} must be a string array`);
  return [...new Set<string>(value)].sort(casefoldCompare);
}

function normalizeAlias(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || !sameKeys(value, ["name", "pascal_name"])) fail(`${label}: alias must contain name and pascal_name`);
  if (!NAME_RE.test(value.name) || !PASCAL_RE.test(value.pascal_name)) fail(`${label}: invalid alias`);
  return { name: value.name as string, component: value.pascal_name as string };
}

function normalizeCatalog(payload: Json, expectedCount: number): Icon[] {
  if (!Array.isArray(payload) || payload.length !== expectedCount) {
    fail(`Phosphor catalog expected ${expectedCount} icons, got ${Array.isArray(payload) ? payload.length : "non-list"}`);
  }
  const required = ["name", "pascal_name", "codepoint", "categories", "figma_category", "tags", "published_in", "updated_in"];
  const allowed = new Set([...required, "alias"]);
  const normalized: Icon[] = [];
  const names = new Set<string>();
  const components = new Set<string>();
  payload.forEach((item: Json, index: number) => {
    if (!isObject(item) || Object.keys(item).some((key) => !allowed.has(key)) || !required.every((key) => key in item)) {
      fail(`Phosphor item ${index}: invalid official IconEntry schema`);
    }
    const { name, pascal_name: component, codepoint } = item;
    if (typeof name !== "string" || !NAME_RE.test(name)) fail(`Phosphor item ${index}: invalid name`);
    if (typeof component !== "string" || !PASCAL_RE.test(component)) fail(`${name}: invalid pascal_name`);
    if (!isInt(codepoint) || codepoint < 0) fail(`${name}: invalid codepoint`);
    if (names.has(name) || components.has(component)) fail(`${name}: duplicate name or component`);
    for (const field of ["published_in", "updated_in"]) {
      if (typeof item[field] !== "number" || item[field] <= 0) fail(`${name}: invalid ${field}`);
    }
    names.add(name);
    components.add(component);
    const entry: Icon = {
      name,
      component,
      codepoint,
      categories: stringList(item.categories, `${name}.categories`),
      figmaCategory: item.figma_category,
      tags: stringList(item.tags, `${name}.tags`),
      publishedIn: item.published_in,
      updatedIn: item.updated_in,
      clientImport: `import { ${component} } from "${CLIENT_MODULE}"`,
      ssrImport: `import { ${component} } from "${SSR_MODULE}"`,
    };
    if (typeof entry.figmaCategory !== "string" || !entry.figmaCategory) fail(`${name}: invalid figma_category`);
    const alias = normalizeAlias(item.alias, name);
    if (alias) entry.alias = alias;
    normalized.push(entry);
  });
  const canonicalNames = new Set(normalized.map((icon) => icon.name));
  const canonicalComponents = new Set(normalized.map((icon) => icon.component));
  const aliasNames = new Set<string>();
  const aliasComponents = new Set<string>();
  for (const icon of normalized) {
    const alias = icon.alias as { name: string; component: string } | undefined;
    if (!alias) continue;
    if (canonicalNames.has(alias.name) || aliasNames.has(alias.name) || canonicalComponents.has(alias.component) || aliasComponents.has(alias.component)) {
      fail(`${icon.name}: alias collides with a canonical or alias identity`);
    }
    aliasNames.add(alias.name);
    aliasComponents.add(alias.component);
  }
  return normalized.sort((a, b) => codepointCompare(a.name, b.name));
}

function validatePackage(payload: Json): void {
  if (!isObject(payload) || payload.name !== PACKAGE) fail(`package metadata must identify ${PACKAGE}`);
  if (payload.version !== PACKAGE_VERSION) fail(`${PACKAGE} version must be ${PACKAGE_VERSION}, got '${payload.version}'`);
  const exports = payload.exports;
  if (!isObject(exports) || !WEIGHTS.every((weight) => `./${weight}/*.svg` in exports)) fail(`${PACKAGE} package exports must contain all six weight asset paths`);
}

function validateReact(packagePayload: Json, exportsPayload: Json, icons: Icon[]): void {
  if (!isObject(packagePayload) || packagePayload.name !== REACT_PACKAGE) fail(`React package metadata must identify ${REACT_PACKAGE}`);
  if (packagePayload.version !== REACT_VERSION) fail(`${REACT_PACKAGE} version must be ${REACT_VERSION}, got '${packagePayload.version}'`);
  if (!isObject(exportsPayload) || !sameKeys(exportsPayload, ["client", "ssr"])) fail("React exports input must contain only client and ssr arrays");
  const client = new Set(stringList(exportsPayload.client, "client exports"));
  const ssr = new Set(stringList(exportsPayload.ssr, "ssr exports"));
  const all = icons.map((icon) => icon.component);
  const missingClient = all.filter((c) => !client.has(c)).sort(codepointCompare);
  const missingSsr = all.filter((c) => !ssr.has(c)).sort(codepointCompare);
  if (missingClient.length || missingSsr.length) fail(`React exports missing client=${pyList(missingClient.slice(0, 5))} ssr=${pyList(missingSsr.slice(0, 5))}`);
}

function checkedDate(value: unknown): string {
  try {
    return checkedIsoDate(value, "verified-at");
  } catch (error) {
    const message = (error as Error).message;
    fail(message.includes("suspicious") ? `verified-at has suspicious date '${value}'` : "verified-at must use YYYY-MM-DD");
  }
}

async function validateCurated(path: string, icons: Icon[]): Promise<number> {
  const byName = new Map(icons.map((icon) => [icon.name, icon]));
  const [header, ...rows] = parseCsv(await Bun.file(path).text());
  if (!header || !["Icon Name", "Library", "Import Code"].every((column) => header.includes(column))) fail(`${path}: missing curated icon columns`);
  const col = (name: string) => header.indexOf(name);
  let validated = 0;
  let line = 1;
  for (const values of rows) {
    if (values.length === 0) continue;
    line++;
    if (values[col("Library")] !== "Phosphor") continue;
    const name = values[col("Icon Name")] ?? "";
    if (!byName.has(name)) fail(`${path}:${line}: curated icon '${name}' is absent upstream`);
    const importCode = values[col("Import Code")];
    if (typeof importCode !== "string") fail(`${path}:${line}: missing Phosphor client import`);
    const match = IMPORT_RE.exec(importCode.trim());
    if (!match || match[2] !== CLIENT_MODULE) fail(`${path}:${line}: invalid Phosphor client import`);
    if (match[1] !== byName.get(name)!.component) fail(`${path}:${line}: import component does not match '${name}'`);
    validated++;
  }
  return validated;
}

async function writeManifest(path: string, icons: Icon[], curatedCount: number, verifiedAt: string): Promise<void> {
  const manifest = {
    schemaVersion: 1,
    source: {
      package: PACKAGE,
      version: PACKAGE_VERSION,
      repository: "https://github.com/phosphor-icons/core",
      reactPackage: REACT_PACKAGE,
      reactVersion: REACT_VERSION,
    },
    status: "active",
    verifiedAt,
    iconCount: icons.length,
    weights: WEIGHTS,
    reactImports: { clientModule: CLIENT_MODULE, ssrModule: SSR_MODULE },
    curatedValidatedCount: curatedCount,
    icons,
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}`);
  try {
    await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        input: { type: "string" },
        "package-json": { type: "string" },
        "react-package-json": { type: "string" },
        "react-exports-input": { type: "string" },
        "curated-csv": { type: "string" },
        output: { type: "string" },
        "verified-at": { type: "string" },
        "expected-count": { type: "string", default: "1512" },
      },
    });
    for (const required of ["input", "package-json", "react-package-json", "react-exports-input", "curated-csv", "output", "verified-at"] as const) {
      if (!values[required]) fail(`--${required} is required`);
    }
    validatePackage(await readJson(values["package-json"]!, 1_000_000));
    const icons = normalizeCatalog(await readJson(values.input!), Number.parseInt(values["expected-count"]!, 10));
    validateReact(await readJson(values["react-package-json"]!, 1_000_000), await readJson(values["react-exports-input"]!), icons);
    const curated = await validateCurated(values["curated-csv"]!, icons);
    await writeManifest(values.output!, icons, curated, checkedDate(values["verified-at"]));
  } catch (error) {
    console.error(`refresh-icon-catalog: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
