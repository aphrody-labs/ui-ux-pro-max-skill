/**
 * Freshness and generation-isolation contracts for stack guidance
 * (ported from test_web_stack_freshness.py and test_native_desktop_stack_freshness.py,
 * plus the Bun OS stacks m3 and rg-ui).
 */
import { describe, expect, test } from "bun:test";
import { STACK_CONFIG, STACK_CURRENT_APPLICABILITY, searchStack, WEB_STACKS } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { STACK_OFFICIAL_HOSTS } from "../.claude/skills/ui-ux-pro-max/scripts/validate-data.ts";
import { readRows } from "./helpers.ts";

const rows = (stack: string) => readRows(STACK_CONFIG[stack]!.file);
const host = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname : null;
  } catch {
    return null;
  }
};
const recommended = (row: Record<string, string>) => ["Guideline", "Do", "Code Good"].map((field) => row[field] ?? "").join(" ").toLowerCase();
const statuses = (result: { results?: Record<string, string>[] }) => [...new Set((result.results ?? []).map((row) => row.Status))];

const CURRENT_APPLICABILITY: Record<string, string> = {
  react: "react 19.2.x",
  nextjs: "nextjs 16.2",
  vue: "vue 3.5.x",
  svelte: "svelte 5",
  astro: "astro 7.1.6",
  angular: "angular 22.x",
  "html-tailwind": "html-tailwind 4.3",
  shadcn: "shadcn cli 4",
  nuxtjs: "nuxtjs 4.5",
  "nuxt-ui": "nuxt-ui 4.11.1",
  m3: "m3 1.4.4",
  "rg-ui": "rg-ui 1.4.4",
};
const NATIVE_STACKS = ["react-native", "flutter", "swiftui", "jetpack-compose", "avalonia", "uwp", "winui", "wpf", "uno", "javafx", "threejs", "laravel"];

