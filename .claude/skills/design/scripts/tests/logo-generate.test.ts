/**
 * Offline tests for logo/generate.ts: Atlas Cloud and MuAPI polling, media
 * download safety, Gemini image types and CLI exit status. Network and
 * timing go through the patchable `runtime` object.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathForImageType, runtime, validatePublicHttpsUrl } from "../lib/providers.ts";
import * as logo from "../logo/generate.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("jpeg-bytes")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode("png-bytes")]);

const original = { ...runtime };
const originalApi = { ...logo.api };
const originalConfig = { ...logo.config };
let dir: string;
let logs: string[];
const originalLog = console.log;

beforeEach(async () => {
  dir = await mkdtemp(join(import.meta.dir, ".tmp-logo-"));
  runtime.sleep = mock(async () => {});
  logs = [];
  console.log = (...args: unknown[]) => void logs.push(args.join(" "));
});

afterEach(async () => {
  Object.assign(runtime, original);
  Object.assign(logo.api, originalApi);
  Object.assign(logo.config, originalConfig);
  console.log = originalLog;
  await rm(dir, { recursive: true, force: true });
});

const imageResponse = (mimeType: string, data: Uint8Array) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(data).toString("base64") } }] } }],
});

describe("Atlas Cloud", () => {
  test("submits once and polls until completed", async () => {
    const jsonRequest = mock(async () => ({}) as any);
    jsonRequest
      .mockResolvedValueOnce({ code: 200, data: { id: "pred-123", status: "created" } })
      .mockResolvedValueOnce({ code: 200, data: { id: "pred-123", status: "processing" } })
      .mockResolvedValueOnce({ code: 200, data: { id: "pred-123", status: "completed", outputs: ["https://media.example.com/logo.png"] } });
    runtime.jsonRequest = jsonRequest;
    const download = mock(async () => {});
    runtime.downloadImage = download;

    await logo.generateWithAtlas("logo prompt", "logo.png", "1:1", "atlas-key", "atlas/model");

    expect(jsonRequest).toHaveBeenCalledTimes(3);
    expect(jsonRequest.mock.calls[0]).toEqual([
      `${logo.ATLAS_API_BASE}/model/generateImage`,
      "atlas-key",
      { method: "POST", payload: { model: "atlas/model", prompt: "logo prompt", aspect_ratio: "1:1" } },
    ] as any);
    expect(jsonRequest.mock.calls[1]).toEqual([`${logo.ATLAS_API_BASE}/model/prediction/pred-123`, "atlas-key"] as any);
    expect(jsonRequest.mock.calls[2]).toEqual([`${logo.ATLAS_API_BASE}/model/prediction/pred-123`, "atlas-key"] as any);
    expect(runtime.sleep).toHaveBeenCalledTimes(2);
    expect(download.mock.calls).toEqual([["https://media.example.com/logo.png", "logo.png", "image provider"]] as any);
  });

  test("does not retry the generation POST", async () => {
    runtime.jsonRequest = mock(async () => {
      throw new Error("network error");
    });
    await expect(logo.generateWithAtlas("p", "logo.png", "1:1", "atlas-key", "m")).rejects.toThrow("network error");
    expect(runtime.jsonRequest).toHaveBeenCalledTimes(1);
  });

  test("requires an API key", async () => {
    await expect(logo.generateWithAtlas("p", "logo.png", "1:1", null, "m")).rejects.toThrow("ATLASCLOUD_API_KEY not set");
  });
});

describe("media URLs", () => {
  test("downloads never forward the API key", async () => {
    let seen: Headers | undefined;
    runtime.fetch = mock(async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    });
    const output = join(dir, "logo.png");
    await runtime.downloadImage("https://media.example.com/logo.png", output, "image provider");
    expect(await Bun.file(output).bytes()).toEqual(new Uint8Array([1, 2, 3]));
    expect(seen!.has("authorization")).toBe(false);
    expect(seen!.get("accept")).toBe("image/*");
  });

  test("rejects non-image responses and private redirects", async () => {
    runtime.fetch = mock(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    await expect(runtime.downloadImage("https://media.example.com/x", join(dir, "x.png"), "MuAPI")).rejects.toThrow("not an image");
    runtime.fetch = mock(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/x" } }));
    await expect(runtime.downloadImage("https://media.example.com/x", join(dir, "x.png"), "MuAPI")).rejects.toThrow("non-public address");
  });

  test("rejects private addresses and local hostnames", () => {
    expect(() => validatePublicHttpsUrl("https://127.0.0.1/logo.png")).toThrow("non-public address");
    expect(() => validatePublicHttpsUrl("https://[::1]/logo.png")).toThrow("non-public address");
    expect(() => validatePublicHttpsUrl("https://10.1.2.3/logo.png")).toThrow("non-public address");
    expect(() => validatePublicHttpsUrl("https://assets.local/logo.png")).toThrow("local hostname");
    expect(() => validatePublicHttpsUrl("http://media.example.com/logo.png")).toThrow("invalid media URL");
    expect(() => validatePublicHttpsUrl("https://user:pw@media.example.com/x")).toThrow("invalid media URL");
    expect(() => validatePublicHttpsUrl("https://8.8.8.8/logo.png")).not.toThrow();
  });
});

describe("MuAPI", () => {
  test("submits once and polls until completed", async () => {
    const jsonRequest = mock(async () => ({}) as any);
    jsonRequest
      .mockResolvedValueOnce({ id: "req-123", status: "created", output: { urls: { get: "https://api.muapi.ai/api/v1/results/req-123" } } })
      .mockResolvedValueOnce({ id: "req-123", status: "processing" })
      .mockResolvedValueOnce({ id: "req-123", status: "completed", output: { outputs: ["https://media.example.com/logo.png"] } });
    runtime.jsonRequest = jsonRequest;
    const download = mock(async () => {});
    runtime.downloadImage = download;

    await logo.generateWithMuapi("logo prompt", "logo.png", "1:1", "muapi-key", "nano-banana");

    expect(jsonRequest.mock.calls).toEqual([
      [`${logo.MUAPI_API_BASE}/nano-banana`, "muapi-key", { method: "POST", payload: { prompt: "logo prompt", aspect_ratio: "1:1" }, apiKeyHeader: "x-api-key" }],
      ["https://api.muapi.ai/api/v1/results/req-123", "muapi-key", { apiKeyHeader: "x-api-key" }],
      ["https://api.muapi.ai/api/v1/results/req-123", "muapi-key", { apiKeyHeader: "x-api-key" }],
    ] as any);
    expect(runtime.sleep).toHaveBeenCalledTimes(2);
    expect(download.mock.calls).toEqual([["https://media.example.com/logo.png", "logo.png", "MuAPI"]] as any);
  });

  test("does not retry the generation POST", async () => {
    runtime.jsonRequest = mock(async () => {
      throw new Error("network error");
    });
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", "muapi-key", "nano-banana")).rejects.toThrow("network error");
    expect(runtime.jsonRequest).toHaveBeenCalledTimes(1);
  });

  test("requires a key and a known model", async () => {
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", null, "nano-banana")).rejects.toThrow("MUAPI_API_KEY not set");
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", "k", "unknown-model")).rejects.toThrow("Unsupported MuAPI logo model");
  });

  test("uses the x-api-key header", async () => {
    let seen: Headers | undefined;
    runtime.fetch = mock(async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    await original.jsonRequest("https://api.muapi.ai/api/v1/nano-banana", "muapi-key", { method: "POST", payload: { prompt: "logo" }, apiKeyHeader: "x-api-key" });
    expect(seen!.get("x-api-key")).toBe("muapi-key");
    expect(seen!.has("authorization")).toBe(false);
  });

  test("reports a failed prediction", async () => {
    const jsonRequest = mock(async () => ({}) as any);
    jsonRequest
      .mockResolvedValueOnce({ request_id: "req-123", output: { urls: { get: "https://api.muapi.ai/api/v1/results/req-123" } } })
      .mockResolvedValueOnce({ status: "failed", error: "invalid prompt" });
    runtime.jsonRequest = jsonRequest;
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", "k", "nano-banana")).rejects.toThrow("invalid prompt");
  });

  test("requires a valid HTTPS creation result URL", async () => {
    runtime.jsonRequest = mock(async () => ({ request_id: "req-123", status: "created" }));
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", "k", "nano-banana")).rejects.toThrow("valid HTTPS result URL");
    expect(runtime.jsonRequest).toHaveBeenCalledTimes(1);

    runtime.jsonRequest = mock(async () => ({ request_id: "req-123", status: "created", output: { urls: { get: "http://api.muapi.ai/results/req-123" } } }));
    await expect(logo.generateWithMuapi("p", "logo.png", "1:1", "k", "nano-banana")).rejects.toThrow("valid HTTPS result URL");
    expect(runtime.jsonRequest).toHaveBeenCalledTimes(1);
  });
});

describe("Gemini image types", () => {
  beforeEach(() => {
    logo.config.GEMINI_API_KEY = "test-key";
  });

  test("JPEG is saved with a .jpg extension", async () => {
    runtime.geminiGenerateContent = mock(async () => imageResponse("image/jpeg", JPEG));
    const saved = await logo.generateWithGemini("logo prompt", join(dir, "logo.png"), "1:1", true);
    expect(saved).toBe(join(dir, "logo.jpg"));
    expect(await Bun.file(saved).bytes()).toEqual(JPEG);
    expect(await Bun.file(join(dir, "logo.png")).exists()).toBe(false);
  });

  test("a matching extension keeps the requested path", async () => {
    for (const [mime, data, name] of [
      ["image/png", PNG, "logo.png"],
      ["image/jpeg", JPEG, "logo.jpeg"],
      ["image/jpeg", JPEG, "logo.JPG"],
    ] as const) {
      runtime.geminiGenerateContent = mock(async () => imageResponse(mime, data));
      const saved = await logo.generateWithGemini("p", join(dir, name), "1:1", true);
      expect(saved).toBe(join(dir, name));
      expect(await Bun.file(saved).bytes()).toEqual(data);
    }
  });

  test("an unknown image type keeps the requested path", () => {
    expect(pathForImageType("logo.png", "image/heic")).toBe("logo.png");
  });

  test("generateLogo prints and returns the saved path", async () => {
    runtime.geminiGenerateContent = mock(async () => imageResponse("image/jpeg", JPEG));
    const saved = await logo.api.generateLogo({ prompt: "test mark", outputPath: join(dir, "logo.png"), usePro: true });
    expect(saved).toBe(join(dir, "logo.jpg"));
    expect(logs.join("\n")).toContain(`Logo saved to: ${saved}`);
  });

  test("pro requests the configured pro model", async () => {
    const call = mock(async () => imageResponse("image/png", PNG));
    runtime.geminiGenerateContent = call;
    await logo.generateWithGemini("p", join(dir, "logo.png"), "1:1", true);
    expect((call.mock.calls[0] as unknown[])[0]).toBe(logo.geminiModels().pro);
  });

  test("model ids default to GA models and follow the environment", () => {
    const saved = { flash: process.env.GEMINI_FLASH_IMAGE_MODEL, pro: process.env.GEMINI_PRO_IMAGE_MODEL };
    delete process.env.GEMINI_FLASH_IMAGE_MODEL;
    delete process.env.GEMINI_PRO_IMAGE_MODEL;
    expect(logo.geminiModels()).toEqual({ flash: "gemini-2.5-flash-image", pro: "gemini-3-pro-image" });
    process.env.GEMINI_FLASH_IMAGE_MODEL = "flash-next";
    process.env.GEMINI_PRO_IMAGE_MODEL = "pro-next";
    expect(logo.geminiModels()).toEqual({ flash: "flash-next", pro: "pro-next" });
    for (const [key, value] of [["GEMINI_FLASH_IMAGE_MODEL", saved.flash], ["GEMINI_PRO_IMAGE_MODEL", saved.pro]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});

describe("exit status", () => {
  test("a failed single request exits 1", async () => {
    logo.config.GEMINI_API_KEY = "test-key";
    runtime.geminiGenerateContent = mock(async () => {
      throw new Error("429 RESOURCE_EXHAUSTED");
    });
    expect(await logo.main(["--prompt", "test mark", "--output", join(dir, "logo.png")])).toBe(1);
  });

  test("a batch with no logos exits 1", async () => {
    logo.api.generateLogo = mock(async () => null);
    expect(await logo.main(["--brand", "Demo", "--batch", "2", "--output-dir", dir])).toBe(1);
    expect(logo.api.generateLogo).toHaveBeenCalledTimes(2);
  });

  test("a partial batch exits 0", async () => {
    const generate = mock(async () => null as string | null);
    generate.mockResolvedValueOnce(null).mockResolvedValueOnce("demo_modern_02.png");
    logo.api.generateLogo = generate;
    expect(await logo.main(["--brand", "Demo", "--batch", "2", "--output-dir", dir])).toBe(0);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test("--list-styles exits 0 and --pro is rejected for other providers", async () => {
    expect(await logo.main(["--list-styles"])).toBe(0);
    expect(await logo.main(["--brand", "X", "--provider", "muapi", "--pro"])).toBe(2);
  });
});
