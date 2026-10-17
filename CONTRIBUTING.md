# Contributing to UI/UX Pro Max

Thank you for taking the time to contribute! 🎉  
This guide will help you get started quickly.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Ways to Contribute](#ways-to-contribute)
- [Development Workflow](#development-workflow)
- [Commit Message Format](#commit-message-format)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Code of Conduct](#code-of-conduct)

---

## Getting Started

### Prerequisites

- **Bun** 1.4.4+ (the Aphrody runtime, aphrody-labs/bun, is the reference runtime)
- **Git**

No other runtime or package is needed: every script, the CLI and the tests use Bun built-ins.

### Fork & Clone

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/ui-ux-pro-max-skill.git
cd ui-ux-pro-max-skill

# 2. Add the fork and the original project as remotes
git remote add aphrody https://github.com/aphrody-labs/ui-ux-pro-max-skill.git
git remote add upstream https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git
```

---

## Project Structure

```
ui-ux-pro-max-skill/
├── .claude/skills/ui-ux-pro-max/   # Canonical core skill — edit here (SKILL.md, data/, scripts/*.ts, references/)
├── .claude/skills/<sub-skill>/     # brand, design, design-system, slides, ui-styling, banner-design
├── cli/src/                        # uipro CLI (Bun, no dependencies)
├── cli/templates/                  # Platform templates rendered by `uipro init`
├── scripts/                        # Catalog refresh, validation, relevance gate (Bun)
├── tests/                          # bun:test suites and fixtures
├── docs/                           # Documentation
└── preview/                        # Preview screenshots and demos
```

> **Important:** there are no mirrored copies. The CLI and the Claude Code / Codex plugins read the skill tree directly, so edit `.claude/skills/` and `cli/templates/` in place.

---

## Ways to Contribute

### 🐛 Bug Fixes
Check the [Issues tab](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/issues) for bugs labeled `bug`. Comment on the issue before starting so we don't duplicate work.

### ✨ New UI Styles
Add a new entry to `.claude/skills/ui-ux-pro-max/data/styles.csv`. Each row needs:
- Style name
- Description
- Best for (use cases)
- Key CSS properties/effects

### 🎨 New Color Palettes
Add entries to `.claude/skills/ui-ux-pro-max/data/colors.csv`. Match the existing format (primary, secondary, CTA, background, text, notes).

### 🏭 New Industry Reasoning Rules
Add rules to `.claude/skills/ui-ux-pro-max/data/ui-reasoning.csv`. Each rule needs a product type, recommended pattern, style priority, color mood, typography mood, key effects, and anti-patterns.

### 🌍 Translations
Translate `README.md` into your language and save it as `README.[lang].md` (e.g., `README.zh.md`, `README.es.md`).

### 📝 Documentation Improvements
Fix typos, clarify confusing sections, or add missing examples in `README.md` or `docs/`.

### 🔧 CLI Improvements
Improvements to the `cli/` installer. Run `bun cli/src/index.ts init --ai claude --dry-run` from a scratch project to try it.

### 🧩 Bun OS catalogs
The `m3`, `rg-ui` stacks and `brands.csv` describe the Bun OS monorepo. Brand tokens must be copied from the real CSS custom properties (convert colors with `Bun.color(value, "hex")`), never invented.

---

## Development Workflow

```bash
# 1. Create a feature branch from main
git checkout -b feat/your-feature-name

# 2. Make your changes in .claude/skills/ and cli/templates/

# 3. Run the full offline gate (CSV, data contracts, agent guide, catalog summary,
#    bun tests, relevance gate, smoke tests)
bun run verify

# 4. Try the search script and the CLI
bun .claude/skills/ui-ux-pro-max/scripts/search.ts "your query" --design-system
bun cli/src/index.ts init --ai claude --dry-run

# 5. Push your branch
git push -u origin feat/your-feature-name
```

---

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

Types:
  feat     → New feature or content (new style, rule, palette)
  fix      → Bug fix
  docs     → Documentation only
  refactor → Code change without new feature or fix
  chore    → Build process, dependency updates
  test     → Adding or fixing tests
```

**Examples:**
```
feat: add Skeuomorphism 2.0 style to general styles
fix: correct color palette for fintech industry rule
docs: translate README to Spanish
chore: update ui-ux-pro-max-cli to v2.6.0
```

---

## Pull Request Guidelines

1. **One PR per change** — keep PRs focused and small
2. **Reference related issues** — use `Closes #123` in the PR description
3. **Fill out the PR template** — describe what you changed and why
4. **Never push directly to `main`** — always use a feature branch
5. **Wait for review** — a maintainer will review within a few days

---

## Reporting Bugs

Please [open an issue](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/issues/new) and include:

- Your OS and terminal
- The AI assistant you're using (Claude Code, Cursor, etc.)
- The exact command or prompt that triggered the bug
- Expected vs. actual behavior
- Any error messages or screenshots

---

## Code of Conduct

Be kind, constructive, and respectful. We're all here to build something useful together.  
Harassment, spam, or low-effort contributions will be closed without review.

---

## Questions?

Open a [Discussion](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/discussions) or check the [README](README.md) first.

Happy contributing! 🚀
