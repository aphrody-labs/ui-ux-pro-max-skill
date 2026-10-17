/**
 * Offline tests for cip/generate.ts (Gemini stubbed through `runtime`).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import * as cip from "../cip/generate.ts";
import { runtime } from "../lib/providers.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 4]);
const WEBP = new TextEncoder().encode("RIFFwebp");

const PROMPT_DATA: cip.PromptData = {
  prompt: "business card mockup",
  deliverable: "Business Card",
  brand: "Demo",
  style: "Corporate Minimal",
  mockup_context: "desk",
};

const original = { ...runtime };
const originalLog = console.log;
const savedEnv = { ...process.env };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(import.meta.dir, ".tmp-cip-"));
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_FLASH_IMAGE_MODEL;
  delete process.env.GEMINI_PRO_IMAGE_MODEL;
  console.log = () => {};
});

afterEach(async () => {
  Object.assign(runtime, original);
  console.log = originalLog;
  for (const key of ["GEMINI_API_KEY", "GEMINI_FLASH_IMAGE_MODEL", "GEMINI_PRO_IMAGE_MODEL"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(dir, { recursive: true, force: true });
});

const imageResponse = (mimeType: string, data: Uint8Array) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(data).toString("base64") } }] } }],
});

describe("generateWithNanoBanana", () => {
  for (const [mime, data, extension] of [
    ["image/jpeg", JPEG, ".jpg"],
    ["image/png", PNG, ".png"],
    ["image/webp", WEBP, ".webp"],
  ] as const) {
    test(`mockup extension follows the returned ${mime}`, async () => {
      runtime.geminiGenerateContent = mock(async () => imageResponse(mime, data));
      const filepath = await cip.generateWithNanoBanana(PROMPT_DATA, dir, "pro");
      expect(extname(filepath!)).toBe(extension);
      expect(await Bun.file(filepath!).bytes()).toEqual(data);
    });
  }

  test("pro uses the GA model", async () => {
    const call = mock(async () => imageResponse("image/png", PNG));
    runtime.geminiGenerateContent = call;
    await cip.generateWithNanoBanana(PROMPT_DATA, dir, "pro");
    expect((call.mock.calls[0] as unknown[])[0]).toBe("gemini-3-pro-image");
  });

  test("the logo file is sent as inline image data", async () => {
    const call = mock(async () => imageResponse("image/png", PNG));
    runtime.geminiGenerateContent = call;
    const logoPath = join(dir, "logo.png");
    await Bun.write(logoPath, PNG);
    const logo = await cip.loadLogoImage(logoPath);
    await cip.generateWithNanoBanana(PROMPT_DATA, dir, "flash", "1:1", logo);
    const body = (call.mock.calls[0] as unknown[])[2] as { contents: Array<{ parts: Array<Record<string, any>> }> };
    expect(body.contents[0]!.parts[1]!.inlineData).toEqual({ mimeType: "image/png", data: Buffer.from(PNG).toString("base64") });
  });
});

test("model ids can be overridden from the environment", () => {
  process.env.GEMINI_FLASH_IMAGE_MODEL = "flash-next";
  process.env.GEMINI_PRO_IMAGE_MODEL = "pro-next";
  expect(cip.models()).toEqual({ flash: "flash-next", pro: "pro-next" });
});

describe("main exit status", () => {
  const fail = () =>
    mock(async () => {
      throw new Error("429 RESOURCE_EXHAUSTED");
    });

  test("exits 1 when a single deliverable fails", async () => {
    runtime.geminiGenerateContent = fail();
    expect(await cip.main(["--brand", "Demo", "--deliverable", "business card", "--no-logo-prompt", "--output", dir])).toBe(1);
  });

  test("exits 1 when every deliverable in a set fails", async () => {
    runtime.geminiGenerateContent = fail();
    expect(await cip.main(["--brand", "Demo", "--deliverables", "business card,letterhead", "--no-logo-prompt", "--output", dir])).toBe(1);
  });

  test("exits 0 when part of a set is generated", async () => {
    const call = mock(async () => imageResponse("image/png", PNG) as any);
    call.mockRejectedValueOnce(new Error("429 RESOURCE_EXHAUSTED"));
    runtime.geminiGenerateContent = call;
    expect(await cip.main(["--brand", "Demo", "--deliverables", "business card,letterhead", "--no-logo-prompt", "--output", dir])).toBe(0);
    expect((await readdir(dir)).filter((f) => f.endsWith(".png")).length).toBe(1);
  });

  test("--prompt-only exits 0 without calling the model", async () => {
    runtime.geminiGenerateContent = fail();
    expect(await cip.main(["--brand", "Demo", "--deliverable", "business card", "--prompt-only"])).toBe(0);
    expect(runtime.geminiGenerateContent).not.toHaveBeenCalled();
  });
});
