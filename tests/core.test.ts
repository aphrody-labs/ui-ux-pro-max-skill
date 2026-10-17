/** Regression tests for core.ts / design-system.ts (ported from test_core.py). */
import { describe, expect, spyOn, test, afterAll } from "bun:test";
import { stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import {
  AVAILABLE_STACKS,
  BM25,
  CSV_CONFIG,
  DATA_DIR,
  DOMAIN_QUERY_REWRITES,
  detectDomain,
  detectDomainWithRunnerUp,
  domainKeywords,
  loadCsv,
  search,
  searchCsvDetailed,
  searchStack,
} from "../.claude/skills/ui-ux-pro-max/scripts/core.ts";
import { DesignSystemGenerator, generateDesignSystem } from "../.claude/skills/ui-ux-pro-max/scripts/design-system.ts";
import { cleanScratch, scratchDir, SEARCH_SCRIPT } from "./helpers.ts";

afterAll(cleanScratch);

describe("tokenizer", () => {
  test("short domain terms are kept", () => {
    const tokens = new BM25().tokenize("UI and UX design with 3D and AI");
    for (const token of ["ui", "3d", "ai"]) expect(tokens).toContain(token);
  });

  test("stopwords removed", () => {
    const tokens = new BM25().tokenize("this is for the team to do");
    for (const stopword of ["is", "for", "the", "to", "do"]) expect(tokens).not.toContain(stopword);
  });

  test("synonym normalization", () => {
    const bm25 = new BM25();
    expect(bm25.tokenize("e-commerce store")).toEqual(bm25.tokenize("ecommerce store"));
    expect(bm25.tokenize("dark-mode toggle")).toEqual(bm25.tokenize("dark toggle"));
  });

  test("boundary-safe nav normalization preserves existing words", () => {
    const tokens = new BM25().tokenize("nav navigation navbar");
    expect(tokens).toContain("navigation");
    expect(tokens).toContain("navbar");
    expect(tokens).not.toContain("navigationigation");
    expect(tokens).not.toContain("navigationbar");
  });

  test("punctuation and UK variants normalize to canonical tokens", () => {
    const tokens = new BM25().tokenize("colour, organisation; behaviour customisation");
    for (const expected of ["color", "organization", "behavior", "customization"]) expect(tokens).toContain(expected);
  });
});

describe("BM25 core behavior", () => {
  test("empty documents produce no scores or vocab", () => {
    const bm25 = new BM25();
    bm25.fit([]);
    expect(bm25.score("anything")).toEqual([]);
    expect(bm25.vocabulary()).toEqual([]);
  });

  test("bm25 cache rebuilds after file mtime changes", async () => {
    const path = join(await scratchDir("bm25-cache"), "search.csv");
    await Bun.write(path, "Name,Keywords\nAlpha,alpha token\n");
    const a = await searchCsvDetailed(path, ["Name", "Keywords"], ["Name"], "alpha", 1);
    expect(a.results[0]!.Name).toBe("Alpha");

    await Bun.write(path, "Name,Keywords\nBeta,beta token\n");
    const info = await stat(path);
    await utimes(path, new Date(info.atimeMs + 1000), new Date(info.mtimeMs + 1000));

    const b = await searchCsvDetailed(path, ["Name", "Keywords"], ["Name"], "beta", 1);
    expect(b.results[0]!.Name).toBe("Beta");
    expect(b.index).not.toBe(a.index);
  });

  test("search uses one verified rows and index snapshot", async () => {
    const path = join(await scratchDir("bm25-snapshot"), "search.csv");
    await Bun.write(path, "Name,Keywords\nAlpha,alpha token\n");
    let replaced = false;
    const original = BM25.prototype.fit;
    const spy = spyOn(BM25.prototype, "fit").mockImplementation(function (this: BM25, documents: readonly string[]) {
      if (!replaced) {
        replaced = true;
        // Rewrite the file between the verified read and indexing.
        require("node:fs").writeFileSync(path, "Name,Keywords\nBeta,beta token\n");
      }
      return original.call(this, documents);
    });
    try {
      const first = await searchCsvDetailed(path, ["Name", "Keywords"], ["Name"], "alpha", 1);
      expect(first.results[0]!.Name).toBe("Alpha");
    } finally {
      spy.mockRestore();
    }
    const info = await stat(path);
    await utimes(path, new Date(info.atimeMs + 1000), new Date(info.mtimeMs + 1000));
    const second = await searchCsvDetailed(path, ["Name", "Keywords"], ["Name"], "beta", 1);
    expect(second.results[0]!.Name).toBe("Beta");
  });
});

describe("search domains", () => {
  test("read failure is not reported as a search result", async () => {
    const originalFile = Bun.file;
    const spy = spyOn(Bun, "file").mockImplementation(((path: string, options?: BlobPropertyBag) => {
      const real = originalFile(path, options);
      if (typeof path !== "string" || !path.endsWith(".csv")) return real;
      return new Proxy(real, {
        get(target, key) {
          if (key === "text") return async () => Promise.reject(new TypeError("invalid utf-8"));
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof Bun.file);
    let domain;
    let stack;
    try {
      // Fresh paths so cached snapshots cannot answer.
      domain = await searchCsvDetailed(join(DATA_DIR, "colors.csv") + "", ["Product Type"], ["Product Type"], "palette", 1);
      stack = await searchCsvDetailed(join(DATA_DIR, "stacks", "react.csv"), ["Guideline"], ["Guideline"], "component", 1);
    } finally {
      spy.mockRestore();
    }
    for (const result of [domain, stack]) {
      expect(result!.results).toEqual([]);
      if (result!.diagnostic.reason === "read-error") {
        expect(result!.diagnostic.error).toMatch(/^Unable to read search data:/);
        expect(result!.diagnostic.error).not.toContain("invalid");
      }
    }
  });

  test("ui is searchable in style domain", async () => {
    expect((await search("ui minimalism", "style", 1)).count).toBeGreaterThan(0);
  });

  test("accessibility query hits ux", async () => {
    expect((await search("accessibility contrast wcag keyboard", "ux", 3)).count).toBeGreaterThan(0);
  });

  test("zero-result query reports suggestions, not error", async () => {
    const result = await search("zzqqxx totally made up gibberish", "ux", 2);
    expect(result.count).toBe(0);
    expect(result).toHaveProperty("suggestions");
    expect(result).not.toHaveProperty("error");
  });

  test("hard-negative query abstains across registered domains and stacks", async () => {
    const query = "sourdough starter crumb fermentation";
    for (const domain of Object.keys(CSV_CONFIG)) expect([domain, (await search(query, domain, 1)).count]).toEqual([domain, 0]);
    for (const stack of AVAILABLE_STACKS) expect([stack, (await searchStack(query, stack, 1)).count]).toEqual([stack, 0]);
  });

  test("typo suggestions are deterministic and retryable", async () => {
    const first = await search("testimonal", "landing", 3);
    const second = await search("testimonal", "landing", 3);
    expect(first.count).toBe(0);
    expect(first.suggestions).toEqual(second.suggestions!);
    expect(first.suggestions!.length).toBeGreaterThan(0);
    expect((await search(first.suggestions![0]!, "landing", 3)).count).toBeGreaterThan(0);
  });

  test("suggestions never repeat the input or offer a dead first retry", async () => {
    expect((await search("pricing", "landing", 3)).suggestions ?? []).not.toContain("pricing");
    const minimal = await search("minimal", "style", 3);
    expect(minimal.count).toBe(1);
    expect(minimal.results![0]!["Style ID"]).toBe("minimalism-and-swiss-style");
  });

  test("unknown programmatic domain keeps legacy style fallback", async () => {
    const result = await search("minimalism", "unknown", 1);
    expect(result.domain).toBe("unknown");
    expect(result.file).toBe(CSV_CONFIG.style.file);
    expect(result.count).toBeGreaterThan(0);
  });

  test("unsupported icon library abstains instead of returning other library", async () => {
    const result = await search("lucide icon", null, 3, true);
    expect(result.domain).toBe("icons");
    expect(result.count).toBe(0);
    expect(result.diagnostics!.reason).toBe("unsupported-library");
  });

  test("every configured domain file exists and is searchable", async () => {
    for (const domain of Object.keys(CSV_CONFIG)) expect([domain, (await search("design", domain, 1)).error]).toEqual([domain, undefined]);
  });

  test("chart output keeps legacy grade during risk migration", async () => {
    const result = await search("time series chart", "chart", 1);
    expect(result.count).toBe(1);
    expect(result.results![0]!["Accessibility Grade"]).toBe("deprecated: use Accessibility Risk");
    expect(result.results![0]).toHaveProperty("Accessibility Risk");
  });

  test("every stack file exists and is searchable", async () => {
    for (const stack of AVAILABLE_STACKS) expect([stack, (await searchStack("performance", stack, 1)).error]).toEqual([stack, undefined]);
  });
});

describe("domain detection", () => {
  test("routing contracts", async () => {
    expect(await detectDomain("glassmorphism dark ui")).toBe("style");
    expect(await detectDomain("accessibility contrast wcag")).toBe("ux");
    expect((await detectDomainWithRunnerUp("font pairing elegant crypto"))[0]).toBeTruthy();
    expect(await detectDomain("...!!!???")).toBe("style");
    expect(await detectDomain("semantic color tokens palette")).toBe("color");
    expect(await detectDomain("lucide search icon outline")).toBe("icons");
    expect(await detectDomain("font pairing elegant serif body font")).toBe("typography");
    expect(await detectDomain("time series chart forecast")).toBe("chart");
    expect(await detectDomain("C# WPF desktop app")).not.toBe("color");
    expect(await detectDomain("use #ff00aa as the accent")).toBe("color");
    expect(await detectDomain("beauty spa")).toBe("product");
    expect(await detectDomain("salon booking")).toBe("product");
    expect(await detectDomain("drag reorder react native")).toBe("web");
  });

  test("every router term is searchable or has a corpus rewrite", async () => {
    for (const [domain, keywords] of Object.entries(await domainKeywords())) {
      const config = (CSV_CONFIG as Record<string, { file: string; searchCols: readonly string[] }>)[domain]!;
      const rows = await loadCsv(join(DATA_DIR, config.file));
      const index = new BM25();
      index.fit(rows.map((row) => config.searchCols.map((column) => String(row[column] ?? "")).join(" ")));
      const vocabulary = new Set(index.vocabulary());
      const rewrites = (DOMAIN_QUERY_REWRITES as Record<string, Record<string, string | null>>)[domain] ?? {};
      for (const keyword of keywords) {
        const searchable = index.tokenize(keyword).some((token) => vocabulary.has(token));
        expect([domain, keyword, searchable || keyword in rewrites]).toEqual([domain, keyword, true]);
      }
    }
  });
});

describe("persistence", () => {
  test("concurrent non-force persist has one writer", async () => {
    const tmp = await scratchDir("race");
    const processes = Array.from({ length: 8 }, (_, index) =>
      Bun.spawn(
        [process.execPath, SEARCH_SCRIPT, `saas dashboard ${index}`, "--design-system", "--persist", "--project-name", "Race Probe", "--output-dir", tmp, "--json"],
        { stdout: "pipe", stderr: "pipe" },
      ),
    );
    const statuses: string[] = [];
    for (const proc of processes) {
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect([await proc.exited, stderr]).toEqual([0, ""]);
      statuses.push(JSON.parse(stdout).persistence.status);
    }
    expect(statuses.filter((status) => status === "success")).toHaveLength(1);
    expect(statuses.filter((status) => status === "skipped_exists")).toHaveLength(7);
  }, 120_000);

  test("persist then skip then force", async () => {
    const tmp = await scratchDir("persist");
    const result = await generateDesignSystem("saas dashboard", { projectName: "Test Project", persist: true, outputDir: tmp });
    expect(result.persistence!.status).toBe("success");
    const master = Bun.file(result.persistence!.master_file);
    expect(await master.exists()).toBe(true);
    const original = await master.text();

    const second = await generateDesignSystem("saas dashboard", { projectName: "Test Project", persist: true, outputDir: tmp });
    expect(second.persistence!.status).toBe("skipped_exists");
    expect(await Bun.file(result.persistence!.master_file).text()).toBe(original);

    const page = await generateDesignSystem("checkout form", { projectName: "Test Project", persist: true, page: "Checkout", outputDir: tmp });
    expect(page.persistence!.status).toBe("success");
    expect(await Bun.file(result.persistence!.master_file).text()).toBe(original);
    const pageFile = join(tmp, "design-system", "test-project", "pages", "checkout.md");
    expect(page.persistence!.created_files).toEqual([pageFile]);
    const pageContent = await Bun.file(pageFile).text();

    const page2 = await generateDesignSystem("different checkout", { projectName: "Test Project", persist: true, page: "Checkout", outputDir: tmp });
    expect(page2.persistence!.status).toBe("skipped_exists");
    expect(await Bun.file(pageFile).text()).toBe(pageContent);

    const forced = await generateDesignSystem("ecommerce luxury", { projectName: "Test Project", persist: true, outputDir: tmp, force: true });
    expect(forced.persistence!.status).toBe("success");
  });

  test("persist writes only under output dir", async () => {
    const tmp = await scratchDir("scoped");
    await generateDesignSystem("saas dashboard", { projectName: "Scoped Project", persist: true, outputDir: tmp });
    expect(await Bun.file(join(tmp, "design-system", "scoped-project", "MASTER.md")).exists()).toBe(true);
  });
});

describe("reasoning match", () => {
  test("known category matches exactly; unknown falls back gracefully", async () => {
    const generator = await DesignSystemGenerator.create();
    expect(Object.keys(generator.findReasoningRule("SaaS (General)")).length).toBeGreaterThan(0);
    expect(generator.findReasoningRule("Totally Unknown Category XYZ")).toEqual({});
  });
});

describe("diagnostics contracts", () => {
  test("diagnostics opt-in is additive for domain search", async () => {
    const baseline = await search("minimalism", "style", 1);
    const diagnosed = await search("minimalism", "style", 1, true);
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(diagnosed).filter((key) => key !== "diagnostics").sort());
    expect(diagnosed.diagnostics).toHaveProperty("top_score");
    expect(diagnosed.diagnostics).toHaveProperty("query_rewrites");
  });

  test("diagnostics opt-in is additive for stack search", async () => {
    const baseline = await searchStack("performance", "react", 1);
    const diagnosed = await searchStack("performance", "react", 1, true);
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(diagnosed).filter((key) => key !== "diagnostics").sort());
    expect(diagnosed).toHaveProperty("diagnostics");
  });
});
