import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: string | Buffer | URL, ...args: unknown[]) => {
      if (typeof path === "string" && path.includes("exemplars")) {
        return JSON.stringify({ eng: [] });
      }
      return actual.readFileSync(path, ...(args as []));
    },
  };
});

beforeEach(async () => {
  CONFIG.trivialExemplars = [];
  CONFIG.trivialSimilarityThreshold = 0.85;
  vi.resetModules();
});

function fakeEmbedFixed(_text: string): Promise<Float32Array> {
  return Promise.resolve(new Float32Array([1, 0, 0, 0]));
}

function textDependentEmbed(text: string): Promise<Float32Array> {
  const vec = new Float32Array(4);
  for (let i = 0; i < text.length && i < 4; i++) {
    vec[i % 4] = text.charCodeAt(i) / 255;
  }
  const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return Promise.resolve(mag === 0 ? vec : new Float32Array(vec.map((x) => x / mag)));
}

function orthoEmbed(text: string): Promise<Float32Array> {
  const vec = new Float32Array(4);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  const bits = [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, (h >> 24) & 0xff];
  for (let i = 0; i < 4; i++) {
    vec[i] = bits[i] / 255;
  }
  const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return Promise.resolve(mag === 0 ? vec : new Float32Array(vec.map((x) => x / mag)));
}

describe("triviality", () => {
  it("should treat empty content as trivial", async () => {
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial("  ", fakeEmbedFixed)).toBe(true);
  });

  it("should treat question as trivial", async () => {
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial("How are you?", fakeEmbedFixed)).toBe(true);
  });

  it("should treat short content as trivial", async () => {
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial("Hi", fakeEmbedFixed)).toBe(true);
  });

  it("should treat punctuation-only content as trivial", async () => {
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial(".!?", fakeEmbedFixed)).toBe(true);
  });

  it("should treat content matching an exemplar as trivial", async () => {
    CONFIG.trivialExemplars = ["ok"];
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial("ok", fakeEmbedFixed)).toBe(true);
  });

  it("should treat content NOT matching any exemplar as non-trivial", async () => {
    CONFIG.trivialExemplars = ["ok"];
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    expect(await isTrivial("xkjhfq mnbvzx pqwerty zxcvbn asdfgh", orthoEmbed)).toBe(false);
  });

  it("should handle simultaneous isTrivial calls without throwing", async () => {
    const { isTrivial } = await import("../plugin/dist/text/triviality.js");
    await expect(
      Promise.all([isTrivial("hello world", fakeEmbedFixed), isTrivial("test message", fakeEmbedFixed)]),
    ).resolves.toHaveLength(2);
  });
});
