#!/usr/bin/env bun
/** Set one version across package, skill, plugin and marketplace manifests. Usage: bun scripts/sync-release-version.ts <version> */
import { join } from "node:path";
import { REPO_ROOT } from "./lib/paths.ts";

const version = Bun.argv[2];
if (!version || !/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun scripts/sync-release-version.ts <semver>");
  process.exit(1);
}

/** Rewrite only the "version" values selected by `patterns`, preserving formatting. */
async function replaceVersions(path: string, patterns: RegExp[]): Promise<void> {
  const file = Bun.file(join(REPO_ROOT, path));
  if (!(await file.exists())) return;
  let text = await file.text();
  for (const pattern of patterns) text = text.replace(pattern, `$1"${version}"`);
  JSON.parse(text);
  await Bun.write(file, text);
}

const TOP_LEVEL = /^(\s{2}"version"\s*:\s*)"[^"]+"/m;
await replaceVersions("package.json", [TOP_LEVEL]);
await replaceVersions("skill.json", [TOP_LEVEL]);
await replaceVersions(".claude-plugin/plugin.json", [TOP_LEVEL]);
await replaceVersions(".codex-plugin/plugin.json", [TOP_LEVEL]);
await replaceVersions(".claude-plugin/marketplace.json", [/("metadata"\s*:\s*\{[\s\S]*?"version"\s*:\s*)"[^"]+"/, /("plugins"\s*:\s*\[[\s\S]*?"version"\s*:\s*)"[^"]+"/]);
console.log(`Synced version ${version} across package, skill, plugin and marketplace manifests.`);