describe("web stack freshness", () => {
  test("web rows have explicit freshness metadata", async () => {
    for (const stack of WEB_STACKS) {
      for (const row of await rows(stack)) {
        expect(["active", "deprecated"]).toContain(row.Status!);
        expect(row["Applies To"]!.startsWith(stack)).toBe(true);
        expect(row["Verified At"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect([stack, row.No, row["Applies To"]!.toLowerCase().includes("legacy")]).toEqual([stack, row.No, row.Status === "deprecated"]);
      }
    }
  });

  test("high-impact rows use official sources", async () => {
    for (const stack of [...WEB_STACKS, ...NATIVE_STACKS]) {
      for (const row of await rows(stack)) {
        if (!["Critical", "High"].includes(row.Severity!)) continue;
        expect([stack, row.No, STACK_OFFICIAL_HOSTS[stack]!.has(host(row["Docs URL"]!) ?? "")]).toEqual([stack, row.No, true]);
      }
    }
  });

  test("active rows use the verified current applicability", async () => {
    for (const [stack, applicability] of Object.entries(CURRENT_APPLICABILITY)) {
      expect(STACK_CURRENT_APPLICABILITY[stack]).toBe(applicability);
      for (const row of await rows(stack)) {
        if (row.Status === "active") expect([stack, row.No, row["Applies To"]!.startsWith(applicability)]).toEqual([stack, row.No, true]);
      }
    }
  });

  test("svelte current and legacy queries do not mix generations", async () => {
    const current = await searchStack("Svelte state props and events", "svelte");
    const legacy = await searchStack("Svelte 4 legacy props and events", "svelte");
    expect(current.count).toBeGreaterThan(0);
    expect(legacy.count).toBeGreaterThan(0);
    expect(statuses(current)).toEqual(["active"]);
    expect(statuses(legacy)).toEqual(["deprecated"]);
    expect(legacy.results!.every((row) => row["Applies To"]!.includes("legacy"))).toBe(true);
  });

  test("explicit old majors use only curated legacy rows", async () => {
    for (const [stack, query] of [
      ["nextjs", "Next.js 15 middleware auth matcher"],
      ["html-tailwind", "Tailwind 3 JIT content configuration"],
      ["nuxtjs", "Nuxt 3 app config runtime config migration"],
      ["svelte", "svelte@4 props events"],
      ["nextjs", "Next.js (v15) middleware"],
      ["html-tailwind", "tailwindcss@3 JIT"],
      ["nuxtjs", "nuxt@3 app config"],
    ] as const) {
      const result = await searchStack(query, stack);
      expect([query, (result.count ?? 0) > 0, statuses(result)]).toEqual([query, true, ["deprecated"]]);
    }
  });

  test("current-major migration query stays on current guidance", async () => {
    const result = await searchStack("Next.js 16 migration to proxy", "nextjs");
    expect(result.count).toBeGreaterThan(0);
    expect(statuses(result)).toEqual(["active"]);
  });

  test("shadcn named base excludes incompatible composition APIs", async () => {
    const result = await searchStack("shadcn Base UI asChild composition", "shadcn");
    expect(result.count).toBeGreaterThan(0);
    expect(result.results![0]!.Guideline).toBe("Use render for Base UI composition");
    expect(result.results!.every((row) => !row["Applies To"]!.includes("base=radix"))).toBe(true);
  });

  test("old major without curated legacy guidance abstains", async () => {
    const result = await searchStack("Astro 5 content collections", "astro");
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });

  test("current high-drift queries return current contracts", async () => {
    for (const [stack, query, expected] of [
      ["nextjs", "Next.js 16 request interception proxy", "proxy"],
      ["html-tailwind", "Tailwind 4 CSS-first source detection", "source"],
      ["react", "React Effect Event latest values inside an Effect", "effect event"],
    ] as const) {
      const result = await searchStack(query, stack, 1);
      expect(result.count).toBe(1);
      expect(result.results![0]!.Status).toBe("active");
      expect(result.results![0]!.Guideline!.toLowerCase()).toContain(expected);
    }
  });

  test("stack without curated legacy rows keeps non-legacy fallback", async () => {
    expect((await searchStack("which Windows UI framework should a new app choose instead of legacy UWP", "uwp")).count).toBeGreaterThan(0);
  });

  test("stale APIs are not recommended by active rows", async () => {
    const forbidden: Record<string, string[]> = {
      svelte: ["$: ", "export let ", "on:click", "createeventdispatcher"],
      nextjs: ["middleware.ts", "function middleware", "skipmiddleware"],
      "html-tailwind": ["content: [", "mode: 'jit'", "@tailwindcss/aspect-ratio", "tailwindcss-container-queries"],
      "nuxt-ui": ["#cell-status", "sortable: true", "v-model:content"],
      astro: ["output: 'hybrid'", "viewtransitions", "@astrojs/tailwind", "astro add prefetch"],
      "rg-ui": ["middleware.ts", "tailwind.config.js"],
    };
    for (const [stack, tokens] of Object.entries(forbidden)) {
      for (const row of await rows(stack)) {
        if (row.Status !== "active") continue;
        for (const token of tokens) expect([stack, row.No, recommended(row).includes(token)]).toEqual([stack, row.No, false]);
      }
    }
    expect((await rows("nextjs"))[12]!["Code Good"]!.toLowerCase()).not.toContain("fetch(url {");
    expect((await rows("react"))[39]!["Code Good"]!.toLowerCase()).not.toContain("catch(e) {}");
  });
});

describe("native, desktop and 3D stack freshness", () => {
  test("rows have final freshness metadata", async () => {
    for (const stack of NATIVE_STACKS) {
      for (const row of await rows(stack)) {
        expect([stack, row.No, row.Status]).toEqual([stack, row.No, stack === "uwp" ? "deprecated" : "active"]);
        expect(row["Applies To"]!.startsWith(STACK_CURRENT_APPLICABILITY[stack]!)).toBe(true);
        expect(row["Verified At"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(row["Applies To"]!.includes("legacy")).toBe(stack === "uwp");
      }
    }
  });

  test("current mobile contracts", async () => {
    for (const [stack, query, expected] of [
      ["react-native", "Hermes bundled default engine", "hermes"],
      ["flutter", "predictive back result callback", "onpopinvokedwithresult"],
      ["flutter", "accessible nonlinear text scaling", "textscaler"],
      ["swiftui", "multicolumn navigation sidebar detail", "navigationsplitview"],
    ] as const) {
      const result = await searchStack(query, stack, 1);
      expect(result.count).toBe(1);
      expect(recommended(result.results![0]!)).toContain(expected);
    }
  });

  test("Windows current and maintenance lanes are visible", async () => {
    const current = await searchStack("new Windows desktop app Windows App SDK", "winui");
    const legacy = await searchStack("UWP maintenance x:Bind migration", "uwp");
    expect(current.count).toBeGreaterThan(0);
    expect(legacy.count).toBeGreaterThan(0);
    expect(statuses(current)).toEqual(["active"]);
    expect(statuses(legacy)).toEqual(["deprecated"]);
    expect(legacy.results!.some((row) => Object.values(row).join(" ").toLowerCase().includes("winui"))).toBe(true);
    const successor = await searchStack("which Windows UI framework should a brand new app choose instead of legacy UWP", "uwp", 1);
    expect(successor.results![0]!.Guideline).toBe("Prefer WinUI 3 for new projects");
  });

  test("old version without curated rows abstains", async () => {
    for (const [stack, query] of Object.entries({
      "react-native": "React Native 0.75 Hermes",
      flutter: "Flutter SDK 3.22 back navigation",
      swiftui: "iOS 15 SwiftUI navigation",
      avalonia: "Avalonia UI v11 storage picker",
      winui: "WinUI SDK 2 desktop app",
      javafx: "JavaFX SDK 21 table view",
      threejs: "Three.js r128 OrbitControls",
      laravel: "Laravel 12 validation",
    })) {
      expect([stack, (await searchStack(query, stack)).count]).toEqual([stack, 0]);
    }
  });

  test("migration intent returns current replacements", async () => {
    for (const [stack, query] of [
      ["flutter", "replace deprecated WillPopScope with current Flutter API"],
      ["react-native", "upgrade legacy Hermes configuration"],
      ["threejs", "replace deprecated outputEncoding with current color space"],
      ["react-native", "upgrade React Native 0.75 to React Native 0.86 Hermes"],
      ["flutter", "upgrade Flutter 3.22 to Flutter 3.44 predictive back"],
      ["threejs", "upgrade Three.js r128 to r185 outputColorSpace"],
    ] as const) {
      const result = await searchStack(query, stack);
      expect([query, (result.count ?? 0) > 0, statuses(result)]).toEqual([query, true, ["active"]]);
    }
  });

  test("standalone current and deprecated identifiers resolve replacement", async () => {
    for (const [stack, query, guideline] of [
      ["flutter", "onPopInvokedWithResult", "PopScope"],
      ["flutter", "TextScaler", "large fonts"],
      ["threejs", "outputColorSpace", "Color Space"],
      ["threejs", "outputEncoding", "Color Space"],
    ] as const) {
      const result = await searchStack(query, stack, 1);
      expect(result.count).toBe(1);
      expect(result.results![0]!.Guideline!.toLowerCase()).toContain(guideline.toLowerCase());
    }
  });

  test("current threejs uses supported module and color APIs", async () => {
    for (const [query, expected] of [
      ["Three.js current OrbitControls addon import", "three/addons/"],
      ["Three.js current renderer color space", "outputcolorspace"],
      ["Three.js frame-rate independent delta time", "three.timer"],
    ] as const) {
      const result = await searchStack(query, "threejs", 1);
      expect(result.count).toBe(1);
      expect(recommended(result.results![0]!)).toContain(expected);
    }
  });

  test("deprecated symbols are not recommended by current rows", async () => {
    const forbidden: Record<string, string[]> = {
      "react-native": ["hermes_enabled"],
      flutter: ["willpopscope", "onpopinvoked:", "textscalefactor"],
      swiftui: ["navigationview", "presentationmode"],
      winui: ["dispatcher.runasync", "system.windows"],
      uno: ["system.windows", 'requestedtheme="default"'],
      javafx: ["fxpermission", "javadoc/21"],
      threejs: ["r128", "three.orbitcontrols", "outputencoding", "three.srgbencoding", "examples/js/controls", "three.clock", "clock.getdelta", "clock.getelapsedtime", "pcfsoftshadowmap", "three/examples/jsm/"],
    };
    for (const [stack, tokens] of Object.entries(forbidden)) {
      for (const row of await rows(stack)) {
        if (row.Status !== "active") continue;
        for (const token of tokens) expect([stack, row.No, recommended(row).includes(token)]).toEqual([stack, row.No, false]);
      }
    }
  });
});
