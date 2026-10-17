import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PlatformConfig } from "../types/index.ts";
import { CORE_SKILL, CORE_SKILL_DIR, SKILLS_DIR, TEMPLATES_DIR } from "./paths.ts";

export type { PlatformConfig };

/**
 * Layouts an earlier CLI version installed and the current layout replaces.
 * Paths are relative to the install base (project or home directory).
 */
const LEGACY_LAYOUTS: Record<string, { skillFiles: string[]; skillsParents: string[] }> = {
  // Copilot used a prompt file in .github/prompts/ before it loaded Agent Skills.
  copilot: {
    skillFiles: [".github/prompts/ui-ux-pro-max.prompt.md"],
    skillsParents: [".github/prompts"],
  },
};

// Map AIType to platform config file name
const AI_TO_PLATFORM: Record<string, string> = {
  claude: "claude",
  cursor: "cursor",
  windsurf: "windsurf",
  antigravity: "agent",
  copilot: "copilot",
  kiro: "kiro",
  opencode: "opencode",
  roocode: "roocode",
  codex: "codex",
  qoder: "qoder",
  gemini: "gemini",
  trae: "trae",
  continue: "continue",
  codebuddy: "codebuddy",
  droid: "droid",
  kilocode: "kilocode",
  warp: "warp",
  augment: "augment",
  codewhale: "codewhale",
  zcode: "zcode",
  amazonq: "amazonq",
  openclaw: "openclaw",
  universal: "universal",
};

