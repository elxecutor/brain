import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

describe("background queue", () => {
  beforeEach(() => {
    CONFIG.backgroundProcessing.maxQueueSize = 50;
    CONFIG.backgroundProcessing.taskTimeoutMs = 5000;
  });

  it("should process tasks in order", async () => {
    const { backgroundQueue } = await import("../plugin/dist/background.js");
    const order: number[] = [];
    const done = new Promise<void>((resolve) => {
      let count = 0;
      const check = () => {
        if (++count === 2) resolve();
      };
      backgroundQueue.enqueue(async () => {
        order.push(1);
        check();
      });
      backgroundQueue.enqueue(async () => {
        order.push(2);
        check();
      });
    });
    await done;
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([1, 2]);
  });

  it("should drop tasks when queue is full", async () => {
    CONFIG.backgroundProcessing.maxQueueSize = 1;
    const { backgroundQueue } = await import("../plugin/dist/background.js");
    const before = backgroundQueue.droppedTasks;
    backgroundQueue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    backgroundQueue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    backgroundQueue.enqueue(async () => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(backgroundQueue.droppedTasks - before).toBe(1);
  });

  it("should handle task errors gracefully", async () => {
    const { backgroundQueue } = await import("../plugin/dist/background.js");
    const results: string[] = [];
    const done = new Promise<void>((resolve) => {
      backgroundQueue.enqueue(async () => {
        throw new Error("fail");
      });
      backgroundQueue.enqueue(async () => {
        results.push("after-error");
        resolve();
      });
    });
    await done;
    await new Promise((r) => setTimeout(r, 50));
    expect(results).toContain("after-error");
  });
});
