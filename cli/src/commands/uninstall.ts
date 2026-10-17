import { rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AIType, ConcreteAIType } from "../types/index.ts";
import { AI_FOLDERS } from "../types/index.ts";
import { detectAIType, getAITypeDescription } from "../utils/detect.ts";
import { listBundledSubSkills, loadPlatformConfig, platformRoot, removeLegacyInstall } from "../utils/template.ts";
import { color, confirmPrompt, logger, select, Spinner } from "../utils/ui.ts";

export interface UninstallOptions {
  ai?: AIType;
  global?: boolean;
  yes?: boolean;
}

/**
 * Remove skill directory for a given AI type
 */
export async function removeSkillDir(
  baseDir: string,
  aiType: ConcreteAIType,
  isGlobal = false
): Promise<string[]> {
  const removed: string[] = [];

  // The orchestrator plus the bundled sibling sub-skills installed by init.
  const skillNames = ['ui-ux-pro-max', ...(await listBundledSubSkills())];

  // Parent directories to clean. Derive the real install location from the
  // platform config's skillPath and root (same source the installer uses), so
  // non-`skills/` platforms (kiro's `.kiro/steering/`) and global roots
  // (copilot's `~/.copilot/`) are handled. Also clean the legacy
  // `<folder>/skills/` layout (incl. `.shared/`) so older installs are removed.
  const parents = new Set<string>();
  // Standalone skill files to remove (platforms with a dataPath keep the
  // rendered skill file apart from the data directory — e.g. amazonq's
  // `.amazonq/rules/ui-ux-pro-max.md`).
  const skillFiles = new Set<string>();
  try {
    const config = await loadPlatformConfig(aiType);
    const { folderStructure } = config;
    const root = platformRoot(config, isGlobal);
    if (folderStructure.dataPath) {
      skillFiles.add(join(root, folderStructure.skillPath, folderStructure.filename));
      parents.add(join(root, dirname(folderStructure.dataPath)));
    } else {
      parents.add(join(root, dirname(folderStructure.skillPath)));
    }
  } catch {
    // No platform config — fall back to the legacy folders below.
  }
  for (const folder of AI_FOLDERS[aiType]) {
    parents.add(join(folder, 'skills'));
  }

  for (const skillFile of skillFiles) {
    const filePath = join(baseDir, skillFile);
    try {
      await stat(filePath);
      await rm(filePath, { force: true });
      removed.push(skillFile.replaceAll('\\', '/'));
    } catch (err: unknown) {
      // Skip non-existent files; re-throw permission or other errors
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
  }

  for (const parent of parents) {
    for (const name of skillNames) {
      const skillDir = join(baseDir, parent, name);
      try {
        await stat(skillDir);
        await rm(skillDir, { recursive: true, force: true });
        removed.push(`${parent.replaceAll('\\', '/')}/${name}`);
      } catch (err: unknown) {
        // Skip non-existent dirs; re-throw permission or other errors
        if ((err as { code?: string }).code !== 'ENOENT') throw err;
      }
    }
  }

  // An install from an earlier layout (copilot's `.github/prompts/`).
  removed.push(...(await removeLegacyInstall(baseDir, aiType)));

  return removed;
}

export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  logger.title('UI/UX Pro Max Uninstaller');

  const isGlobal = !!options.global;
  const baseDir = isGlobal ? homedir() : process.cwd();
  const locationLabel = isGlobal ? '~/ (global)' : process.cwd();

  let aiType = options.ai;
  const { detected: initialDetected } = detectAIType(baseDir);

  // Auto-detect or prompt for AI type
  if (!aiType) {
    const detected = initialDetected;

    if (detected.length === 0) {
      logger.warn('No installed AI skill directories detected.');
      return;
    }

    logger.info(`Detected installations: ${detected.map(t => color.cyan(t)).join(', ')}`);

    const choices = [
      ...detected.map(type => ({
        title: getAITypeDescription(type),
        value: type,
      })),
      { title: 'All detected', value: 'all' as AIType },
    ];

    aiType = select("Select which AI skill to uninstall:", choices);
    if (!aiType) {
      logger.warn("Uninstall cancelled");
      return;
    }
  }

  // Confirm before removing
  const confirmed = options.yes || confirmPrompt(`Remove UI/UX Pro Max skill for ${color.cyan(getAITypeDescription(aiType))} from ${locationLabel}?`);

  if (!confirmed) {
    logger.warn('Uninstall cancelled');
    return;
  }

  const spinner = new Spinner("Removing skill files...").start();

  try {
    const allRemoved: string[] = [];

    if (aiType === 'all') {
      // Remove for all detected platforms
      for (const type of initialDetected) {
        const removed = await removeSkillDir(baseDir, type, isGlobal);
        allRemoved.push(...removed);
      }
    } else {
      const removed = await removeSkillDir(baseDir, aiType, isGlobal);
      allRemoved.push(...removed);
    }

    if (allRemoved.length === 0) {
      spinner.warn('No skill files found to remove');
      return;
    }

    spinner.succeed('Skill files removed!');

    console.log();
    logger.info('Removed:');
    allRemoved.forEach(folder => {
      console.log(`  ${color.red('-')} ${folder}`);
    });

    console.log();
    logger.success('UI/UX Pro Max uninstalled successfully!');
    console.log();
  } catch (error) {
    spinner.fail('Uninstall failed');
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}
