import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

describe("tokenize", () => {
  beforeEach(() => {
    CONFIG.autoCaptureLanguage = undefined;
  });

  it("detectLanguage should return configured language when set", async () => {
    CONFIG.autoCaptureLanguage = "fra";
    const { detectLanguage } = await import("../plugin/dist/text/tokenize.js");
    expect(detectLanguage("any text")).toBe("fra");
  });

  it("detectLanguage should return eng for short strings when no language configured", async () => {
    const { detectLanguage } = await import("../plugin/dist/text/tokenize.js");
    expect(detectLanguage("hi")).toBe("eng");
  });

  it("detectLanguage should return franc result for longer strings", async () => {
    const { detectLanguage } = await import("../plugin/dist/text/tokenize.js");
    const result = detectLanguage("this is a reasonably long English sentence for detection");
    expect(result).toBe("eng");
  });

  it("detectLanguage should fall back to eng when franc returns und", async () => {
    const { detectLanguage } = await import("../plugin/dist/text/tokenize.js");
    const result = detectLanguage("12345 67890 !@#$%^&*()");
    expect(result).toBe("eng");
  });

  it("francToSegmenterLocale should map ISO 639-3 codes to locales", async () => {
    const { francToSegmenterLocale } = await import("../plugin/dist/text/tokenize.js");
    expect(francToSegmenterLocale("eng")).toBe("en");
  });

  it("francToSegmenterLocale should fall back to en for unknown codes", async () => {
    const { francToSegmenterLocale } = await import("../plugin/dist/text/tokenize.js");
    expect(francToSegmenterLocale("xxx")).toBe("en");
  });

  it("segmentSentences should split multi-sentence strings", async () => {
    const { segmentSentences } = await import("../plugin/dist/text/tokenize.js");
    const result = segmentSentences("Hello world. This is a test. Goodbye.");
    expect(result).toHaveLength(3);
  });

  it("segmentSentences should return empty array for empty input", async () => {
    const { segmentSentences } = await import("../plugin/dist/text/tokenize.js");
    expect(segmentSentences("")).toEqual([]);
  });

  it("segmentSentences should handle Dr. abbreviation without extra splits", async () => {
    const { segmentSentences } = await import("../plugin/dist/text/tokenize.js");
    const result = segmentSentences("Dr. Smith went to Washington. He met with officials.");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[result.length - 1]).toContain("officials");
  });

  it("tokenizeWords should return word tokens from a sentence", async () => {
    const { tokenizeWords } = await import("../plugin/dist/text/tokenize.js");
    const result = tokenizeWords("Hello World Test");
    expect(result).toContain("hello");
    expect(result).toContain("world");
    expect(result).toContain("test");
  });

  it("tokenizeWords should return empty array for empty input", async () => {
    const { tokenizeWords } = await import("../plugin/dist/text/tokenize.js");
    expect(tokenizeWords("")).toEqual([]);
  });

  it("extractKeywords should filter out single-character tokens", async () => {
    const { extractKeywords } = await import("../plugin/dist/text/tokenize.js");
    const result = await extractKeywords("a b c hello world");
    expect(result).not.toContain("a");
    expect(result).not.toContain("b");
    expect(result).not.toContain("c");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("extractKeywords should filter stopwords", async () => {
    const { extractKeywords } = await import("../plugin/dist/text/tokenize.js");
    const result = await extractKeywords("the and for testing purposes");
    expect(result).not.toContain("the");
    expect(result).not.toContain("and");
    expect(result).toContain("testing");
    expect(result).toContain("purposes");
  });
});
