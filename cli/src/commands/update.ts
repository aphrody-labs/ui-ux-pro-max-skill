import type { AIType } from "../types/index.ts";
import { getLatestVersion } from "../utils/github.ts";
import { INSTALL_SPEC, packageVersion } from "../utils/paths.ts";
import { color, logger, Spinner } from "../utils/ui.ts";
import { initCommand } from "./init.ts";

export interface UpdateOptions {
  ai?: AIType;
  global?: boolean;
  token?: string;
}

/**
 * Reinstall the CLI from the fork with `bun install -g`, then regenerate the
 * skill files with the freshly installed `uipro` (the running process still
 * holds the previous tree in memory).
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  logger.title("UI/UX Pro Max Updater");

  const spinner = new Spinner("Checking for updates...").start();
  const currentVersion = await packageVersion();
  let latestVersion: string | null = null;
  try {
    latestVersion = await getLatestVersion(options.token);
  } catch (error) {
    spinner.warn(`Could not read releases (${error instanceof Error ? error.message : String(error)}); refreshing from the default branch.`);
  }
  if (latestVersion) spinner.succeed(`Latest version: ${color.cyan(latestVersion)} (installed ${color.cyan(currentVersion)})`);

  const aiArgs = options.ai ? ["--ai", options.ai] : [];
  const globalArgs = options.global ? ["--global"] : [];

  if (latestVersion && latestVersion === currentVersion) {
    console.log();
    logger.info("CLI is current; refreshing installed skill files...");
    console.log();
    await initCommand({ ai: options.ai, force: true, global: options.global });
    return;
  }

  logger.info(`Updating the CLI: ${color.cyan(`bun install -g ${INSTALL_SPEC}`)}`);
  const install = Bun.spawnSync([process.execPath, "install", "-g", INSTALL_SPEC], { stdout: "inherit", stderr: "inherit" });
  if (install.exitCode !== 0) {
    logger.error("Automatic update failed.");
    logger.info(`Update manually: ${color.cyan(`bun install -g ${INSTALL_SPEC}`)}`);
    process.exit(1);
  }

  const uipro = Bun.which("uipro");
  const rerun = ["uipro", "init", ...aiArgs, "--force", ...globalArgs].join(" ");
  if (!uipro || !options.ai) {
    logger.success("CLI updated.");
    logger.info(`Now rerun ${color.cyan(options.ai ? rerun : "uipro init --ai <platform> --force")} to refresh your skill files.`);
    return;
  }
  const refresh = Bun.spawnSync([uipro, "init", ...aiArgs, "--force", ...globalArgs], { stdout: "inherit", stderr: "inherit" });
  process.exit(refresh.exitCode ?? 1);
}
