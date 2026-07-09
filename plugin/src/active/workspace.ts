import { CONFIG } from "../config.js";

export interface WorkspaceEntry {
  memoryId: string;
  content: string;
  addedAt: number;
}

const DEFAULT_CAPACITY = 5;

class WorkspaceManager {
  private sessions = new Map<string, WorkspaceEntry[]>();
  private capacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  get(sessionId: string): WorkspaceEntry[] {
    return this.sessions.get(sessionId) ?? [];
  }

  add(sessionId: string, entry: WorkspaceEntry): { evicted?: WorkspaceEntry } {
    const entries = this.sessions.get(sessionId) ?? [];
    const existing = entries.find((e) => e.memoryId === entry.memoryId);
    if (existing) {
      existing.addedAt = entry.addedAt;
      return {};
    }
    entries.push(entry);
    let evicted: WorkspaceEntry | undefined;
    if (entries.length > this.capacity) {
      entries.sort((a, b) => a.addedAt - b.addedAt);
      evicted = entries.shift();
    }
    this.sessions.set(sessionId, entries);
    return { evicted };
  }

  remove(sessionId: string, memoryId: string): boolean {
    const entries = this.sessions.get(sessionId);
    if (!entries) return false;
    const idx = entries.findIndex((e) => e.memoryId === memoryId);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    if (entries.length === 0) {
      this.sessions.delete(sessionId);
    }
    return true;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export const workspaceManager = new WorkspaceManager();
