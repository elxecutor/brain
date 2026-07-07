import { CONFIG } from "./config.js";
import { logError } from "./logger.js";

type Task = () => Promise<void>;

class BackgroundQueue {
  private queue: Task[] = [];
  private processing = false;
  private droppedCount = 0;

  get droppedTasks(): number {
    return this.droppedCount;
  }

  enqueue(task: Task): void {
    if (this.queue.length >= CONFIG.backgroundProcessing.maxQueueSize) {
      this.droppedCount++;
      return;
    }
    this.queue.push(task);
    if (!this.processing) {
      this.processing = true;
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await Promise.race([
          task(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Background task timed out")), CONFIG.backgroundProcessing.taskTimeoutMs),
          ),
        ]);
      } catch (err) {
        logError(`background task: ${err}`);
      }
    }
    this.processing = false;
  }
}

export const backgroundQueue = new BackgroundQueue();
