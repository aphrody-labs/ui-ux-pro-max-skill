# CLAUDE.md

Guidance for coding agents working in this repository (the aphrody-labs Bun OS fork of
nextlevelbuilder/ui-ux-pro-max-skill, MIT).

## Project overview

UI UX Pro Max is a design-intelligence toolkit: searchable local catalogs of UI styles, palettes,
font pairings, charts, UX guidelines, icons, GSAP presets, stack guidelines and Aphrody brand
themes, plus a reasoning engine that generates design systems. It ships as Claude Code / Codex
plugins and as a `uipro` CLI that installs the skills for 23 assistants.

Everything runs with **Bun 1.4.4+** and Bun built-ins only — no Python, Node or npm packages.

## Layout (single source of truth, no mirrors)

```
.claude/skills/ui-ux-pro-max/    # Core skill: SKILL.md, data/*.csv, data/stacks/*.csv, references/, scripts/*.ts
  scripts/core.ts                # BM25 + identity routing search engine
  scripts/design-system.ts       # Design-system reasoning, formatters, persistence
  scripts/search.ts              # CLI entry point
  scripts/validate-data.ts       # Semantic data contracts
.claude/skills/<sub-skill>/      # brand, design, design-system, slides, ui-styling, banner-design
.claude-plugin/, .codex-plugin/, .agents/plugins/   # Plugin and marketplace manifests
cli/src/, cli/templates/         # uipro CLI and the platform templates it renders
scripts/                         # Catalog refresh, CSV/agent-guide validation, relevance gate, smoke tests
tests/                           # bun:test suites, tests/fixtures/
```

Edit the files above in place: the CLI and the plugins read them directly.

## Commands

```bash
bun .claude/skills/ui-ux-pro-max/scripts/search.ts "<query>" --domain <domain> [-n <max>]
bun .claude/skills/ui-ux-pro-max/scripts/search.ts "<query>" --stack <stack>
bun .claude/skills/ui-ux-pro-max/scripts/search.ts "<query>" --design-system [-p "Project"] [--brand <brand-id>]
bun run verify                   # Full offline gate (run before committing data or script changes)
bun test tests .claude/skills    # Test suites only
bun run catalog-summary -- --verified-at YYYY-MM-DD   # Regenerate data/catalog-summary.json after data changes
```

Domains: style, color, chart, landing, product, ux, typography, google-fonts, icons, gsap, react, web, brand.
Stacks: html-tailwind, react, nextjs, astro, vue, nuxtjs, nuxt-ui, svelte, swiftui, react-native,
flutter, shadcn, m3, rg-ui, jetpack-compose, threejs, angular, laravel, javafx, wpf, winui, avalonia, uno, uwp.

## Data rules

- Keep `No` columns contiguous and CSVs LF/UTF-8 (`.gitattributes` pins the hashed catalogs).
- `products.csv`, `colors.csv` and `ui-reasoning.csv` must stay aligned (192 product types).
- Brand rows (`brands.csv`) are extracted from real Bun OS CSS; colors as `#RRGGBB` via `Bun.color`.
- After changing counts, update the description in `.claude/skills/ui-ux-pro-max/SKILL.md` and
  `cli/templates/platforms/*.json` (`bun scripts/validate-agent-guide.ts` prints what is stale).
- Relevance thresholds in `tests/fixtures/relevance-thresholds.json` are bound to the runtime and
  data fingerprints; re-measure them deliberately when ranking changes.
