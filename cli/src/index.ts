#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { initCommand } from "./commands/init.ts";
import { uninstallCommand } from "./commands/uninstall.ts";
import { updateCommand } from "./commands/update.ts";
import { versionsCommand } from "./commands/versions.ts";
import type { AIType } from "./types/index.ts";
import { AI_TYPES } from "./types/index.ts";
import { INSTALL_SPEC, packageVersion } from "./utils/paths.ts";

const COMMANDS = {
  init: {
    description: "Install UI/UX Pro Max skill to current project",
    options: {
      ai: { type: "string", short: "a" },
      force: { type: "boolean", short: "f" },
      global: { type: "boolean", short: "g" },
      "dry-run": { type: "boolean" },
      offline: { type: "boolean", short: "o" },
    },
  },
  versions: {
    description: "List available versions",
    options: { token: { type: "string", short: "t" } },
  },
  update: {
    description: "Update the CLI from GitHub and refresh the installed skill files",
    options: {
      ai: { type: "string", short: "a" },
      global: { type: "boolean", short: "g" },
      token: { type: "string", short: "t" },
    },
  },
  uninstall: {
    description: "Remove UI/UX Pro Max skill from current project or globally",
    options: {
      ai: { type: "string", short: "a" },
      global: { type: "boolean", short: "g" },
      yes: { type: "boolean", short: "y" },
    },
  },
} as const;

type CommandName = keyof typeof COMMANDS;

function usage(version: string): string {
  const lines = [
    `uipro ${version} — install UI/UX Pro Max skill for AI coding assistants (runs on Bun)`,
    "",
    "Usage: uipro <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(10)} ${command.description}`),
    "",
    "Options:",
    `  -a, --ai <type>   AI assistant type (${AI_TYPES.join(", ")})`,
    "  -f, --force       Overwrite existing files (init)",
    "  -g, --global      Use the home directory (~/) instead of the current project",
    "      --dry-run     Preview install actions without writing files (init)",
    "  -t, --token <t>   GitHub token for higher API rate limits (versions, update)",
    "  -y, --yes         Do not ask for confirmation (uninstall)",
    "  -V, --version     Print the version",
    "  -h, --help        Print this help",
    "",
    `Install or upgrade: bun install -g ${INSTALL_SPEC}`,
  ];
  return lines.join("\n");
}

function parseAiType(value: string | undefined): AIType | undefined {
  if (value === undefined) return undefined;
  if (!AI_TYPES.includes(value as AIType)) {
    console.error(`Invalid AI type: ${value}`);
    console.error(`Valid types: ${AI_TYPES.join(", ")}`);
    process.exit(1);
  }
  return value as AIType;
}

const version = await packageVersion();
const [commandName, ...rest] = Bun.argv.slice(2);

if (!commandName || commandName === "-h" || commandName === "--help" || commandName === "help") {
  console.log(usage(version));
  process.exit(0);
}
if (commandName === "-V" || commandName === "--version") {
  console.log(version);
  process.exit(0);
}
if (!(commandName in COMMANDS)) {
  console.error(`Unknown command: ${commandName}\n`);
  console.error(usage(version));
  process.exit(1);
}

const command = commandName as CommandName;
let values: Record<string, string | boolean | undefined>;
try {
  values = parseArgs({
    args: rest,
    options: { ...COMMANDS[command].options, help: { type: "boolean", short: "h" } },
    allowPositionals: false,
    strict: true,
  }).values as Record<string, string | boolean | undefined>;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (values.help) {
  console.log(usage(version));
  process.exit(0);
}

const ai = parseAiType(values.ai as string | undefined);
switch (command) {
  case "init":
    await initCommand({ ai, force: !!values.force, global: !!values.global, dryRun: !!values["dry-run"] });
    break;
  case "versions":
    await versionsCommand({ token: values.token as string | undefined });
    break;
  case "update":
    await updateCommand({ ai, global: !!values.global, token: values.token as string | undefined });
    break;
  case "uninstall":
    await uninstallCommand({ ai, global: !!values.global, yes: !!values.yes });
    break;
}
