import type Database from 'better-sqlite3';

export function getDatabaseStats(db: Database.Database, dbPath: string) {
  const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
  const keywordCount = (db.prepare('SELECT COUNT(*) as c FROM keywords').get() as any).c;
  const uniqueKeywords = (db.prepare('SELECT COUNT(DISTINCT keyword) as c FROM keywords').get() as any).c;
  const oldest = db.prepare('SELECT created_at FROM memories ORDER BY created_at ASC LIMIT 1').get() as any;
  const newest = db.prepare('SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1').get() as any;
  const topKeywords = db.prepare(`SELECT keyword, COUNT(*) as count FROM keywords GROUP BY keyword ORDER BY count DESC LIMIT 10`).all();
  let size = 0; try { size = require('fs').statSync(dbPath).size; } catch {}
  return {
    total_memories: memoryCount,
    total_keywords: keywordCount,
    unique_keywords: uniqueKeywords,
    oldest_memory: oldest?.created_at || null,
    newest_memory: newest?.created_at || null,
    top_keywords: topKeywords,
    database_path: dbPath,
    database_size_bytes: size
  };
}

export function exportAllMemories(db: Database.Database) {
  const rows = db.prepare(`
    SELECT m.*, GROUP_CONCAT(k.keyword, ', ') as kws
    FROM memories m LEFT JOIN keywords k ON m.id = k.memory_id
    GROUP BY m.id ORDER BY m.created_at DESC`).all() as any[];
  return {
    export_timestamp: new Date().toISOString(),
    total_memories: rows.length,
    memories: rows.map(r => ({ ...r, keywords: r.kws ? r.kws.split(', ') : [] }))
  };
}

export function getSchema(db: Database.Database): string {
  const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','trigger','index','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as { sql: string }[];
  return schema.map(s => s.sql).join(';\n\n') + ';';
}
