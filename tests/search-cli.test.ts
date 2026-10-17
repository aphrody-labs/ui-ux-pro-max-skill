/** search.ts CLI contracts (ported from test_design_system_stack.py, issue #484, plus the Bun OS flags). */
import { describe, expect, test } from "bun:test";
import { runBun, SEARCH_SCRIPT } from "./helpers.ts";

const runSearch = (...args: string[]) => runBun([SEARCH_SCRIPT, ...args]);

describe("--stack with --design-system", () => {
  test("design system with stack succeeds and says stack is ignored", () => {
    const proc = runSearch("platform engineer dashboard", "--design-system", "--stack", "nextjs");
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr).toContain("--stack");
    expect(proc.stderr.toLowerCase()).toContain("ignored");
  });

  test("design system without stack stays quiet", () => {
    const proc = runSearch("platform engineer dashboard", "--design-system");
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toLowerCase()).not.toContain("ignored");
  });

  test("stack search alone never warns", () => {
    const proc = runSearch("dashboard table density", "--stack", "nextjs");
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toLowerCase()).not.toContain("ignored");
  });
});

describe("JSON and Bun OS options", () => {
  test("domain search JSON output is parseable", () => {
    const proc = runSearch("keyboard focus modal", "--domain", "ux", "--json");
    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(proc.stdout);
    expect(payload.domain).toBe("ux");
    expect(payload.results.length).toBeGreaterThan(0);
  });

  test("m3 and rg-ui stacks are searchable from the CLI", () => {
    for (const stack of ["m3", "rg-ui"]) {
      const proc = runSearch("theme tokens", "--stack", stack, "--json");
      expect(proc.exitCode).toBe(0);
      expect(JSON.parse(proc.stdout).stack).toBe(stack);
    }
  });

  test("invalid stack is rejected", () => {
    expect(runSearch("anything", "--stack", "not-a-stack").exitCode).not.toBe(0);
  });
});
