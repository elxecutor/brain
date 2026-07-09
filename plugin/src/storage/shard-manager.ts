import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG } from "../config.js";
import { type Database, getDatabase, openDatabase } from "./db.js";

const METADATA_DB = "metadata.db";

export interface Shard {
  id: number;
  scope: string;
  scopeHash: string;
  shardIndex: number;
  dbPath: string;
  vectorCount: number;
  isActive: boolean;
  createdAt: number;
}

class ShardManager {
  private metaDb!: Database;
  private metaPath: string;
  private memoryShardIndex = new Map<string, string>();

  recordMemoryLocation(memoryId: string, shardDbPath: string): void {
    this.memoryShardIndex.set(memoryId, shardDbPath);
  }

  removeMemoryLocation(memoryId: string): void {
    this.memoryShardIndex.delete(memoryId);
  }

  findMemoryShard(memoryId: string): string | undefined {
    return this.memoryShardIndex.get(memoryId);
  }

  constructor() {
    this.metaPath = join(CONFIG.storagePath, METADATA_DB);
    this.init();
  }

  private init(): void {
    this.metaDb = openDatabase(this.metaPath);
    this.metaDb.exec(`
      CREATE TABLE IF NOT EXISTS shards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_hash TEXT NOT NULL,
        shard_index INTEGER NOT NULL,
        db_path TEXT NOT NULL,
        vector_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, scope_hash, shard_index)
      )
    `);
    this.metaDb.exec("CREATE INDEX IF NOT EXISTS idx_shards_active ON shards(scope, scope_hash, is_active)");
    this.discoverOrphanedShards();
  }

  private discoverOrphanedShards(): void {
    const scopes = ["projects", "users"];
    for (const scopeDir of scopes) {
      const dirPath = join(CONFIG.storagePath, scopeDir);
      if (!existsSync(dirPath)) continue;
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".db") && !f.endsWith("-shm") && !f.endsWith("-wal"));
      for (const file of files) {
        const match = file.match(/^(\w+)_(\w+)_shard_(\d+)\.db$/);
        if (!match) continue;
        const [, scope, hash, idx] = match;
        const storedPath = `${scopeDir}/${file}`;
        const existing = this.metaDb
          .prepare(`SELECT id FROM shards WHERE scope = ? AND scope_hash = ? AND shard_index = ?`)
          .get(scope, hash, Number(idx));
        if (existing) continue;
        const dbPath = join(CONFIG.storagePath, storedPath);
        let vectorCount = 0;
        try {
          const db = getDatabase(dbPath);
          const row = db.prepare(`SELECT COUNT(*) as cnt FROM memories`).get() as { cnt: number };
          vectorCount = row.cnt;
        } catch {
          vectorCount = 0;
        }
        this.metaDb
          .prepare(
            `INSERT OR IGNORE INTO shards (scope, scope_hash, shard_index, db_path, vector_count, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
          )
          .run(scope, hash, Number(idx), storedPath, vectorCount, Date.now());
      }
    }
  }

  private shardPath(scope: string, hash: string, idx: number): string {
    const dir = join(CONFIG.storagePath, `${scope}s`);
    return join(dir, `${scope}_${hash}_shard_${idx}.db`);
  }

  private resolvePath(stored: string, scope: string): string {
    return join(CONFIG.storagePath, `${scope}s`, basename(stored));
  }

  private readShardMetadata(db: Database): { embeddingModel?: string; embeddingDimensions?: number } {
    const rows = db.prepare(`SELECT key, value FROM shard_metadata`).all() as { key: string; value: string }[];
    const meta: Record<string, string> = {};
    for (const row of rows) {
      meta[row.key] = row.value;
    }
    return {
      embeddingModel: meta.embedding_model,
      embeddingDimensions: meta.embedding_dimensions ? Number(meta.embedding_dimensions) : undefined,
    };
  }

  private ensureSchema(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL DEFAULT 'related',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        strength REAL DEFAULT 0.5,
        UNIQUE(source_id, target_id, link_type)
      )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)");
    try {
      db.exec("ALTER TABLE memories ADD COLUMN stability REAL DEFAULT 1.0");
    } catch {
      /* already exists */
    }
    try {
      db.exec(
        "ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)",
      );
    } catch {
      /* already exists */
    }
    try {
      db.exec("ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'neocortex'");
    } catch {
      /* already exists */
    }
    try {
      db.exec("ALTER TABLE links ADD COLUMN strength REAL DEFAULT 0.5");
    } catch {
      /* already exists */
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        member_ids TEXT NOT NULL,
        avg_strength REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, member_ids)
      )
    `);
  }

