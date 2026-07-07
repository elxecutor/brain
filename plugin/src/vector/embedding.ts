import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { log } from "../logger.js";

const CACHE_MAX = 100;
const TIMEOUT_MS = 120000;

function resolveLocalModel(model: string): string {
  const hfDir = `models--${model.replace("/", "--")}`;
  const cacheDir = join(homedir(), ".brain", ".model-cache", hfDir, "snapshots", "main");
  return existsSync(cacheDir) ? cacheDir : model;
}

class EmbeddingService {
  private pipe: any = null;
  private initPromise: Promise<void> | null = null;
  private cache = new Map<string, Float32Array>();
  private _ready = false;
  private _detectedDimensions: number | null = null;

  get isReady(): boolean {
    return this._ready;
  }

  getDetectedDimensions(): number | null {
    return this._detectedDimensions;
  }

  async warmup(): Promise<void> {
    if (this._ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.loadModel();
    return this.initPromise;
  }

  private async loadModel(): Promise<void> {
    try {
      if (CONFIG.embeddingModel.startsWith("text-embedding")) {
        this._ready = true;
        return;
      }
      const { pipeline } = await import("@huggingface/transformers");
      const resolved = resolveLocalModel(CONFIG.embeddingModel);
      this.pipe = await pipeline("feature-extraction", resolved);
      const calibrationOutput = await this.pipe("calibration", { pooling: "mean", normalize: true });
      const detectedDims = new Float32Array(calibrationOutput.data).length;
      this._detectedDimensions = detectedDims;
      if (detectedDims !== CONFIG.embeddingDimensions) {
        log(
          `auto-detected ${detectedDims} embedding dimensions (config said ${CONFIG.embeddingDimensions}), updating`,
        );
        CONFIG.embeddingDimensions = detectedDims;
      }
      this._ready = true;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    if (!this._ready) await this.warmup();

    let result: Float32Array;
    if (CONFIG.embeddingModel.startsWith("text-embedding") || CONFIG.embeddingModel.includes("text-embedding")) {
      result = await this.apiEmbed(text);
    } else {
      const output = await this.pipe(text, { pooling: "mean", normalize: true });
      result = new Float32Array(output.data);
    }

    if (this.cache.size >= CACHE_MAX) {
      const key = this.cache.keys().next().value;
      if (key !== undefined) this.cache.delete(key);
    }
    this.cache.set(text, result);
    return result;
  }

  async embedWithTimeout(text: string): Promise<Float32Array> {
    if (!this._ready) await this.warmup();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.embed(text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Embedding timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async apiEmbed(text: string): Promise<Float32Array> {
    const apiKey = CONFIG.embeddingApiKey;
    if (!apiKey) throw new Error("embeddingApiKey not configured for API-based embedding");
    const baseUrl = CONFIG.memoryApiUrl || "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text, model: CONFIG.embeddingModel }),
    });
    if (!response.ok) throw new Error(`API embedding failed: ${response.statusText}`);
    const data = (await response.json()) as any;
    return new Float32Array(data.data[0].embedding);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const embeddingService = new EmbeddingService();
