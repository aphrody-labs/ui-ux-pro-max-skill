#!/usr/bin/env bun
/** Refresh the Google Fonts catalog from official, reviewable inputs. */
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { formatCsvRecords, parseCsv, type Row } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import {
  casefoldCompare,
  checkedDate,
  codepointCompare,
  fail,
  formatG,
  isInt,
  isNumber,
  pyDumps,
  pyStringLiteral,
  quotePlus,
  sameKeys,
} from "./lib/py.ts";

const API_URL = "https://www.googleapis.com/webfonts/v1/webfonts";
const MAX_INPUT_BYTES = 25_000_000;
export const CSV_FIELDS = [
  "Family", "Category", "Stroke", "Classifications", "Keywords", "Styles",
  "Variable Axes", "Subsets", "Designers", "Popularity Rank", "Trending Rank",
  "Is Noto", "Date Added", "Last Modified", "Google Fonts URL",
];
const MANUAL_FIELDS = ["Stroke", "Classifications", "Keywords", "Popularity Rank", "Trending Rank", "Is Noto"];
const MANUAL_SET = new Set(MANUAL_FIELDS);
const CATALOG_FIELDS = [
  "family", "displayName", "category", "stroke", "classifications", "size", "subsets",
  "fonts", "axes", "designers", "lastModified", "dateAdded", "popularity", "trending",
  "defaultSort", "androidFragment", "isNoto", "colorCapabilities", "primaryScript",
  "primaryLanguage", "isOpenSource", "isBrandFont", "languages",
];
const LICENSES = new Set(["OFL", "APACHE2", "UFL"]);
const CATEGORIES: Record<string, string> = {
  display: "Display", handwriting: "Handwriting", monospace: "Monospace",
  "sans-serif": "Sans Serif", serif: "Serif",
};
const VARIANT_RE = /^(regular|italic|(?:[1-9]00|1000)(?:italic)?)$/;
const METADATA_FIELD_RE = /^(name|designer|license|date_added):\s*("(?:[^"\\]|\\.)*")\s*$/gm;
const METADATA_REVISION_RE = /^(?:[0-9a-f]{40}|fixture-[a-z0-9][a-z0-9.-]{0,63})$/;

type Json = any;
interface Metadata {
  name: string;
  designer: string[];
  license: string;
  date_added: string;
  [key: string]: unknown;
}

async function readJson(path: string, maxBytes = MAX_INPUT_BYTES): Promise<Json> {
  const file = Bun.file(path);
  if (file.size > maxBytes) fail(`${path}: input exceeds ${maxBytes} bytes`);
  try {
    return JSON.parse(await file.text());
  } catch (error) {
    fail(`${path}: invalid JSON: ${(error as Error).message}`);
  }
}

const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);