  getActiveShard(scope: string, hash: string): Shard | null {
    const row = this.metaDb
      .prepare(
        `SELECT * FROM shards WHERE scope = ? AND scope_hash = ? AND is_active = 1 ORDER BY shard_index DESC LIMIT 1`,
      )
      .get(scope, hash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToShard(row);
  }

  getAllShards(scope: string, hash: string): Shard[] {
    let rows: Record<string, unknown>[];
    if (hash === "") {
      rows = this.metaDb.prepare(`SELECT * FROM shards WHERE scope = ? ORDER BY shard_index ASC`).all(scope) as Record<
        string,
        unknown
      >[];
    } else {
      rows = this.metaDb
        .prepare(`SELECT * FROM shards WHERE scope = ? AND scope_hash = ? ORDER BY shard_index ASC`)
        .all(scope, hash) as Record<string, unknown>[];
    }
    return rows.map((r) => this.rowToShard(r));
  }

  getWriteShard(scope: string, hash: string): Shard {
    const shard = this.getActiveShard(scope, hash);
    if (!shard) return this.createShard(scope, hash, 0);
    if (!existsSync(shard.dbPath)) {
      this.metaDb.prepare(`DELETE FROM shards WHERE id = ?`).run(shard.id);
      return this.createShard(scope, hash, shard.shardIndex);
    }
    if (shard.vectorCount >= CONFIG.maxVectorsPerShard) {
      this.metaDb.prepare(`UPDATE shards SET is_active = 0 WHERE id = ?`).run(shard.id);
      return this.createShard(scope, hash, shard.shardIndex + 1);
    }
    this.ensureSchema(getDatabase(shard.dbPath));
    const meta = this.readShardMetadata(getDatabase(shard.dbPath));
    if (meta.embeddingModel && meta.embeddingModel !== CONFIG.embeddingModel) {
      throw new Error(
        `Shard for scope=${scope} was created with model "${meta.embeddingModel}" ` +
          `but config specifies "${CONFIG.embeddingModel}". Use a different scope or recreate the shard.`,
      );
    }
    if (meta.embeddingDimensions && meta.embeddingDimensions !== CONFIG.embeddingDimensions) {
      throw new Error(
        `Shard for scope=${scope} has ${meta.embeddingDimensions}-dim vectors ` +
          `but config specifies ${CONFIG.embeddingDimensions}. Use a different scope or recreate the shard.`,
      );
    }
    return shard;
  }

  private createShard(scope: string, hash: string, idx: number): Shard {
    const fullPath = this.shardPath(scope, hash, idx);
    const stored = join(`${scope}s`, basename(fullPath)).replace(/\\/g, "/");
    const now = Date.now();
    this.metaDb
      .prepare(
        `INSERT INTO shards (scope, scope_hash, shard_index, db_path, vector_count, is_active, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)`,
      )
      .run(scope, hash, idx, stored, now);

    const db = openDatabase(fullPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS shard_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        tags_vector BLOB,
        container_tag TEXT NOT NULL,
        tags TEXT,
        type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        display_name TEXT,
        user_name TEXT,
        user_email TEXT,
        project_path TEXT,
        project_name TEXT,
        git_repo_url TEXT,
        is_pinned INTEGER DEFAULT 0,
        stability REAL DEFAULT 1.0,
        last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        tier TEXT DEFAULT 'neocortex'
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL DEFAULT 'related',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        strength REAL DEFAULT 0.5,
        UNIQUE(source_id, target_id, link_type)
      )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_container_tag ON memories(container_tag)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_created_at ON memories(created_at DESC)");
    db.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        member_ids TEXT NOT NULL,
        avg_strength REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, member_ids)
      )
    `);
    db.prepare(`INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)`).run(
      "embedding_dimensions",
      String(CONFIG.embeddingDimensions),
    );
    db.prepare(`INSERT OR REPLACE INTO shard_metadata (key, value) VALUES (?, ?)`).run(
      "embedding_model",
      CONFIG.embeddingModel,
    );

    return {
      id: Number((this.metaDb.prepare(`SELECT last_insert_rowid() as id`).get() as Record<string, unknown>).id),
      scope,
      scopeHash: hash,
      shardIndex: idx,
      dbPath: fullPath,
      vectorCount: 0,
      isActive: true,
      createdAt: now,
    };
  }

  incrementCount(shardId: number): void {
    this.metaDb.prepare(`UPDATE shards SET vector_count = vector_count + 1 WHERE id = ?`).run(shardId);
  }

  decrementCount(shardId: number): void {
    this.metaDb
      .prepare(`UPDATE shards SET vector_count = vector_count - 1 WHERE id = ? AND vector_count > 0`)
      .run(shardId);
  }

  getShardByDbPath(dbPath: string): Shard | null {
    const fileName = basename(dbPath);
    const row = this.metaDb.prepare(`SELECT * FROM shards WHERE db_path LIKE '%' || ?`).get(fileName) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToShard(row) : null;
  }

  private rowToShard(r: Record<string, unknown>): Shard {
    return {
      id: r.id as number,
      scope: r.scope as string,
      scopeHash: r.scope_hash as string,
      shardIndex: r.shard_index as number,
      dbPath: this.resolvePath(r.db_path as string, r.scope as string),
      vectorCount: r.vector_count as number,
      isActive: (r.is_active as number) === 1,
      createdAt: r.created_at as number,
    };
  }

  close(): void {
    (this.metaDb as any).close?.();
  }
}

export const shardManager = new ShardManager();
