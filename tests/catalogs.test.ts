/**
 * Deterministic upstream catalog refreshes and line-ending independent snapshots
 * (ported from test_catalog_refresh.py and test_catalog_summary_line_endings.py).
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseCsvRecords } from "../.claude/skills/ui-ux-pro-max/scripts/csv.ts";
import { digest } from "../scripts/generate-catalog-summary.ts";
import { DATA_DIR, FIXTURES, readJson, REPO_ROOT, runBun, cleanScratch, scratchDir } from "./helpers.ts";

afterAll(cleanScratch);

const CATALOGS = join(FIXTURES, "catalogs");
const FONT_SCRIPT = join(REPO_ROOT, "scripts", "refresh-google-fonts.ts");
const ICON_SCRIPT = join(REPO_ROOT, "scripts", "refresh-icon-catalog.ts");
const SNAPSHOT_FILES = ["google-fonts.csv", "google-font-licenses.json", "icons.csv", "phosphor-icons-upstream.json"];

const run = (args: string[], env?: Record<string, string | undefined>) => runBun(args, { env });

function fontArgs(directory: string, options: { api?: string; metadata?: string; approve?: boolean; existing?: string; overrides?: string } = {}): string[] {
  const args = [
    FONT_SCRIPT,
    "--api-input", options.api ?? join(CATALOGS, "google-api.json"),
    "--metadata-input", options.metadata ?? join(CATALOGS, "google-metadata.json"),
    "--existing-csv", options.existing ?? join(CATALOGS, "google-existing.csv"),
    "--overrides", options.overrides ?? join(CATALOGS, "google-overrides.json"),
    "--output-csv", join(directory, "google-fonts.csv"),
    "--license-output", join(directory, "google-font-licenses.json"),
    "--verified-at", "2026-08-13",
    "--metadata-revision", "fixture-catalogs-v1",
    "--expected-count", "2",
  ];
  if (options.approve ?? true) args.push("--approve-changes");
  return args;
}

function iconArgs(directory: string, options: { source?: string; curated?: string; pkg?: string; reactExports?: string } = {}): string[] {
  return [
    ICON_SCRIPT,
    "--input", options.source ?? join(CATALOGS, "phosphor-core.json"),
    "--package-json", options.pkg ?? join(CATALOGS, "phosphor-package.json"),
    "--react-package-json", join(CATALOGS, "phosphor-react-package.json"),
    "--react-exports-input", options.reactExports ?? join(CATALOGS, "phosphor-react-exports.json"),
    "--curated-csv", options.curated ?? join(CATALOGS, "icons-curated.csv"),
    "--output", join(directory, "phosphor-icons-upstream.json"),
    "--verified-at", "2026-08-13",
    "--expected-count", "2",
  ];
}

const fixture = (name: string) => Bun.file(join(CATALOGS, name)).json();
const clone = <T>(value: T): T => structuredClone(value);
const rowsOf = async (path: string) => parseCsvRecords(await Bun.file(path).text());

describe("Google Fonts refresh", () => {
  test("live refresh requires the environment key", async () => {
    const args = fontArgs(await scratchDir("fonts-live"));
    args.splice(1, 2, "--live");
    const env = { ...process.env };
    delete env.GOOGLE_FONTS_API_KEY;
    const result = run(args, env);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("GOOGLE_FONTS_API_KEY is required for --live");
    expect(result.stderr).toContain("use --api-input for offline CI");
  });

  test("refresh is deterministic and preserves reviewed fields", async () => {
    const first = await scratchDir("fonts-a");
    const second = await scratchDir("fonts-b");
    expect(run(fontArgs(first)).exitCode).toBe(0);
    expect(run(fontArgs(second)).exitCode).toBe(0);
    for (const name of ["google-fonts.csv", "google-font-licenses.json"]) {
      expect(await Bun.file(join(first, name)).text()).toBe(await Bun.file(join(second, name)).text());
    }
    const rows = await rowsOf(join(first, "google-fonts.csv"));
    const licenseText = await Bun.file(join(first, "google-font-licenses.json")).text();
    const licenses = JSON.parse(licenseText);
    expect(rows.map((row) => row.Family)).toEqual(["Alpha Sans", "Zeta Serif"]);
    expect(rows[0]!.Stroke).toBe("Sans Serif");
    expect(rows[0]!.Keywords).toBe("approved override keywords");
    expect(rows[0]!.Styles).toBe("400 | 400i | 500");
    expect(rows[0]!["Variable Axes"]).toBe("wght: 100..900");
    expect(licenses.families.map((item: any) => item.license)).toEqual(["OFL", "APACHE2"]);
    expect(licenses.families.map((item: any) => item.name)).toEqual(["Alpha Sans", "Zeta Serif"]);
    expect(licenses.source.revision).toBe("fixture-catalogs-v1");
    expect(licenses.families.every((item: any) => item.status === "active" && item.verifiedAt === "2026-08-13")).toBe(true);

    const reused = await scratchDir("fonts-reuse");
    const metadata = join(reused, "metadata.json");
    await Bun.write(metadata, licenseText);
    const result = run(fontArgs(reused, { metadata }));
    expect([result.exitCode, result.stderr]).toEqual([0, ""]);
    expect(await Bun.file(join(reused, "google-fonts.csv")).text()).toBe(await Bun.file(join(first, "google-fonts.csv")).text());
  });

  test("refresh rejects schema, size, dates and licenses", async () => {
    const directory = await scratchDir("fonts-reject");
    const api = await fixture("google-api.json");
    const metadata = await fixture("google-metadata.json");
    const cases: [object, object, string][] = [];
    cases.push([{ ...api, kind: "unexpected" }, metadata, "webfonts#webfontList"]);
    cases.push([{ ...api, items: api.items.slice(0, 1) }, metadata, "expected 2 items"]);
    const badUrl = clone(api);
    badUrl.items[0].files.regular = "https://example.com/font.ttf";
    cases.push([badUrl, metadata, "https://fonts.gstatic.com"]);
    const badDate = clone(api);
    badDate.items[0].lastModified = "1970-01-01";
    cases.push([badDate, metadata, "suspicious date"]);
    const badLicense = clone(metadata);
    badLicense.families[0].license = "UNKNOWN";
    cases.push([api, badLicense, "invalid or missing official license"]);
    for (const [index, [apiValue, metadataValue, error]] of cases.entries()) {
      const apiPath = join(directory, `api-${index}.json`);
      const metadataPath = join(directory, `metadata-${index}.json`);
      await Bun.write(apiPath, JSON.stringify(apiValue));
      await Bun.write(metadataPath, JSON.stringify(metadataValue));
      const result = run(fontArgs(directory, { api: apiPath, metadata: metadataPath }));
      expect([error, result.exitCode, result.stderr.includes(error)]).toEqual([error, 2, true]);
    }
  });

  test("refresh fails closed on concurrency or an interrupted pair", async () => {
    for (const [sentinel, error] of [
      [".google-font-refresh.lock", "another refresh is already running"],
      [".google-font-refresh.incomplete.json", "incomplete prior refresh"],
    ] as const) {
      const directory = await scratchDir("fonts-sentinel");
      await Bun.write(join(directory, sentinel), "occupied\n");
      const result = run(fontArgs(directory));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(error);
      expect(await Bun.file(join(directory, "google-fonts.csv")).exists()).toBe(false);
      expect(await Bun.file(join(directory, "google-font-licenses.json")).exists()).toBe(false);
    }
  });

  test("catalog cross-check uses the explicit schema without font file URLs", async () => {
    const directory = await scratchDir("fonts-catalog");
    const args = fontArgs(directory);
    args.splice(1, 2, "--catalog-input", join(CATALOGS, "google-catalog.json"));
    const result = run(args);
    expect([result.exitCode, result.stderr]).toEqual([0, ""]);
    const rows = await rowsOf(join(directory, "google-fonts.csv"));
    expect(rows.map((row) => row.Family)).toEqual(["Alpha Sans", "Zeta Serif"]);
    expect(rows[0]!.Classifications).toBe("Geometric");
    expect(rows[0]!["Popularity Rank"]).toBe("42");
    expect(rows[0]!.Subsets).toBe("latin | vietnamese");
  });

  test("official metadata checkout is strict and reusable", async () => {
    const writeMetadata = async (root: string, families: [string, string, string][]) => {
      for (const [slug, family, license] of families) {
        const dir = join(root, "ofl", slug);
        await mkdir(dir, { recursive: true });
        await Bun.write(join(dir, "METADATA.pb"), `name: "${family}"\ndesigner: "${family} Designer"\nlicense: "${license}"\ndate_added: "2024-01-02"\n`);
      }
    };
    const withRoot = (directory: string, root: string) => {
      const args = fontArgs(directory);
      const index = args.indexOf("--metadata-input");
      args.splice(index, 2, "--metadata-root", root);
      return args;
    };
    const partial = await scratchDir("fonts-metadata-partial");
    await writeMetadata(join(partial, "google-fonts"), [["alphasans", "Alpha Sans", "OFL"]]);
    const partialResult = run(withRoot(partial, join(partial, "google-fonts")));
    expect(partialResult.exitCode).toBe(2);
    expect(partialResult.stderr).toContain("fewer than 90%");

    const full = await scratchDir("fonts-metadata-full");
    await writeMetadata(join(full, "google-fonts"), [
      ["alphasans", "Alpha Sans", "OFL"],
      ["zetaserif", "Zeta Serif", "APACHE2"],
    ]);
    const fullResult = run(withRoot(full, join(full, "google-fonts")));
    expect([fullResult.exitCode, fullResult.stderr]).toEqual([0, ""]);
    expect((await Bun.file(join(full, "google-font-licenses.json")).json()).families.map((item: any) => item.name)).toEqual(["Alpha Sans", "Zeta Serif"]);
  });

  test("catalog rejects boolean rank, duplicate axis and unreviewed addition", async () => {
    const directory = await scratchDir("fonts-catalog-reject");
    const catalog = await fixture("google-catalog.json");
    const invalidRank = clone(catalog);
    invalidRank.familyMetadataList[0].popularity = true;
    const rankPath = join(directory, "rank.json");
    await Bun.write(rankPath, JSON.stringify(invalidRank));
    const rankArgs = fontArgs(directory);
    rankArgs.splice(1, 2, "--catalog-input", rankPath);
    const rankResult = run(rankArgs);

    const invalidAxis = clone(catalog);
    invalidAxis.familyMetadataList[1].axes.push({ ...invalidAxis.familyMetadataList[1].axes[0] });
    const axisPath = join(directory, "axis.json");
    await Bun.write(axisPath, JSON.stringify(invalidAxis));
    const axisArgs = fontArgs(directory);
    axisArgs.splice(1, 2, "--catalog-input", axisPath);
    const axisResult = run(axisArgs);

    const existing = join(directory, "existing.csv");
    const lines = (await Bun.file(join(CATALOGS, "google-existing.csv")).text()).split(/\r?\n/);
    await Bun.write(existing, `${lines.slice(0, 2).join("\n")}\n`);
    const approvalResult = run(fontArgs(directory, { approve: false, existing }));

    const badOverrides = join(directory, "overrides.json");
    await Bun.write(badOverrides, '{"families":{"Unknown Font":{"Keywords":"bad"}}}');
    const overrideResult = run(fontArgs(directory, { overrides: badOverrides }));

    expect(rankResult.stderr).toContain("invalid popularity");
    expect(axisResult.stderr).toContain("duplicate axis tags");
    expect(approvalResult.stderr).toContain("family-set changes require --approve-changes");
    expect(approvalResult.stdout).toContain("Zeta Serif");
    expect(await Bun.file(join(directory, "google-fonts.csv")).exists()).toBe(false);
    expect(overrideResult.stderr).toContain("overrides target unknown families");
  });

  test("explicit license exclusion is reported and not promoted", async () => {
    const directory = await scratchDir("fonts-exclusion");
    const metadata = await fixture("google-metadata.json");
    metadata.families = metadata.families.slice(0, 1);
    metadata.excludedFamilies = [{ name: "Alpha Sans", reason: "No matching official METADATA.pb", source: "https://github.com/google/fonts" }];
    const metadataPath = join(directory, "metadata.json");
    await Bun.write(metadataPath, JSON.stringify(metadata));
    const result = run(fontArgs(directory, { metadata: metadataPath }));
    expect([result.exitCode, result.stderr]).toEqual([0, ""]);
    const report = JSON.parse(result.stdout);
    expect((await rowsOf(join(directory, "google-fonts.csv"))).map((row) => row.Family)).toEqual(["Zeta Serif"]);
    expect(report.excludedFamilies[0].status).toBe("needs-review");
    expect((await Bun.file(join(directory, "google-font-licenses.json")).json()).excludedFamilies[0].status).toBe("needs-review");
  });

  test("exclusion sources match the offline validator policy", async () => {
    const metadata = await fixture("google-metadata.json");
    const allowed = ["https://fonts.google.com/specimen/Alpha+Sans", "https://github.com/google/fonts", "https://github.com/google/fonts/tree/main/ofl/alphasans"];
    const rejected = ["https://example.com/google/fonts", "https://github.com/other/fonts", "https://fonts.google.com:444/specimen/Alpha+Sans"];
    for (const source of [...allowed, ...rejected]) {
      const directory = await scratchDir("fonts-source");
      const candidate = clone(metadata);
      candidate.families = candidate.families.slice(1);
      candidate.excludedFamilies = [{ name: "Zeta Serif", reason: "No matching official METADATA.pb", source }];
      const metadataPath = join(directory, "metadata.json");
      await Bun.write(metadataPath, JSON.stringify(candidate));
      const result = run(fontArgs(directory, { metadata: metadataPath }));
      expect([source, result.exitCode === 0]).toEqual([source, allowed.includes(source)]);
    }
  });
});

describe("Phosphor icon refresh", () => {
  test("manifest normalizes and records all import forms", async () => {
    const first = await scratchDir("icons-a");
    const second = await scratchDir("icons-b");
    expect(run(iconArgs(first)).exitCode).toBe(0);
    expect(run(iconArgs(second)).exitCode).toBe(0);
    const output = join(first, "phosphor-icons-upstream.json");
    expect(await Bun.file(output).text()).toBe(await Bun.file(join(second, "phosphor-icons-upstream.json")).text());
    const manifest = await Bun.file(output).json();
    expect(manifest.source.version).toBe("2.1.1");
    expect([manifest.status, manifest.verifiedAt]).toEqual(["active", "2026-08-13"]);
    expect(manifest.weights).toEqual(["thin", "light", "regular", "bold", "fill", "duotone"]);
    expect(manifest.icons.map((icon: any) => icon.name)).toEqual(["acorn", "arrow-left"]);
    const arrow = manifest.icons[1];
    expect(arrow.categories).toEqual(["arrows", "navigation"]);
    expect(arrow.clientImport).toContain('from "@phosphor-icons/react"');
    expect(arrow.ssrImport).toContain('from "@phosphor-icons/react/ssr"');
    expect(manifest.curatedValidatedCount).toBe(2);
  });

  test("refresh rejects invalid schema, size and curated import", async () => {
    const directory = await scratchDir("icons-reject");
    const icons = await fixture("phosphor-core.json");
    const invalid = clone(icons);
    delete invalid[0].pascal_name;
    const source = join(directory, "invalid.json");
    await Bun.write(source, JSON.stringify(invalid));
    const schemaResult = run(iconArgs(directory, { source }));
    const sizeArgs = iconArgs(directory);
    sizeArgs[sizeArgs.length - 1] = "3";
    const sizeResult = run(sizeArgs);
    const curatedPath = join(directory, "icons.csv");
    await Bun.write(curatedPath, (await Bun.file(join(CATALOGS, "icons-curated.csv")).text()).replace("{ Acorn }", "{ Horse }"));
    const importResult = run(iconArgs(directory, { curated: curatedPath }));
    const packagePath = join(directory, "package.json");
    await Bun.write(packagePath, '{"name":"@phosphor-icons/core","version":"2.2.0"}');
    const versionResult = run(iconArgs(directory, { pkg: packagePath }));
    const aliasCollision = clone(icons);
    aliasCollision[1].alias = { name: "acorn", pascal_name: "BackArrow" };
    const aliasPath = join(directory, "alias.json");
    await Bun.write(aliasPath, JSON.stringify(aliasCollision));
    const aliasResult = run(iconArgs(directory, { source: aliasPath }));
    const exports = await fixture("phosphor-react-exports.json");
    exports.ssr = exports.ssr.filter((name: string) => name !== "Acorn");
    const exportsPath = join(directory, "exports.json");
    await Bun.write(exportsPath, JSON.stringify(exports));
    const exportsResult = run(iconArgs(directory, { reactExports: exportsPath }));
    expect(schemaResult.stderr).toContain("invalid official IconEntry schema");
    expect(sizeResult.stderr).toContain("expected 3 icons");
    expect(importResult.stderr).toContain("import component does not match");
    expect(versionResult.stderr).toContain("version must be 2.1.1");
    expect(aliasResult.stderr).toContain("alias collides");
    expect(exportsResult.stderr).toContain("React exports missing");
  });
});

describe("catalog summary line endings (#462)", () => {
  test("digest is identical for LF and CRLF", async () => {
    const directory = await scratchDir("digest");
    await Bun.write(join(directory, "lf.csv"), "id,name\n1,alpha\n2,beta\n");
    await Bun.write(join(directory, "crlf.csv"), "id,name\r\n1,alpha\r\n2,beta\r\n");
    expect(await digest(join(directory, "lf.csv"))).toBe(await digest(join(directory, "crlf.csv")));
  });

  test("committed snapshot matches normalized sources, also from a CRLF checkout", async () => {
    const summary = await readJson("catalog-summary.json");
    const directory = await scratchDir("crlf-checkout");
    for (const name of SNAPSHOT_FILES) {
      const lf = (await Bun.file(join(DATA_DIR, name)).text()).replaceAll("\r\n", "\n");
      const expected = new Bun.CryptoHasher("sha256").update(lf).digest("hex");
      expect([name, summary.snapshots[name].sha256]).toEqual([name, expected]);
      await Bun.write(join(directory, name), lf.replaceAll("\n", "\r\n"));
      expect([name, await digest(join(directory, name))]).toEqual([name, summary.snapshots[name].sha256]);
    }
  });
});