export function validExclusionSource(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const authority = /^https:\/\/([^/?#]*)(.*)$/s.exec(value);
  if (!authority || /[@:]/.test(authority[1]!)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hostname === "fonts.google.com") return authority[2]!.length > 0 && !/^[?#]/.test(authority[2]!);
  return url.hostname === "github.com" && (url.pathname === "/google/fonts" || url.pathname.startsWith("/google/fonts/"));
}

async function fetchLiveCatalog(): Promise<Json> {
  const key = Bun.env.GOOGLE_FONTS_API_KEY;
  if (!key) fail("GOOGLE_FONTS_API_KEY is required for --live; use --api-input for offline CI");
  const url = `${API_URL}?${new URLSearchParams({ key, capability: "VF" })}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_INPUT_BYTES) fail(`Google Fonts response exceeds ${MAX_INPUT_BYTES} bytes`);
  const raw = await response.arrayBuffer();
  if (raw.byteLength > MAX_INPUT_BYTES) fail(`Google Fonts response exceeds ${MAX_INPUT_BYTES} bytes`);
  if (!response.ok) fail(`Google Fonts API request failed: ${response.status} ${response.statusText}`);
  return JSON.parse(new TextDecoder().decode(raw));
}

function validateApi(payload: Json, expectedCount: number | undefined): Json[] {
  if (!isObject(payload) || payload.kind !== "webfonts#webfontList") fail("Google Fonts response must be a webfonts#webfontList object");
  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) fail("Google Fonts response items must be a non-empty array");
  if (expectedCount !== undefined && items.length !== expectedCount) fail(`Google Fonts response expected ${expectedCount} items, got ${items.length}`);
  const required = ["family", "variants", "subsets", "version", "lastModified", "files", "category", "kind"];
  const seen = new Set<string>();
  items.forEach((item: Json, index: number) => {
    if (!isObject(item) || !required.every((key) => key in item)) fail(`Google Fonts item ${index}: missing required Developer API fields`);
    const family = item.family;
    if (typeof family !== "string" || !family.trim() || seen.has(family)) fail(`Google Fonts item ${index}: invalid or duplicate family`);
    seen.add(family);
    if (item.kind !== "webfonts#webfont" || !(item.category in CATEGORIES)) fail(`${family}: invalid kind or category`);
    for (const field of ["variants", "subsets"]) {
      const values = item[field];
      if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === "string" && v)) fail(`${family}: ${field} must be a non-empty string array`);
    }
    if (!item.variants.every((v: string) => VARIANT_RE.test(v))) fail(`${family}: invalid variant`);
    if (!isObject(item.files) || !sameKeys(item.files, item.variants)) fail(`${family}: files must match variants exactly`);
    for (const fileUrl of Object.values(item.files)) {
      let parsed: URL | null;
      try {
        parsed = typeof fileUrl === "string" ? new URL(fileUrl) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== "https:" || parsed.hostname !== "fonts.gstatic.com" || parsed.pathname.length <= 1) {
        fail(`${family}: font files must use https://fonts.gstatic.com`);
      }
    }
    checkedDate(item.lastModified, family);
    const axes = item.axes ?? [];
    const validAxis = (a: Json) =>
      isObject(a) && sameKeys(a, ["tag", "start", "end"]) && typeof a.tag === "string" && isNumber(a.start) && isNumber(a.end) && a.start <= a.end;
    if (!Array.isArray(axes) || !axes.every(validAxis)) fail(`${family}: invalid axes`);
    if (new Set(axes.map((axis: Json) => axis.tag)).size !== axes.length) fail(`${family}: duplicate axis tags`);
  });
  return items;
}

function validateMetadata(payload: Json, families: string[]): [Map<string, Metadata>, Map<string, Json>] {
  const allowedTop = new Set(["schemaVersion", "source", "familyCount", "families", "excludedFamilies"]);
  if (!isObject(payload) || Object.keys(payload).some((key) => !allowedTop.has(key)) || !("families" in payload) || !("excludedFamilies" in payload) || !Array.isArray(payload.families)) {
    fail("google/fonts metadata must contain families and excludedFamilies arrays");
  }
  const result = new Map<string, Metadata>();
  const required = ["name", "license", "date_added", "designer"];
  const allowed = new Set([...required, "status", "verifiedAt"]);
  payload.families.forEach((item: Json, index: number) => {
    if (!isObject(item) || Object.keys(item).some((key) => !allowed.has(key)) || !required.every((key) => key in item)) {
      fail(`google/fonts metadata item ${index}: missing required fields`);
    }
    const name = item.name;
    if (typeof name !== "string" || result.has(name)) fail(`google/fonts metadata item ${index}: invalid or duplicate name`);
    if (!LICENSES.has(item.license)) fail(`${name}: invalid or missing official license '${item.license}'`);
    checkedDate(item.date_added, name);
    if ((item.status ?? "active") !== "active") fail(`${name}: covered license metadata status must be active`);
    if ("verifiedAt" in item) checkedDate(item.verifiedAt, `${name}.verifiedAt`);
    const designers = Array.isArray(item.designer) ? item.designer : [item.designer];
    if (designers.length === 0 || !designers.every((value: unknown) => typeof value === "string" && value.trim())) fail(`${name}: invalid designer metadata`);
    result.set(name, { ...item, designer: designers } as Metadata);
  });
  const exclusions = new Map<string, Json>();
  if (!Array.isArray(payload.excludedFamilies)) fail("google/fonts excludedFamilies must be an array");
  const exclusionKeys = new Set(["name", "reason", "source", "status", "verifiedAt"]);
  payload.excludedFamilies.forEach((item: Json, index: number) => {
    if (!isObject(item) || Object.keys(item).some((key) => !exclusionKeys.has(key)) || !["name", "reason", "source"].every((key) => key in item)) {
      fail(`excludedFamilies item ${index}: invalid schema`);
    }
    const name = item.name;
    if (typeof name !== "string" || !name || exclusions.has(name) || result.has(name)) fail(`excludedFamilies item ${index}: invalid, duplicate, or covered name`);
    if (typeof item.reason !== "string" || !item.reason.trim() || !validExclusionSource(item.source)) {
      fail(`${name}: exclusion needs a reason and an official Google Fonts source`);
    }
    if ((item.status ?? "needs-review") !== "needs-review") fail(`${name}: exclusion status must be needs-review`);
    if ("verifiedAt" in item) checkedDate(item.verifiedAt, `${name}.verifiedAt`);
    exclusions.set(name, item);
  });
  const expected = new Set(families);
  const covered = new Set([...result.keys(), ...exclusions.keys()]);
  const missing = [...expected].filter((family) => !covered.has(family)).sort(codepointCompare);
  const unexpected = [...covered].filter((family) => !expected.has(family)).sort(codepointCompare);
  if (missing.length) fail(`google/fonts metadata missing families: ${missing.slice(0, 5).join(", ")}`);
  if (unexpected.length) fail(`google/fonts metadata has unexpected families: ${unexpected.slice(0, 5).join(", ")}`);
  return [result, exclusions];
}

