import { CONFIG } from "../config.js";
import { join } from "node:path";

const CACHE_MAX = 100;
const TIMEOUT_MS = 120000;

class EmbeddingService {
  private pipe: any = null;
  private initPromise: Promise<void> | null = null;
  private cache = new Map<string, Float32Array>();
  private _ready = false;

  get isReady(): boolean {
    return this._ready;
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
      this.pipe = await pipeline("feature-extraction", CONFIG.embeddingModel);
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
    // Ensure model is loaded first (no timeout on warmup — model download can be slow)
    if (!this._ready) await this.warmup();
    return Promise.race([
      this.embed(text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Embedding timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      ),
    ]);
  }

  private async apiEmbed(text: string): Promise<Float32Array> {
    const apiKey = CONFIG.embeddingApiKey;
    if (!apiKey) throw new Error("embeddingApiKey not configured for API-based embedding");
    const response = await fetch("https://api.openai.com/v1/embeddings", {
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
