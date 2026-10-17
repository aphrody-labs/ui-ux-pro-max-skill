# uipro — UI/UX Pro Max installer (Bun)

The `uipro` CLI installs the UI/UX Pro Max skills for AI coding assistants. It runs on Bun with
no dependencies and installs from the repository tree it runs from (`.claude/skills/` and
`cli/templates/`), so there is no build step and no bundled copy of the skill.

## Installation

```bash
bun install -g github:aphrody-labs/ui-ux-pro-max-skill
```

## Usage

```bash
uipro init --ai claude      # Claude Code
uipro init --ai cursor      # Cursor
uipro init --ai windsurf    # Windsurf
uipro init --ai antigravity # Antigravity
uipro init --ai copilot     # GitHub Copilot
uipro init --ai kiro        # Kiro
uipro init --ai codex       # Codex (Skills)
uipro init --ai roocode     # Roo Code
uipro init --ai qoder       # Qoder
uipro init --ai gemini      # Gemini CLI
uipro init --ai trae        # Trae
uipro init --ai opencode    # OpenCode
uipro init --ai amazonq     # Amazon Q Developer
uipro init --ai openclaw    # OpenClaw (.agents/skills/)
uipro init --ai universal   # Universal / Agent Standard (.agents/skills/)
uipro init --ai all         # All assistants

uipro init --force          # Overwrite existing files
uipro init --global         # Install to the home directory (~/)
uipro init --dry-run        # Preview install actions without writing files

uipro versions              # List published versions (fork releases or tags)
uipro update --ai claude    # bun install -g the latest CLI, then regenerate the skill files
uipro uninstall             # Remove the skill (auto-detect platform)
uipro uninstall --yes       # ... without the confirmation prompt
```

The generated skill files call the search engine with `bun <platform-root>/skills/ui-ux-pro-max/scripts/search.ts`.

## GitHub rate limits

`versions` and `update` read the fork's releases from the GitHub API (60 requests/hour
unauthenticated). Pass `--token <pat>` or set `UI_PRO_MAX_GITHUB_TOKEN` (`GITHUB_TOKEN` is the
fallback); a token without scopes is enough for public repositories.

## Development

```bash
bun cli/src/index.ts --help
bun test tests/cli.test.ts
```