/** Normalize exact-family METADATA.pb records from an official google/fonts checkout. */
async function metadataFromRepository(root: string, families: string[]): Promise<Json> {
  const records = new Map<string, Record<string, unknown>>();
  if (!(await stat(root).then((info) => info.isDirectory(), () => false))) fail(`${root}: google/fonts metadata root is missing`);
  {
    for await (const relative of new Bun.Glob("**/METADATA.pb").scan({ cwd: root })) {
      const path = join(root, relative);
      let text: string;
      try {
        text = await Bun.file(path).text();
      } catch (error) {
        fail(`${path}: unreadable METADATA.pb: ${(error as Error).message}`);
      }
      const values = new Map<string, string[]>();
      for (const [, key, raw] of text.matchAll(METADATA_FIELD_RE)) {
        values.set(key!, [...(values.get(key!) ?? []), pyStringLiteral(raw!)]);
      }
      const names = values.get("name") ?? [];
      if (names.length === 0) continue;
      const family = names[0]!;
      const record = {
        name: family,
        designer: values.get("designer") ?? [],
        license: values.get("license")?.[0] ?? "",
        date_added: values.get("date_added")?.[0] ?? "",
      };
      const previous = records.get(family);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) fail(`conflicting official metadata for ${family}`);
      records.set(family, record);
    }
  }
  if (records.size === 0) fail(`${root}: no METADATA.pb family records found`);
  const covered = families.filter((family) => records.has(family)).map((family) => records.get(family));
  if (covered.length < Math.max(1, Math.ceil(families.length * 0.9))) fail(`${root}: official metadata covers fewer than 90% of requested families`);
  const excludedFamilies = families
    .filter((family) => !records.has(family))
    .map((family) => ({
      name: family,
      reason: "No exact-family METADATA.pb entry in the official google/fonts snapshot",
      source: `https://fonts.google.com/specimen/${quotePlus(family)}`,
    }));
  return { families: covered, excludedFamilies };
}

