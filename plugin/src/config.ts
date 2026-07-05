import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const DATA_DIR = join(homedir(), ".brain", "data");

const CONFIG_FILES = [join(CONFIG_DIR, "brain.jsonc"), join(CONFIG_DIR, "brain.json")];

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function stripJsoncComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function expandPath(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

interface ChatMessageConfig {
  enabled: boolean;
  maxMemories: number;
  excludeCurrentSession: boolean;
  maxAgeDays?: number;
  injectOn: "first" | "always";
}

interface CompactionConfig {
  enabled: boolean;
  memoryLimit: number;
}

interface MemoryConfig {
  defaultScope: "project" | "all-projects";
}

export interface PluginConfig {
  storagePath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  similarityThreshold: number;
  maxMemories: number;
  autoCaptureEnabled: boolean;
  autoCaptureLanguage?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  embeddingApiKey?: string;
  opencodeProvider?: string;
  opencodeModel?: string;
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number;
  memoryExtraParams?: Record<string, unknown>;
  vectorBackend: "usearch-first" | "exact-scan" | "usearch";
  webServerEnabled: boolean;
  webServerPort: number;
  webServerHost: string;
  maxVectorsPerShard: number;
  autoCleanupEnabled: boolean;
  autoCleanupRetentionDays: number;
  deduplicationEnabled: boolean;
  deduplicationSimilarityThreshold: number;
  userProfileAnalysisInterval: number;
  containerTagPrefix: string;
  showErrorToasts: boolean;
  defaultLinkType: string;
  maxTraversalDepth: number;
  autoLinkEnabled: boolean;
  autoLinkMaxConnections: number;
  autoLinkSimilarityThreshold: number;
  chunkMinChars: number;
  chunkMaxChars: number;
  chunkCoherenceThreshold: number;
  trivialSimilarityThreshold: number;
  trivialExemplars: string[];
  memory: MemoryConfig;
  compaction: CompactionConfig;
  chatMessage: ChatMessageConfig;
}

const DEFAULTS: PluginConfig = {
  storagePath: DATA_DIR,
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  similarityThreshold: 0.6,
  maxMemories: 10,
  autoCaptureEnabled: false,
  vectorBackend: "usearch-first",
  webServerEnabled: false,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  maxVectorsPerShard: 50000,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  deduplicationEnabled: true,
  deduplicationSimilarityThreshold: 0.9,
  userProfileAnalysisInterval: 10,
  containerTagPrefix: "opencode",
  showErrorToasts: true,
  defaultLinkType: "related",
  maxTraversalDepth: 3,
  autoLinkEnabled: true,
  autoLinkMaxConnections: 3,
  autoLinkSimilarityThreshold: 0.5,
  chunkMinChars: 30,
  chunkMaxChars: 300,
  chunkCoherenceThreshold: 0.7,
  trivialSimilarityThreshold: 0.85,
  trivialExemplars: [],
  memory: { defaultScope: "project" },
  compaction: { enabled: true, memoryLimit: 10 },
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    injectOn: "first",
  },
};

function getEmbeddingDimensions(model: string): number {
  const map: Record<string, number> = {
    "Xenova/nomic-embed-text-v1": 768,
    "Xenova/all-MiniLM-L6-v2": 384,
    "Xenova/all-mpnet-base-v2": 768,
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
  };
  return map[model] || 768;
}

function loadConfigFromPaths(paths: string[]): Partial<PluginConfig> {
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        return JSON.parse(stripJsoncComments(content));
      } catch {
        /* skip */
      }
    }
  }
  return {};
}

