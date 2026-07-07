import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_DIR = join(homedir(), ".brain");
const LOG_FILE = join(LOG_DIR, "brain.log");

let logFd: number | null = null;

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (logFd === null) {
      ensureLogDir();
      logFd = 1;
    }
    appendFileSync(LOG_FILE, line, { flag: "a" });
  } catch {
    /* best-effort */
  }
}

export function logError(msg: string): void {
  log(`ERROR: ${msg}`);
}
