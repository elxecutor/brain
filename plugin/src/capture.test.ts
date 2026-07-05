import { describe, expect, it } from "vitest";
import { CONFIG } from "./config.js";

describe("capture", () => {
  it("should not capture when autoCaptureEnabled is false", async () => {
    const original = CONFIG.autoCaptureEnabled;
    CONFIG.autoCaptureEnabled = false;
    const { captureChatMessage } = await import("./capture.js");
    const result = await captureChatMessage("some content", "/tmp", "test");
    expect(result).toBeNull();
    CONFIG.autoCaptureEnabled = original;
  });

  it("should skip content shorter than 10 chars", async () => {
    const original = CONFIG.autoCaptureEnabled;
    CONFIG.autoCaptureEnabled = true;
    const { captureChatMessage } = await import("./capture.js");
    const result = await captureChatMessage("Hi", "/tmp", "test");
    expect(result).toBeNull();
    CONFIG.autoCaptureEnabled = original;
  });
});
