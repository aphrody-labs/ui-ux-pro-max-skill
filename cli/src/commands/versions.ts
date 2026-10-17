import { fetchReleases } from "../utils/github.ts";
import { INSTALL_SPEC, packageVersion } from "../utils/paths.ts";
import { color, logger, Spinner } from "../utils/ui.ts";

export interface VersionsOptions {
  token?: string;
}

export async function versionsCommand(options: VersionsOptions = {}): Promise<void> {
  console.log(`Installed: ${color.cyan(await packageVersion())}`);
  const spinner = new Spinner("Fetching available versions...").start();
  try {
    const releases = await fetchReleases(options.token);
    if (releases.length === 0) {
      spinner.warn("No releases or tags published yet; installs track the default branch.");
      return;
    }
    spinner.succeed(`Found ${releases.length} version(s)\n`);
    console.log(color.bold("Available versions:\n"));
    releases.forEach((release, index) => {
      const date = release.published_at ? color.dim(`(${new Date(release.published_at).toLocaleDateString()})`) : "";
      if (index === 0) console.log(`  ${color.green("*")} ${color.bold(release.tag_name)} ${date} ${color.green("[latest]")}`);
      else console.log(`    ${release.tag_name} ${date}`);
    });
    console.log();
    logger.dim(`Update with \`bun install -g ${INSTALL_SPEC}\` (or \`uipro update\`), then run: uipro init --ai <platform> --force`);
  } catch (error) {
    spinner.fail("Failed to fetch versions");
    if (error instanceof Error) logger.error(error.message);
    process.exit(1);
  }
}
