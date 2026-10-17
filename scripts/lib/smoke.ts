import { search, searchStack } from "../../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { SEARCH_SCRIPT } from "./paths.ts";

export interface SmokeOptions {
  kind: "domain" | "stack";
  names: readonly string[];
  expectedCount: number;
  expectedEnv: string;
  probes: Readonly<Record<string, string>>;
  override?: string;
}

/** Run one `--json` CLI probe per name; exit codes: 0 ok, 1 empty results, 2 registry drift. */
export async function runSmoke(options: SmokeOptions): Promise<number> {
  const { kind, names, expectedCount, expectedEnv, probes, override } = options;
  const label = kind === "domain" ? "domains" : "stacks";
  const width = kind === "domain" ? 14 : 18;
  if (names.length !== expectedCount) {
    console.error(`FAIL: registry has ${names.length} ${label}, expected ${expectedCount}`);
    console.error(`      Set ${expectedEnv} after an intentional registry change.`);
    return 2;
  }
  console.log(override ? `Smoke-testing ${names.length} ${label} with override query '${override}':` : `Smoke-testing ${names.length} ${label} with focused probes:`);
  let fail = 0;
  for (const name of names) {
    const query = override || probes[name];
    if (!query) {
      console.log(`  FAIL  ${name.padEnd(width)} missing smoke probe`);
      fail++;
      continue;
    }
    const flag = kind === "domain" ? "--domain" : "--stack";
    const proc = Bun.spawnSync([process.execPath, SEARCH_SCRIPT, query, flag, name, "-n", "1", "--json"], { stdout: "pipe", stderr: "pipe" });
    let count: number;
    try {
      const data = JSON.parse(proc.stdout.toString()) as { count?: number; error?: string };
      count = data.error ? 0 : (data.count ?? 0);
    } catch {
      count = 0;
    }
    if (count > 0) {
      console.log(`  PASS  ${name.padEnd(width)} ${count}`);
    } else {
      const result = kind === "domain" ? await search(query, name as never, 1, true) : await searchStack(query, name, 1, true);
      console.log(`  FAIL  ${name.padEnd(width)} 0 query=${JSON.stringify(query)} diagnostics=${JSON.stringify(result.diagnostics ?? {})}`);
      fail++;
    }
  }
  console.log();
  if (fail > 0) {
    console.error(`FAIL: ${fail}/${names.length} ${label} returned 0 results`);
    return 1;
  }
  console.log(`OK: ${names.length}/${names.length} ${label} returned ≥1 result`);
  return 0;
}
