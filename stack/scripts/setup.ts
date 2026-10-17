#!/usr/bin/env bun
/**
 * setup.ts — install the website design stack with Bun.
 * Safe to re-run. Installs the audit deps + Chromium and the ui-ux-pro-max skill,
 * then prints the two in-Claude steps (plugins are installed from inside Claude Code).
 */
import { $ } from "bun";

const cyan = (text: string) => console.log(`\x1b[36m${text}\x1b[0m`);
const green = (text: string) => console.log(`\x1b[32m${text}\x1b[0m`);
const INSTALL_SPEC = "github:aphrody-labs/ui-ux-pro-max-skill";

cyan("==> Installing audit dependencies (Playwright)…");
await $`bun install`;

cyan("==> Installing the Chromium browser for Playwright…");
// Skipped automatically in images that preinstall browsers; harmless to run.
if ((await $`bunx playwright install chromium`.nothrow()).exitCode !== 0) {
  console.log("  (Chromium already present or managed by the environment — continuing.)");
}

cyan("==> Installing the ui-ux-pro-max skill (knowledge layer)…");
const installed =
  (await $`bun install -g ${INSTALL_SPEC}`.nothrow()).exitCode === 0 && (await $`uipro init --ai claude`.nothrow()).exitCode === 0;
if (!installed) {
  console.log("  Could not auto-install the uipro CLI. Install it later with:");
  console.log(`    bun install -g ${INSTALL_SPEC} && uipro init --ai claude`);
}

green("==> CLI setup done.");
console.log();
cyan("Two steps to finish inside Claude Code (plugins install from the app):");
console.log("  1. Enable plugins, then run:");
console.log("       /plugin install frontend-design@anthropics/claude-code");
console.log("  2. Start Claude Code in this folder — .mcp.json (Playwright + Chrome DevTools + shadcn)");
console.log("     and CLAUDE.md load automatically. Approve the MCP servers when prompted.");
console.log();
console.log("Optional add-ons: see docs/SETUP.md (Figma Dev Mode MCP, 21st.dev Magic MCP).");