function validateCatalog(payload: Json, expectedCount: number | undefined): Json[] {
  if (!isObject(payload) || !sameKeys(payload, ["axisRegistry", "familyMetadataList", "promotedScript"])) {
    fail("Fonts catalog cross-check must contain axisRegistry, familyMetadataList, and promotedScript");
  }
  const items = payload.familyMetadataList;
  if (!Array.isArray(items) || items.length === 0) fail("Fonts catalog items must be a non-empty array");
  if (expectedCount !== undefined && items.length !== expectedCount) fail(`Fonts catalog expected ${expectedCount} items, got ${items.length}`);
  const categories = new Set(Object.values(CATEGORIES));
  const seen = new Set<string>();
  items.forEach((item: Json, index: number) => {
    if (!isObject(item) || !sameKeys(item, CATALOG_FIELDS)) fail(`Fonts catalog item ${index}: invalid familyMetadataList schema`);
    const family = item.family;
    if (typeof family !== "string" || !family || seen.has(family)) fail(`Fonts catalog item ${index}: invalid or duplicate family`);
    seen.add(family);
    if (!categories.has(item.category)) fail(`${family}: invalid catalog category`);
    for (const field of ["subsets", "designers", "classifications"]) {
      if (!Array.isArray(item[field]) || !item[field].every((value: unknown) => typeof value === "string" && value)) fail(`${family}: invalid ${field}`);
    }
    if (item.designers.length === 0 || !isObject(item.fonts) || Object.keys(item.fonts).length === 0) fail(`${family}: designers and fonts must be non-empty`);
    if (!isInt(item.size) || item.size < 0) fail(`${family}: invalid catalog size`);
    for (const metrics of Object.values(item.fonts)) {
      if (!isObject(metrics) || !sameKeys(metrics, ["thickness", "slant", "width", "lineHeight"])) fail(`${family}: invalid catalog font metrics`);
      if (!Object.values(metrics).every((value) => value === null || (isNumber(value) && Number.isFinite(value)))) fail(`${family}: invalid catalog font metric value`);
    }
    // The live catalog uses `1`/`1i` for a small set of variable families.
    if (!Object.keys(item.fonts).every((key) => /^(?:1|[1-9]00|1000)i?$/.test(key))) fail(`${family}: invalid catalog font variants`);
    if (!["popularity", "trending"].every((field) => isInt(item[field]) && item[field] >= 0) || typeof item.isNoto !== "boolean") {
      fail(`${family}: invalid popularity, trending, or isNoto`);
    }
    checkedDate(item.dateAdded, family);
    checkedDate(item.lastModified, family);
    const validAxis = (axis: Json) =>
      isObject(axis) &&
      sameKeys(axis, ["tag", "min", "max", "defaultValue"]) &&
      typeof axis.tag === "string" &&
      isNumber(axis.min) &&
      isNumber(axis.max) &&
      isNumber(axis.defaultValue) &&
      axis.min <= axis.defaultValue &&
      axis.defaultValue <= axis.max &&
      [axis.min, axis.max, axis.defaultValue].every(Number.isFinite);
    if (!Array.isArray(item.axes) || !item.axes.every(validAxis)) fail(`${family}: invalid catalog axes`);
    if (new Set(item.axes.map((axis: Json) => axis.tag)).size !== item.axes.length) fail(`${family}: duplicate axis tags`);
  });
  return items;
}

/** Sort key of a variant: (weight, italic). */
function variantCompare(a: string, b: string): number {
  const key = (value: string): [number, boolean] => [
    value === "regular" || value === "italic" ? 400 : Number.parseInt(/^\d+/.exec(value)![0], 10),
    value.endsWith("italic") || value === "italic",
  ];
  const [wa, ia] = key(a);
  const [wb, ib] = key(b);
  return wa - wb || Number(ia) - Number(ib);
}

function variantLabel(value: string): string {
  if (value === "regular") return "400";
  if (value === "italic") return "400i";
  return value.replace("italic", "i");
}

async function loadExisting(path: string): Promise<Map<string, Row>> {
  const [header, ...rows] = parseCsv(await Bun.file(path).text());
  if (!header || header.join("\u0000") !== CSV_FIELDS.join("\u0000")) fail(`${path}: unexpected Google Fonts CSV schema`);
  const existing = new Map<string, Row>();
  for (const values of rows) {
    if (values.length === 0) continue;
    const row: Row = {};
    header.forEach((name, index) => {
      row[name] = values[index] ?? "";
    });
    existing.set(row.Family!, row);
  }
  return existing;
}

async function loadOverrides(path: string | undefined): Promise<Record<string, Record<string, string>>> {
  if (!path) return {};
  const payload = await readJson(path);
  if (!isObject(payload) || !sameKeys(payload, ["families"]) || !isObject(payload.families)) fail("override file must contain only a families object");
  for (const [family, values] of Object.entries(payload.families)) {
    if (!isObject(values) || !Object.keys(values).every((key) => MANUAL_SET.has(key)) || !Object.values(values).every((v) => typeof v === "string")) {
      fail(`${family}: overrides may only contain string-valued reviewed fields`);
    }
  }
  return payload.families;
}

function reviewedFields(old: Row): Record<string, string> {
  return Object.fromEntries(MANUAL_FIELDS.map((field) => [field, old[field] ?? ""]));
}

const sortedUnique = (values: string[]) => [...new Set(values)].sort(codepointCompare);
const specimenUrl = (family: string) => `https://fonts.google.com/specimen/${quotePlus(family)}`;

