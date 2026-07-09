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

interface HumanMemoryModelConfig {
  enabled: boolean;
  initialStability: number;
  decayExponent: number;
  retrievabilityFactor: number;
  growthFactor: number;
  pruneRetrievabilityFloor: number;
  consolidationIntervalHours: number;
  consolidation: {
    pruneRetrievabilityFloor: number;
    mergeSimilarityThreshold: number;
    pruneLinkStrengthFloor: number;
    intervalHours: number;
  };
}

interface BackgroundProcessingConfig {
  enabled: boolean;
  maxQueueSize: number;
  taskTimeoutMs: number;
}

interface SynthesisConfig {
  enabled: boolean;
  maxSynthesizedFacts: number;
  provider?: string;
  model?: string;
  apiUrl?: string;
  apiKey?: string;
  temperature?: number;
  prompt?: string;
}

interface HebbianLearningConfig {
  enabled: boolean;
  coActivationDelta: number;
}

interface HippocampusConfig {
  enabled: boolean;
  capacity: number;
  ttlDays: number;
  initialStability: number;
}

export interface PluginConfig {
  storagePath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  similarityThreshold: number;
  maxMemories: number;
  language?: string;
  /** @deprecated Use language instead */
  autoCaptureLanguage?: string;
  defaultLanguage?: string;
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
  humanMemoryModel: HumanMemoryModelConfig;
  backgroundProcessing: BackgroundProcessingConfig;
  synthesis: SynthesisConfig;
  hebbianLearning: HebbianLearningConfig;
  hippocampus: HippocampusConfig;
  compaction: CompactionConfig;
  chatMessage: ChatMessageConfig;
}

