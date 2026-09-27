import { describe, expect, it } from "vitest";
import { recallQuery } from "../plugin/dist/recall.js";

describe("recall query", () => {
  it("includes assistant identity for name questions", () => {
    expect(recallQuery("who are you?")).toContain("assistant name identity user preferences");
    expect(recallQuery("what should I call you?")).toContain("assistant name identity user preferences");
  });

  it("leaves unrelated requests unchanged", () => {
    expect(recallQuery("How do ESP32 OTA updates work?")).toBe("How do ESP32 OTA updates work?");
  });
});
