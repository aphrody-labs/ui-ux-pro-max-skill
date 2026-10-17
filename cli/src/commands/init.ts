import type { AIType } from "../types/index.ts";
import { AI_TYPES } from "../types/index.ts";
import { detectAIType, getAITypeDescription } from "../utils/detect.ts";
import {
  generateAllPlatformFiles,
  generatePlatformFiles,
  planAllPlatformInstallActions,
  planPlatformInstallActions,
} from "../utils/template.ts";
import { color, logger, select, Spinner } from "../utils/ui.ts";

export interface InitOptions {
  ai?: AIType;
  force?: boolean;
  global?: boolean; // Install to home directory (global mode)
  dryRun?: boolean; // Preview install actions without writing files
}

export async function initCommand(options: InitOptions): Promise<void> {
  logger.title("UI/UX Pro Max Installer");

  let aiType = options.ai;

  if (!aiType) {
    const { detected, suggested } = detectAIType();
    if (detected.length > 0) {
      logger.info(`Detected: ${detected.map((t) => color.cyan(t)).join(", ")}`);
    }
    aiType = select(
      "Select AI assistant to install for:",
      AI_TYPES.map((type) => ({ title: getAITypeDescription(type), value: type })),
      suggested ? AI_TYPES.indexOf(suggested) : 0,
    );
    if (!aiType) {
      logger.warn("Installation cancelled");
      return;
    }
  }

  const isGlobal = !!options.global;
  logger.info(`Installing for: ${color.cyan(getAITypeDescription(aiType))}${isGlobal ? " (global)" : ""}`);
  const cwd = process.cwd();

  if (options.dryRun) {
    console.log();
    logger.info("Planned install actions (nothing will be written):");
    if (aiType === "all") {
      const planned = await planAllPlatformInstallActions(cwd, isGlobal, options.force);
      for (const [type, actions] of planned) {
        console.log();
        console.log(color.bold(getAITypeDescription(type as AIType)));
        for (const action of actions) console.log(`  ${color.cyan("·")} ${action}`);
      }
    } else {
      for (const action of await planPlatformInstallActions(cwd, aiType, isGlobal, options.force)) {
        console.log(`  ${color.cyan("·")} ${action}`);
      }
    }
    console.log();
    logger.success("Dry run complete — no files were written.");
    return;
  }

  const spinner = new Spinner(isGlobal ? "Generating skill files globally..." : "Generating skill files from templates...").start();
  try {
    const folders =
      aiType === "all"
        ? await generateAllPlatformFiles(cwd, isGlobal, options.force)
        : await generatePlatformFiles(cwd, aiType, isGlobal, options.force);
    spinner.succeed("Generated from templates!");

    console.log();
    logger.info("Installed folders:");
    for (const folder of folders) console.log(`  ${color.green("+")} ${folder}`);
    console.log();
    logger.success("UI/UX Pro Max installed successfully!");
    console.log();
    console.log(color.bold("Next steps:"));
    console.log(color.dim("  1. Restart your AI coding assistant"));
    console.log(color.dim('  2. Try: "Build a landing page for a SaaS product"'));
    console.log();
  } catch (error) {
    spinner.fail("Installation failed");
    if (error instanceof Error) logger.error(error.message);
    process.exit(1);
  }
}
