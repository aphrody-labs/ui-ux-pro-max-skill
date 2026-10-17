#!/usr/bin/env bun
/**
 * Smoke test: every stack registered in STACK_CONFIG must return at least one
 * search result for a focused query. Catches registry/CSV regressions early.
 * Usage: bun scripts/smoke-stacks.ts [query]   (EXPECTED_STACK_COUNT, default 24)
 */
import { AVAILABLE_STACKS } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { runSmoke } from "./lib/smoke.ts";

export const STACK_PROBES: Readonly<Record<string, string>> = {
  react: "React useState for component local state",
  nextjs: "Next.js App Router for a new project",
  vue: "Vue Composition API for a new project",
  svelte: "Svelte 5 $state rune for reactive state",
  astro: "Astro islands architecture interactive components",
  swiftui: "SwiftUI @State for view-local value state",
  "react-native": "functional React Native components",
  flutter: "prefer StatelessWidget when Flutter UI has no mutable state",
  nuxtjs: "Nuxt file-based page routing",
  "nuxt-ui": "install the Nuxt UI module",
  "html-tailwind": "Tailwind z-index utility scale for layered UI",
  shadcn: "install shadcn components with the CLI",
  "jetpack-compose": "pure Jetpack Compose UI composables",
  threejs: "Three.js OrbitControls must be imported separately",
  angular: "standalone Angular components for a new project",
  laravel: "reusable Laravel Blade UI components",
  javafx: "launch JavaFX UI from an Application subclass",
  wpf: "WPF INotifyPropertyChanged data binding updates",
  winui: "WinUI InfoBar for status messages",
  avalonia: "Avalonia XAML namespace declaration",
  uno: "Uno Platform WinUI XAML API surface",
  uwp: "UWP compiled x:Bind data binding",
  m3: "Material 3 color role tokens",
  "rg-ui": "rg-ui theme tokens sidebar",
};

if (import.meta.main) {
  process.exit(
    await runSmoke({
      kind: "stack",
      names: AVAILABLE_STACKS,
      expectedCount: Number(Bun.env.EXPECTED_STACK_COUNT ?? 24),
      expectedEnv: "EXPECTED_STACK_COUNT",
      probes: STACK_PROBES,
      override: Bun.argv[2],
    }),
  );
}