function normalizeApi(items: Json[], metadata: Map<string, Metadata>, existing: Map<string, Row>, overrides: Record<string, Record<string, string>>): Row[] {
  return [...items]
    .sort((a, b) => casefoldCompare(a.family, b.family))
    .map((item) => {
      const family: string = item.family;
      const reviewed = { ...reviewedFields(existing.get(family) ?? {}), ...(overrides[family] ?? {}) };
      const axes = [...(item.axes ?? [])].sort((a: Json, b: Json) => codepointCompare(a.tag, b.tag));
      return {
        Family: family,
        Category: CATEGORIES[item.category]!,
        ...reviewed,
        Styles: [...new Set<string>(item.variants)].sort(variantCompare).map(variantLabel).join(" | "),
        "Variable Axes": axes.map((a: Json) => `${a.tag}: ${formatG(a.start)}..${formatG(a.end)}`).join(" | "),
        Subsets: sortedUnique(item.subsets).join(" | "),
        Designers: metadata.get(family)!.designer.join(" | "),
        "Date Added": metadata.get(family)!.date_added,
        "Last Modified": item.lastModified,
        "Google Fonts URL": specimenUrl(family),
      };
    });
}

function normalizeCatalog(items: Json[], existing: Map<string, Row>, overrides: Record<string, Record<string, string>>): Row[] {
  return [...items]
    .sort((a, b) => casefoldCompare(a.family, b.family))
    .map((item) => {
      const family: string = item.family;
      const reviewed = {
        ...reviewedFields(existing.get(family) ?? {}),
        Stroke: item.stroke || "",
        Classifications: sortedUnique(item.classifications).join(" | "),
        "Popularity Rank": String(item.popularity),
        "Trending Rank": String(item.trending),
        "Is Noto": item.isNoto ? "Yes" : "No",
        ...(overrides[family] ?? {}),
      };
      const axes = [...item.axes].sort((a: Json, b: Json) => codepointCompare(a.tag, b.tag));
      return {
        Family: family,
        Category: item.category,
        ...reviewed,
        Styles: Object.keys(item.fonts).sort(variantCompare).join(" | "),
        "Variable Axes": axes.map((a: Json) => `${a.tag}: ${formatG(a.min)}..${formatG(a.max)}`).join(" | "),
        Subsets: sortedUnique(item.subsets.filter((subset: string) => subset !== "menu")).join(" | "),
        Designers: item.designers.join(" | "),
        "Date Added": item.dateAdded,
        "Last Modified": item.lastModified,
        "Google Fonts URL": specimenUrl(family),
      };
    });
}

async function exclusiveCreate(path: string, content: string): Promise<boolean> {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") return false;
    throw error;
  }
}

async function writeOutputs(
  rows: Row[],
  metadata: Map<string, Metadata>,
  exclusions: Map<string, Json>,
  csvPath: string,
  licensePath: string,
  verifiedAt: string,
  metadataRevision: string,
): Promise<void> {
  const licenses = {
    schemaVersion: 1,
    source: { repository: "https://github.com/google/fonts", metadataFile: "METADATA.pb", revision: metadataRevision },
    familyCount: rows.length,
    families: rows.map((row) => {
      const meta = metadata.get(row.Family!)!;
      return { name: row.Family, license: meta.license, date_added: meta.date_added, designer: meta.designer, status: "active", verifiedAt };
    }),
    excludedFamilies: [...exclusions.keys()].sort(casefoldCompare).map((name) => {
      const item = exclusions.get(name);
      return { name: item.name, reason: item.reason, source: item.source, status: "needs-review", verifiedAt };
    }),
  };
  const outputs: [string, string][] = [
    [licensePath, `${JSON.stringify(licenses, null, 2)}\n`],
    [csvPath, formatCsvRecords(CSV_FIELDS, rows, "\n")],
  ];
  const parent = dirname(csvPath);
  const lockPath = join(parent, ".google-font-refresh.lock");
  const markerPath = join(parent, ".google-font-refresh.incomplete.json");
  if (await Bun.file(markerPath).exists()) fail(`${markerPath}: incomplete prior refresh requires review`);
  await mkdir(parent, { recursive: true });
  if (!(await exclusiveCreate(lockPath, `verifiedAt=${verifiedAt}\n`))) fail(`${lockPath}: another refresh is already running`);
  const staged: [string, string][] = [];
  let published = false;
  let complete = false;
  let markerCreated = false;
  try {
    for (const [target, content] of outputs) {
      const temporary = join(dirname(target), `.${basename(target)}.${crypto.randomUUID()}`);
      await Bun.write(temporary, content);
      staged.push([temporary, target]);
    }
    markerCreated = await exclusiveCreate(
      markerPath,
      `${pyDumps({ schemaVersion: 1, targets: outputs.map(([target]) => target), verifiedAt }, true)}\n`,
    );
    if (!markerCreated) fail(`${markerPath}: incomplete prior refresh requires review`);
    for (const [temporary, target] of staged) {
      await rename(temporary, target);
      published = true;
    }
    complete = true;
  } finally {
    for (const [temporary] of staged) await rm(temporary, { force: true });
    if (markerCreated && (complete || !published)) await rm(markerPath, { force: true });
    await rm(lockPath, { force: true });
  }
}

