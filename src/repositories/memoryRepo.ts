import type Database from 'better-sqlite3';
import type { Memory } from '../schemas.js';

export class MemoryRepository {
  constructor(private db: Database.Database) {}

  insert(file_path: string, summary: string, keywords: string[]): number {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(
        'INSERT INTO memories (file_path, summary) VALUES (?, ?) RETURNING id'
      ).get(file_path, summary) as { id: number };
      const id = row.id;
      if (keywords.length) {
        const insert = this.db.prepare('INSERT INTO keywords (memory_id, keyword) VALUES (?, ?)');
        for (const k of keywords) insert.run(id, k);
      }
      return id;
    });
    return tx();
  }

  update(id: number, summary?: string, keywords?: string[]) : boolean {
    const tx = this.db.transaction(() => {
      if (summary) {
        this.db.prepare('UPDATE memories SET summary = ?, created_at=CURRENT_TIMESTAMP WHERE id = ?').run(summary, id);
      }
      if (keywords) {
        this.db.prepare('DELETE FROM keywords WHERE memory_id = ?').run(id);
        if (keywords.length) {
          const insert = this.db.prepare('INSERT INTO keywords (memory_id, keyword) VALUES (?, ?)');
          for (const k of keywords) insert.run(id, k);
        }
      }
      const exists = this.db.prepare('SELECT 1 FROM memories WHERE id = ?').get(id);
      return !!exists;
    });
    return tx();
  }

  get(id: number): (Memory & { keywords: string[] }) | undefined {
    const row = this.db.prepare(`
      SELECT m.*, GROUP_CONCAT(k.keyword, ', ') as kws
      FROM memories m
      LEFT JOIN keywords k ON m.id = k.memory_id
      WHERE m.id = ?
      GROUP BY m.id`).get(id) as (Memory & { kws: string | null }) | undefined;
    if (!row) return undefined;
    return { ...row, keywords: row.kws ? row.kws.split(', ') : [] } as any;
  }

  list(limit: number, offset: number) {
    const rows = this.db.prepare(`
      SELECT m.*, GROUP_CONCAT(k.keyword, ', ') as kws
      FROM memories m
      LEFT JOIN keywords k ON m.id = k.memory_id
      GROUP BY m.id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?`).all(limit, offset) as (Memory & { kws: string | null })[];
    return rows.map(r => ({ ...r, keywords: r.kws ? r.kws.split(', ') : [] }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
  }

  delete(id: number): boolean {
    const res = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return res.changes > 0;
  }
}
