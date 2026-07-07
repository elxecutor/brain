import { describe, expect, it } from "vitest";

function normalize(v: Float32Array): Float32Array {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : new Float32Array(v.map((x) => x / mag));
}

function fakeEmbed(text: string): Promise<Float32Array> {
  const vec = new Float32Array(4);
  for (let i = 0; i < text.length && i < 4; i++) {
    vec[i % 4] = text.charCodeAt(i) / 255;
  }
  return Promise.resolve(normalize(vec));
}

function splitEmbed(text: string): Promise<Float32Array> {
  const first = text.trim().charAt(0);
  if (first === "A" || first === "a") {
    return Promise.resolve(new Float32Array([1, 0, 0, 0]));
  }
  return Promise.resolve(new Float32Array([0, 0, 0, 1]));
}

describe("chunk", () => {
  it("should return single chunk for content shorter than chunkMaxChars", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent("short content", fakeEmbed);
    expect(result).toEqual(["short content"]);
  });

  it("should return single chunk for single-sentence content", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent(
      "This is a single sentence that is long enough to test but still just one sentence.",
      fakeEmbed,
    );
    expect(result).toHaveLength(1);
  });

  it("should return empty input as a single chunk", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent("", fakeEmbed);
    expect(result).toEqual([""]);
  });

  it("should preserve all input characters (no silent content loss)", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const input =
      "Short. Also short. Together they are longer. This ensures no loss when merging short fragments under minChunk.";
    const result = await chunkContent(input, fakeEmbed);
    const combined = result.join(" ");
    for (const word of input.split(" ")) {
      expect(combined).toContain(word);
    }
  });

  it("should handle whitespace-only content", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent("   ", fakeEmbed);
    expect(result).toEqual([""]);
  });

  it("should keep coherent sentences together in one chunk", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent(
      "Alpha test sentence one. Alpha test sentence two. Alpha test sentence three.",
      fakeEmbed,
    );
    expect(result).toHaveLength(1);
  });

  it("should split when coherence drops across sentences", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const result = await chunkContent(
      "Alpha first sentence goes here and it is quite long to ensure we exceed the threshold. " +
        "Alpha second sentence is also long enough to push us past the maximum chunk size limit. " +
        "Zzzz completely different topic starts here and continues for a while to be long enough. " +
        "Zzzz another unrelated sentence also needs to be long enough to exceed the threshold.",
      splitEmbed,
    );
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should append short trailing chunk to previous instead of dropping", async () => {
    const { chunkContent } = await import("../plugin/dist/text/chunk.js");
    const input =
      "First substantial chunk of text that is long enough to pass minimum. Second substantial chunk of text that is also long enough to pass minimum. End.";
    const result = await chunkContent(input, fakeEmbed);
    const combined = result.join(" ");
    for (const word of input.split(" ")) {
      expect(combined).toContain(word);
    }
  });
});
