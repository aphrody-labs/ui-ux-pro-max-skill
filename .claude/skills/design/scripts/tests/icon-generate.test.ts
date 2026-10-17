/**
 * Offline tests for icon/generate.ts (Gemini stubbed through `runtime`).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as icon from "../icon/generate.ts";
import { runtime, type GeminiResponse } from "../lib/providers.ts";

const original = { ...runtime };
const originalConfig = { ...icon.config };
const originalLog = console.log;
let dir: string;
let logs: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(import.meta.dir, ".tmp-icon-"));
  icon.config.GEMINI_API_KEY = "test-key";
  runtime.sleep = mock(async () => {});
  logs = [];
  console.log = (...args: unknown[]) => void logs.push(args.join(" "));
});

afterEach(async () => {
  Object.assign(runtime, original);
  Object.assign(icon.config, originalConfig);
  console.log = originalLog;
  await rm(dir, { recursive: true, force: true });
});

const response = (text: string | null, finishReason?: string): GeminiResponse => ({
  candidates: [{ finishReason, content: text === null ? undefined : { parts: [{ text }] } }],
});

/** Root <svg> attributes and children attributes, read with Bun's HTMLRewriter. */
async function parseSvg(svg: string) {
  const root: Record<string, string> = {};
  const children: Array<Record<string, string>> = [];
  const attrs = (e: { attributes: IterableIterator<[string, string]> }) => Object.fromEntries([...e.attributes]);
  await new HTMLRewriter()
    .on("svg", { element: (e) => void Object.assign(root, attrs(e)) })
    .on("svg > *", { element: (e) => void children.push(attrs(e)) })
    .transform(new Response(svg))
    .text();
  return { root, children };
}

describe("applyViewboxSize", () => {
  test("only touches the root tag", () => {
    const out = icon.applyViewboxSize('<svg viewBox="0 0 24 24" stroke-width="2"><rect width="10" height="8"/></svg>', 48);
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('<rect width="10" height="8"/>');
    expect(out).toContain('viewBox="0 0 24 24"');
    const rootTag = out.slice(0, out.indexOf(">") + 1);
    expect(rootTag).toContain('width="48"');
    expect(rootTag).toContain('height="48"');
  });

  test("handles width and height independently", () => {
    const out = icon.applyViewboxSize("<svg width='10' viewBox='0 0 24 24'><path d='M0 0'/></svg>", 32);
    const rootTag = out.slice(0, out.indexOf(">") + 1);
    expect(rootTag).toContain('width="32"');
    expect(rootTag).toContain('height="32"');
    expect(rootTag).not.toContain("width='10'");
  });

  const cases: Array<[string, Record<string, string>]> = [
    ['<svg aria-label="height=\'2\'" viewBox="0 0 24 24"><path/></svg>', { "aria-label": "height='2'" }],
    ["<svg aria-label='width=\"2\" height=\"3\"' viewBox='0 0 24 24'><path/></svg>", { "aria-label": 'width="2" height="3"' }],
    ['<svg data-note="a > b width=\'1\'" height="5" viewBox="0 0 24 24"><path/></svg>', { "data-note": "a > b width='1'" }],
    ["<svg data-note='x>y height=\"2\"' width='7'><rect width='1' height='1'/></svg>", { "data-note": 'x>y height="2"' }],
  ];
  for (const [src, kept] of cases) {
    test(`ignores attribute text inside quoted values: ${src.slice(0, 40)}`, async () => {
      const { root, children } = await parseSvg(icon.applyViewboxSize(src, 24));
      expect(root.width).toBe("24");
      expect(root.height).toBe("24");
      for (const [name, value] of Object.entries(kept)) expect(root[name]).toBe(value);
      for (const child of children) expect([undefined, "1"]).toContain(child.width);
    });
  }
});

describe("generateIcon", () => {
  test("uses a large token budget", async () => {
    const call = mock(async () => response('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'));
    runtime.geminiGenerateContent = call;
    const out = join(dir, "a.svg");
    expect(await icon.generateIcon({ prompt: "crane", outputPath: out })).toBe(out);
    const body = (call.mock.calls[0] as unknown[])[2] as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(16384);
  });

  test("reports MAX_TOKENS without retrying", async () => {
    runtime.geminiGenerateContent = mock(async () => response('```svg\n<svg viewBox="0 0 24 24"><path d="M 15 14 H 19', "MAX_TOKENS"));
    expect(await icon.generateIcon({ prompt: "crane" })).toBeNull();
    expect(logs.join("\n")).toContain("MAX_TOKENS");
    expect(runtime.geminiGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("reports an empty response separately", async () => {
    runtime.geminiGenerateContent = mock(async () => response("", "STOP"));
    expect(await icon.generateIcon({ prompt: "crane" })).toBeNull();
    const out = logs.join("\n");
    expect(out).toContain("empty response");
    expect(out).not.toContain("MAX_TOKENS");
  });

  test("handles a response without text", async () => {
    runtime.geminiGenerateContent = mock(async () => response(null, "SAFETY"));
    expect(await icon.generateIcon({ prompt: "crane" })).toBeNull();
    expect(logs.join("\n")).toContain("empty response");
  });
});

describe("generateBatch", () => {
  test("reports MAX_TOKENS", async () => {
    runtime.geminiGenerateContent = mock(async () => response('<svg viewBox="0 0 24 24"><path d="M 15 14 H 19', "MAX_TOKENS"));
    expect(await icon.generateBatch("crane", 2, dir)).toEqual([]);
    const out = logs.join("\n");
    expect(out).toContain("MAX_TOKENS");
    expect(out).not.toContain("Error generating icons");
  });

  test("handles an empty candidate list", async () => {
    runtime.geminiGenerateContent = mock(async () => ({ candidates: [] }));
    expect(await icon.generateBatch("crane", 2, dir)).toEqual([]);
    const out = logs.join("\n");
    expect(out).toContain("empty response");
    expect(out).not.toContain("Error generating icons");
  });

  test("warns when truncated after some icons", async () => {
    runtime.geminiGenerateContent = mock(async () =>
      response('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>\n<svg viewBox="0 0 24 24"><path d="M 15 14 H 19', "MAX_TOKENS"),
    );
    expect((await icon.generateBatch("crane", 2, dir)).length).toBe(1);
    expect(logs.join("\n")).toContain("MAX_TOKENS");
  });
});

describe("main exit status", () => {
  test("exits 1 when the icon request fails", async () => {
    runtime.geminiGenerateContent = mock(async () => {
      throw new Error("429 RESOURCE_EXHAUSTED");
    });
    expect(await icon.main(["--prompt", "crane", "--output", join(dir, "a.svg")])).toBe(1);
  });

  test("exits 1 when a batch generates nothing", async () => {
    runtime.geminiGenerateContent = mock(async () => ({ candidates: [] }));
    expect(await icon.main(["--prompt", "crane", "--batch", "2", "--output-dir", dir])).toBe(1);
  });

  test("exits 0 when the icon is saved", async () => {
    runtime.geminiGenerateContent = mock(async () => response('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'));
    expect(await icon.main(["--prompt", "crane", "--output", join(dir, "a.svg")])).toBe(0);
    expect(await readdir(dir)).toEqual(["a.svg"]);
  });

  test("--list-styles exits 0", async () => {
    expect(await icon.main(["--list-styles"])).toBe(0);
  });
});