const DEFAULTS: PluginConfig = {
  storagePath: DATA_DIR,
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  similarityThreshold: 0.6,
  maxMemories: 10,
  defaultLanguage: undefined,
  vectorBackend: "usearch-first",
  webServerEnabled: false,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  maxVectorsPerShard: 50000,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  deduplicationEnabled: true,
  deduplicationSimilarityThreshold: 0.75,
  userProfileAnalysisInterval: 10,
  containerTagPrefix: "opencode",
  showErrorToasts: true,
  defaultLinkType: "related",
  maxTraversalDepth: 3,
  autoLinkEnabled: true,
  autoLinkMaxConnections: 3,
  autoLinkSimilarityThreshold: 0.5,
  humanMemoryModel: {
    enabled: false,
    initialStability: 1.0,
    decayExponent: -0.5,
    retrievabilityFactor: 0.9,
    growthFactor: 0.3,
    pruneRetrievabilityFloor: 0.05,
    consolidationIntervalHours: 24,
    consolidation: {
      pruneRetrievabilityFloor: 0.05,
      mergeSimilarityThreshold: 0.95,
      pruneLinkStrengthFloor: 0.1,
      intervalHours: 24,
    },
  },
  backgroundProcessing: {
    enabled: true,
    maxQueueSize: 50,
    taskTimeoutMs: 30000,
  },
  synthesis: {
    enabled: false,
    maxSynthesizedFacts: 3,
    temperature: 0.5,
    prompt: "Synthesize the following related pieces of information into a concise, coherent summary. Capture the key insights and relationships.",
  },
  hebbianLearning: {
    enabled: true,
    coActivationDelta: 0.05,
  },
  hippocampus: {
    enabled: false,
    capacity: 100,
    ttlDays: 7,
    initialStability: 0.3,
  },
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
    language: fileConfig.language ?? fileConfig.autoCaptureLanguage,
    defaultLanguage: fileConfig.defaultLanguage,
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
    humanMemoryModel: {
      enabled: fileConfig.humanMemoryModel?.enabled ?? DEFAULTS.humanMemoryModel.enabled,
      initialStability: fileConfig.humanMemoryModel?.initialStability ?? DEFAULTS.humanMemoryModel.initialStability,
      decayExponent: fileConfig.humanMemoryModel?.decayExponent ?? DEFAULTS.humanMemoryModel.decayExponent,
      retrievabilityFactor:
        fileConfig.humanMemoryModel?.retrievabilityFactor ?? DEFAULTS.humanMemoryModel.retrievabilityFactor,
      growthFactor: fileConfig.humanMemoryModel?.growthFactor ?? DEFAULTS.humanMemoryModel.growthFactor,
      pruneRetrievabilityFloor:
        fileConfig.humanMemoryModel?.pruneRetrievabilityFloor ?? DEFAULTS.humanMemoryModel.pruneRetrievabilityFloor,
      consolidationIntervalHours:
        fileConfig.humanMemoryModel?.consolidationIntervalHours ?? DEFAULTS.humanMemoryModel.consolidationIntervalHours,
      consolidation: {
        pruneRetrievabilityFloor:
          fileConfig.humanMemoryModel?.consolidation?.pruneRetrievabilityFloor ??
          DEFAULTS.humanMemoryModel.consolidation.pruneRetrievabilityFloor,
        mergeSimilarityThreshold:
          fileConfig.humanMemoryModel?.consolidation?.mergeSimilarityThreshold ??
          DEFAULTS.humanMemoryModel.consolidation.mergeSimilarityThreshold,
        pruneLinkStrengthFloor:
          fileConfig.humanMemoryModel?.consolidation?.pruneLinkStrengthFloor ??
          DEFAULTS.humanMemoryModel.consolidation.pruneLinkStrengthFloor,
        intervalHours:
          fileConfig.humanMemoryModel?.consolidation?.intervalHours ??
          DEFAULTS.humanMemoryModel.consolidation.intervalHours,
      },
    },
    backgroundProcessing: {
      enabled: fileConfig.backgroundProcessing?.enabled ?? DEFAULTS.backgroundProcessing.enabled,
      maxQueueSize: fileConfig.backgroundProcessing?.maxQueueSize ?? DEFAULTS.backgroundProcessing.maxQueueSize,
      taskTimeoutMs: fileConfig.backgroundProcessing?.taskTimeoutMs ?? DEFAULTS.backgroundProcessing.taskTimeoutMs,
    },
    synthesis: {
      enabled: fileConfig.synthesis?.enabled ?? DEFAULTS.synthesis.enabled,
      maxSynthesizedFacts: fileConfig.synthesis?.maxSynthesizedFacts ?? DEFAULTS.synthesis.maxSynthesizedFacts,
      provider: fileConfig.synthesis?.provider ?? DEFAULTS.synthesis.provider,
      model: fileConfig.synthesis?.model ?? DEFAULTS.synthesis.model,
      apiUrl: fileConfig.synthesis?.apiUrl ?? DEFAULTS.synthesis.apiUrl,
      apiKey: fileConfig.synthesis?.apiKey ?? DEFAULTS.synthesis.apiKey,
      temperature: fileConfig.synthesis?.temperature ?? DEFAULTS.synthesis.temperature,
      prompt: fileConfig.synthesis?.prompt ?? DEFAULTS.synthesis.prompt,
    },
    hebbianLearning: {
      enabled: fileConfig.hebbianLearning?.enabled ?? DEFAULTS.hebbianLearning.enabled,
      coActivationDelta: fileConfig.hebbianLearning?.coActivationDelta ?? DEFAULTS.hebbianLearning.coActivationDelta,
    },
    hippocampus: {
      enabled: fileConfig.hippocampus?.enabled ?? DEFAULTS.hippocampus.enabled,
      capacity: fileConfig.hippocampus?.capacity ?? DEFAULTS.hippocampus.capacity,
      ttlDays: fileConfig.hippocampus?.ttlDays ?? DEFAULTS.hippocampus.ttlDays,
      initialStability: fileConfig.hippocampus?.initialStability ?? DEFAULTS.hippocampus.initialStability,
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