function changeReport(rows: Row[], existing: Map<string, Row>, exclusions: Map<string, Json>) {
  const generated = new Map(rows.map((row) => [row.Family!, row]));
  const managed = CSV_FIELDS.filter((field) => !MANUAL_SET.has(field) && field !== "Family");
  return {
    addedFamilies: [...generated.keys()].filter((family) => !existing.has(family)).sort(casefoldCompare),
    removedFamilies: [...existing.keys()].filter((family) => !generated.has(family)).sort(casefoldCompare),
    metadataChangedFamilies: [...existing.keys()]
      .filter((family) => generated.has(family) && managed.some((field) => (existing.get(family)![field] ?? "") !== generated.get(family)![field]))
      .sort(casefoldCompare),
    excludedFamilies: [...exclusions.keys()].sort(casefoldCompare).map((name) => ({ ...exclusions.get(name), status: "needs-review" })),
  };
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "api-input": { type: "string" },
        "catalog-input": { type: "string" },
        live: { type: "boolean" },
        "metadata-input": { type: "string" },
        "metadata-root": { type: "string" },
        "existing-csv": { type: "string" },
        overrides: { type: "string" },
        "output-csv": { type: "string" },
        "license-output": { type: "string" },
        "verified-at": { type: "string" },
        "metadata-revision": { type: "string" },
        "expected-count": { type: "string" },
        "approve-changes": { type: "boolean" },
      },
    });
    const sources = [values["api-input"], values["catalog-input"], values.live].filter(Boolean);
    if (sources.length !== 1) fail("exactly one of --api-input, --catalog-input or --live is required");
    if ([values["metadata-input"], values["metadata-root"]].filter(Boolean).length !== 1) fail("exactly one of --metadata-input or --metadata-root is required");
    for (const required of ["existing-csv", "output-csv", "license-output", "verified-at", "metadata-revision"] as const) {
      if (!values[required]) fail(`--${required} is required`);
    }
    const expectedCount = values["expected-count"] === undefined ? undefined : Number.parseInt(values["expected-count"], 10);
    const verifiedAt = checkedDate(values["verified-at"], "verified-at");
    if (!METADATA_REVISION_RE.test(values["metadata-revision"]!)) fail("metadata-revision must be a 40-character lowercase commit or fixture-* token");

    let payload: Json = null;
    if (values.live) payload = await fetchLiveCatalog();
    else if (values["api-input"]) payload = await readJson(values["api-input"]);
    const existing = await loadExisting(values["existing-csv"]!);
    const overrides = await loadOverrides(values.overrides);
    const loadMetadata = async (families: string[]) =>
      values["metadata-input"] ? readJson(values["metadata-input"]) : metadataFromRepository(values["metadata-root"]!, families);

    let items: Json[];
    let metadata: Map<string, Metadata>;
    let exclusions: Map<string, Json>;
    let rows: Row[];
    if (values["catalog-input"]) {
      items = validateCatalog(await readJson(values["catalog-input"]), expectedCount);
      const families = items.map((item) => item.family);
      [metadata, exclusions] = validateMetadata(await loadMetadata(families), families);
      rows = normalizeCatalog(items.filter((item) => !exclusions.has(item.family)), existing, overrides);
    } else {
      items = validateApi(payload, expectedCount);
      const families = items.map((item) => item.family);
      [metadata, exclusions] = validateMetadata(await loadMetadata(families), families);
      rows = normalizeApi(items.filter((item) => !exclusions.has(item.family)), metadata, existing, overrides);
    }
    const known = new Set(items.map((item) => item.family));
    const unknownOverrides = Object.keys(overrides).filter((family) => !known.has(family)).sort(codepointCompare);
    if (unknownOverrides.length) fail(`overrides target unknown families: ${unknownOverrides.slice(0, 5).join(", ")}`);
    const report = changeReport(rows, existing, exclusions);
    console.log(pyDumps(report, true));
    if ((report.addedFamilies.length || report.removedFamilies.length) && !values["approve-changes"]) {
      fail("family-set changes require --approve-changes after review; no outputs published");
    }
    await writeOutputs(rows, metadata, exclusions, values["output-csv"]!, values["license-output"]!, verifiedAt, values["metadata-revision"]!);
  } catch (error) {
    console.error(`refresh-google-fonts: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