/** Files of the skill tree that never ship to an install target. */
const EXCLUDED = [/(^|\/)__pycache__\//, /(^|\/)tests\//, /(^|\/)\.tmp[^/]*\//, /\.test\.ts$/, /(^|\/)settings\.local\.json$/];

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Copy a directory tree with Bun.Glob + Bun.write (Bun.write creates parent directories). */
export async function copyTree(source: string, target: string): Promise<number> {
  let count = 0;
  for await (const relative of new Bun.Glob("**/*").scan({ cwd: source, dot: true, onlyFiles: true })) {
    const normalized = relative.replaceAll("\\", "/");
    if (EXCLUDED.some((pattern) => pattern.test(normalized))) continue;
    await Bun.write(join(target, relative), Bun.file(join(source, relative)));
    count++;
  }
  return count;
}

/** Load platform configuration from JSON file */
export async function loadPlatformConfig(aiType: string): Promise<PlatformConfig> {
  const platformName = AI_TO_PLATFORM[aiType];
  if (!platformName) throw new Error(`Unknown AI type: ${aiType}`);
  return (await Bun.file(join(TEMPLATES_DIR, "platforms", `${platformName}.json`)).json()) as PlatformConfig;
}

/** The folder a platform installs into, relative to the project (local) or home directory (global). */
export function platformRoot(config: PlatformConfig, isGlobal: boolean): string {
  return (isGlobal && config.folderStructure.globalRoot) || config.folderStructure.root;
}

/** Load all available platform configs */
export async function loadAllPlatformConfigs(): Promise<Map<string, PlatformConfig>> {
  const configs = new Map<string, PlatformConfig>();
  for (const aiType of Object.keys(AI_TO_PLATFORM)) {
    try {
      configs.set(aiType, await loadPlatformConfig(aiType));
    } catch {
      // Skip if config doesn't exist
    }
  }
  return configs;
}

function loadTemplate(templateName: string): Promise<string> {
  return Bun.file(join(TEMPLATES_DIR, templateName)).text();
}

function renderFrontmatter(frontmatter: Record<string, string> | null): string {
  if (!frontmatter) return "";
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value.includes(":") || value.includes('"') || value.includes("\n")) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Resolve {{#QR}}...{{/QR}} / {{#NOQR}}...{{/NOQR}} pairs so platforms that
 * omit the inlined Quick Reference do not tell the agent to read empty
 * "sections above".
 */
function applyQuickReferenceVariants(content: string, includeQuickReference: boolean): string {
  const drop = includeQuickReference ? /\{\{#NOQR\}\}[\s\S]*?\{\{\/NOQR\}\}/g : /\{\{#QR\}\}[\s\S]*?\{\{\/QR\}\}/g;
  const keep = includeQuickReference ? /\{\{#QR\}\}([\s\S]*?)\{\{\/QR\}\}/g : /\{\{#NOQR\}\}([\s\S]*?)\{\{\/NOQR\}\}/g;
  return content.replace(drop, "").replace(keep, "$1");
}

/**
 * Render skill file content from template.
 * When isGlobal=true, script paths are anchored at the home directory (~/{root}/...).
 */
export async function renderSkillFile(config: PlatformConfig, isGlobal = false): Promise<string> {
  let content = applyQuickReferenceVariants(await loadTemplate("base/skill-content.md"), config.sections.quickReference);
  const quickReferenceContent = config.sections.quickReference ? await loadTemplate("base/quick-reference.md") : "";

  // scriptPath is relative to the platform root. Generated commands run from
  // the user's project root, so local installs need the platform root prefix;
  // global installs need the same path anchored at the user's home directory.
  const rootedScriptPath = `${platformRoot(config, isGlobal)}/${config.scriptPath}`.replace(/\/{2,}/g, "/");
  const commandScriptPath = isGlobal ? `~/${rootedScriptPath}` : rootedScriptPath;
  const quickRefWithNewline = quickReferenceContent ? `\n${quickReferenceContent}` : "";

  content = content
    .replace(/\{\{TITLE\}\}/g, config.title)
    .replace(/\{\{DESCRIPTION\}\}/g, config.description)
    .replace(/\{\{SCRIPT_PATH\}\}/g, commandScriptPath)
    .replace(/\{\{SKILL_OR_WORKFLOW\}\}/g, config.skillOrWorkflow)
    .replace(/\{\{QUICK_REFERENCE\}\}/g, quickRefWithNewline);

  return renderFrontmatter(config.frontmatter) + content;
}

/**
 * Replace a pre-existing non-directory at `path` so a real directory can be
 * created there (older installs can leave plain "pointer" files at these paths).
 */
async function ensureCleanDir(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) await rm(path, { recursive: true, force: true });
  } catch {
    // Nothing exists at the path yet.
  }
}

/** Copy the core skill's data, scripts and references to the target directory (replacing stale copies). */
async function copyDataAndScripts(targetSkillDir: string): Promise<void> {
  for (const folder of ["data", "scripts", "references"]) {
    const source = join(CORE_SKILL_DIR, folder);
    if (!(await exists(source))) continue;
    const target = join(targetSkillDir, folder);
    await ensureCleanDir(target);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await copyTree(source, target);
  }
}

/** The sub-skills shipped next to the orchestrator in `.claude/skills/`. */
export async function listBundledSubSkills(): Promise<string[]> {
  if (!(await exists(SKILLS_DIR))) return [];
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== CORE_SKILL)
    .map((entry) => entry.name)
    .sort();
}

/**
 * Paths of an earlier layout of aiType that exist under baseDir: the old skill
 * file, the orchestrator folder and the bundled sub-skills left next to it.
 * A sub-skill folder only counts when it holds a SKILL.md, so a user's own
 * folder of the same name (e.g. `.github/prompts/design`) is left alone.
 */
export async function findLegacyInstallPaths(baseDir: string, aiType: string): Promise<string[]> {
  const layout = LEGACY_LAYOUTS[aiType];
  if (!layout) return [];
  const found: string[] = [];
  for (const skillFile of layout.skillFiles) {
    if (await exists(join(baseDir, skillFile))) found.push(skillFile);
  }
  for (const parent of layout.skillsParents) {
    const orchestratorDir = `${parent}/${CORE_SKILL}`;
    if (await exists(join(baseDir, orchestratorDir))) found.push(orchestratorDir);
    for (const name of await listBundledSubSkills()) {
      const subSkillDir = `${parent}/${name}`;
      if (await exists(join(baseDir, subSkillDir, "SKILL.md"))) found.push(subSkillDir);
    }
  }
  return found;
}

/** Remove an earlier layout of aiType from baseDir. Returns the removed paths. */
export async function removeLegacyInstall(baseDir: string, aiType: string): Promise<string[]> {
  const found = await findLegacyInstallPaths(baseDir, aiType);
  for (const path of found) await rm(join(baseDir, path), { recursive: true, force: true });
  return found;
}

/** Install the sub-skills as siblings of the orchestrator skill. */
async function copySubSkills(skillsParentDir: string, force: boolean): Promise<void> {
  for (const name of await listBundledSubSkills()) {
    const target = join(skillsParentDir, name);
    if ((await exists(target)) && !force) continue;
    await rm(target, { recursive: true, force: true });
    await copyTree(join(SKILLS_DIR, name), target);
  }
}

/**
 * Resolve every path an install touches for one platform. Shared by the real
 * install and the read-only preview so the two can never disagree.
 */
function resolveInstallPaths(config: PlatformConfig, targetDir: string, isGlobal: boolean) {
  const baseDir = isGlobal ? homedir() : targetDir;
  const root = platformRoot(config, isGlobal);
  const skillDir = join(baseDir, root, config.folderStructure.skillPath);
  const skillFilePath = join(skillDir, config.folderStructure.filename);
  const dataDir = config.folderStructure.dataPath ? join(baseDir, root, config.folderStructure.dataPath) : skillDir;
  // The skills parent is the orchestrator's parent dir (skills/ for most
  // platforms, steering/ for kiro); amazonq anchors it at its data dir.
  const skillsParentDir = join(
    baseDir,
    root,
    config.folderStructure.dataPath ? dirname(config.folderStructure.dataPath) : dirname(config.folderStructure.skillPath),
  );
  return { baseDir, skillDir, skillFilePath, dataDir, skillsParentDir };
}

/** Generate platform files for one AI type: skill file + data + scripts + sub-skills. */
export async function generatePlatformFiles(targetDir: string, aiType: string, isGlobal = false, force = false): Promise<string[]> {
  const config = await loadPlatformConfig(aiType);
  const { baseDir, skillDir, skillFilePath, dataDir, skillsParentDir } = resolveInstallPaths(config, targetDir, isGlobal);

  if ((await Bun.file(skillFilePath).exists()) && !force) {
    console.log(`  Skipped (already exists): ${skillFilePath} — use --force to overwrite`);
    return [];
  }

  await mkdir(skillDir, { recursive: true });
  await Bun.write(skillFilePath, await renderSkillFile(config, isGlobal));
  await mkdir(dataDir, { recursive: true });
  await copyDataAndScripts(dataDir);
  await copySubSkills(skillsParentDir, force);

  for (const path of await removeLegacyInstall(baseDir, aiType)) {
    console.log(`  Removed legacy install: ${join(baseDir, path)}`);
  }
  return [platformRoot(config, isGlobal)];
}

/** Preview the actions generatePlatformFiles would take, without writing anything. */
export async function planPlatformInstallActions(targetDir: string, aiType: string, isGlobal = false, force = false): Promise<string[]> {
  const config = await loadPlatformConfig(aiType);
  const { baseDir, skillFilePath, dataDir, skillsParentDir } = resolveInstallPaths(config, targetDir, isGlobal);
  const actions: string[] = [];
  const skillFileExists = await Bun.file(skillFilePath).exists();
  actions.push(skillFileExists && !force ? `Would skip (exists, use --force): ${skillFilePath}` : `Would write: ${skillFilePath}`);
  actions.push(`Would copy data + scripts: ${dataDir}`);
  const subSkills = await listBundledSubSkills();
  if (subSkills.length > 0) {
    actions.push(`Would copy ${subSkills.length} sub-skills (${subSkills.join(", ")}): ${skillsParentDir}`);
  }
  if (!skillFileExists || force) {
    for (const path of await findLegacyInstallPaths(baseDir, aiType)) actions.push(`Would remove legacy install: ${join(baseDir, path)}`);
  }
  return actions;
}

function skillFileKey(config: PlatformConfig): string {
  return join(config.folderStructure.root, config.folderStructure.skillPath, config.folderStructure.filename);
}

/** Preview generateAllPlatformFiles, grouped per unique platform layout. */
export async function planAllPlatformInstallActions(targetDir: string, isGlobal = false, force = false): Promise<Map<string, string[]>> {
  const planned = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const [aiType, config] of await loadAllPlatformConfigs()) {
    const key = skillFileKey(config);
    if (seen.has(key)) continue;
    seen.add(key);
    planned.set(aiType, await planPlatformInstallActions(targetDir, aiType, isGlobal, force));
  }
  return planned;
}

/** Generate files for all AI types */
export async function generateAllPlatformFiles(targetDir: string, isGlobal = false, force = false): Promise<string[]> {
  const allFolders = new Set<string>();
  const seen = new Set<string>();
  for (const [aiType, config] of await loadAllPlatformConfigs()) {
    const key = skillFileKey(config);
    if (seen.has(key)) continue;
    try {
      const folders = await generatePlatformFiles(targetDir, aiType, isGlobal, force);
      seen.add(key);
      for (const folder of folders) allFolders.add(folder);
    } catch {
      // Skip if generation fails for a platform
    }
  }
  return [...allFolders];
}

/** Supported AI types */
export function getSupportedAITypes(): string[] {
  return Object.keys(AI_TO_PLATFORM);
}