function buildConfig(fileConfig: Partial<PluginConfig>): PluginConfig {
  return {
    storagePath: expandPath(String(fileConfig.storagePath ?? DEFAULTS.storagePath)),
    embeddingModel: fileConfig.embeddingModel ?? DEFAULTS.embeddingModel,
    embeddingDimensions:
      fileConfig.embeddingDimensions ?? getEmbeddingDimensions(fileConfig.embeddingModel ?? DEFAULTS.embeddingModel),
    similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
    maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? DEFAULTS.autoCaptureEnabled,
    autoCaptureLanguage: fileConfig.autoCaptureLanguage,
    userEmailOverride: fileConfig.userEmailOverride,
    userNameOverride: fileConfig.userNameOverride,
    embeddingApiKey: fileConfig.embeddingApiKey,
    opencodeProvider: fileConfig.opencodeProvider,
    opencodeModel: fileConfig.opencodeModel,
    memoryProvider: fileConfig.memoryProvider,
    memoryModel: fileConfig.memoryModel,
    memoryApiUrl: fileConfig.memoryApiUrl,
    memoryApiKey: fileConfig.memoryApiKey,
    memoryTemperature: fileConfig.memoryTemperature,
    memoryExtraParams: fileConfig.memoryExtraParams,
    vectorBackend: (fileConfig.vectorBackend ?? "usearch-first") as PluginConfig["vectorBackend"],
    webServerEnabled: fileConfig.webServerEnabled ?? DEFAULTS.webServerEnabled,
    webServerPort: fileConfig.webServerPort ?? DEFAULTS.webServerPort,
    webServerHost: fileConfig.webServerHost ?? DEFAULTS.webServerHost,
    maxVectorsPerShard: fileConfig.maxVectorsPerShard ?? DEFAULTS.maxVectorsPerShard,
    autoCleanupEnabled: fileConfig.autoCleanupEnabled ?? DEFAULTS.autoCleanupEnabled,
    autoCleanupRetentionDays: fileConfig.autoCleanupRetentionDays ?? DEFAULTS.autoCleanupRetentionDays,
    deduplicationEnabled: fileConfig.deduplicationEnabled ?? DEFAULTS.deduplicationEnabled,
    deduplicationSimilarityThreshold:
      fileConfig.deduplicationSimilarityThreshold ?? DEFAULTS.deduplicationSimilarityThreshold,
    userProfileAnalysisInterval: fileConfig.userProfileAnalysisInterval ?? DEFAULTS.userProfileAnalysisInterval,
    containerTagPrefix: fileConfig.containerTagPrefix ?? DEFAULTS.containerTagPrefix,
    showErrorToasts: fileConfig.showErrorToasts ?? DEFAULTS.showErrorToasts,
    defaultLinkType: fileConfig.defaultLinkType ?? DEFAULTS.defaultLinkType,
    maxTraversalDepth: fileConfig.maxTraversalDepth ?? DEFAULTS.maxTraversalDepth,
    autoLinkEnabled: fileConfig.autoLinkEnabled ?? DEFAULTS.autoLinkEnabled,
    autoLinkMaxConnections: fileConfig.autoLinkMaxConnections ?? DEFAULTS.autoLinkMaxConnections,
    autoLinkSimilarityThreshold: fileConfig.autoLinkSimilarityThreshold ?? DEFAULTS.autoLinkSimilarityThreshold,
    chunkMinChars: fileConfig.chunkMinChars ?? DEFAULTS.chunkMinChars,
    chunkMaxChars: fileConfig.chunkMaxChars ?? DEFAULTS.chunkMaxChars,
    chunkCoherenceThreshold: fileConfig.chunkCoherenceThreshold ?? DEFAULTS.chunkCoherenceThreshold,
    trivialSimilarityThreshold: fileConfig.trivialSimilarityThreshold ?? DEFAULTS.trivialSimilarityThreshold,
    trivialExemplars: fileConfig.trivialExemplars ?? DEFAULTS.trivialExemplars,
    memory: {
      defaultScope: (fileConfig.memory?.defaultScope ?? "project") as "project" | "all-projects",
    },
    compaction: {
      enabled: fileConfig.compaction?.enabled ?? DEFAULTS.compaction.enabled,
      memoryLimit: fileConfig.compaction?.memoryLimit ?? DEFAULTS.compaction.memoryLimit,
    },
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ?? DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? "first") as "first" | "always",
    },
  };
}

const _globalFileConfig = loadConfigFromPaths(CONFIG_FILES);
export let CONFIG: PluginConfig = buildConfig(_globalFileConfig);

export function initConfig(directory: string): void {
  const projectPaths = [join(directory, ".opencode", "brain.jsonc"), join(directory, ".opencode", "brain.json")];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);
  const merged = { ...globalConfig, ...projectConfig };
  CONFIG = buildConfig(merged);
}
