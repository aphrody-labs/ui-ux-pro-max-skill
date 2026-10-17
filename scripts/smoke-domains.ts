#!/usr/bin/env bun
/** Smoke test every registered non-stack search domain. Usage: bun scripts/smoke-domains.ts [query] */
import { CSV_CONFIG } from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { runSmoke } from "./lib/smoke.ts";

export const DOMAIN_PROBES: Readonly<Record<string, string>> = {
  style: "minimalism ui glassmorphism design",
  color: "healthcare app calming trustworthy",
  chart: "time series chart trend dashboard",
  landing: "hero testimonials cta conversion landing page",
  product: "saas dashboard app product",
  ux: "accessibility keyboard navigation focus",
  typography: "font pairing heading body typography",
  icons: "warning icon glyph symbol",
  gsap: "gsap scroll reveal stagger animation",
  react: "react performance rerender waterfall suspense",
  web: "aria form accessibility input outline",
  "google-fonts": "google font family sans serif variable",
  brand: "rose griffon roy brand theme",
};

if (import.meta.main) {
  process.exit(
    await runSmoke({
      kind: "domain",
      names: Object.keys(CSV_CONFIG),
      expectedCount: Number(Bun.env.EXPECTED_DOMAIN_COUNT ?? 13),
      expectedEnv: "EXPECTED_DOMAIN_COUNT",
      probes: DOMAIN_PROBES,
      override: Bun.argv[2],
    }),
  );
}
