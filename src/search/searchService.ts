import type Database from 'better-sqlite3';
import { SearchMemoriesSchema } from '../schemas.js';

export interface SearchParams extends ReturnType<typeof SearchMemoriesSchema['parse']> {}

export class SearchService {
  constructor(private db: Database.Database) {}

  sanitize(query: string): string {
    return query.replace(/"/g, '""').replace(/[(){}[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  run(params: SearchParams) {
    const { query, keywords, limit, summaryWeight, keywordWeight, lambda } = params;
    const sanitized = this.sanitize(query);
    const hasKeywords = keywords.length > 0;
    const kwExpr = hasKeywords
      ? `((SELECT COUNT(DISTINCT k.keyword) FROM keywords k WHERE k.memory_id = m.id AND k.keyword IN (${keywords.map(()=>'?').join(',')})))`
      : '0';

    const sql = `WITH ranked AS (
      SELECT m.id, m.file_path, m.summary, m.created_at,
             bm25(memories_fts, ?, ?) AS bm25_score,
             ${kwExpr} AS matched_keywords
      FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?)
      SELECT *, (bm25_score - (? * matched_keywords)) AS final_score
      FROM ranked
      ORDER BY final_score ASC`;

    const bind: any[] = [summaryWeight, keywordWeight];
    if (hasKeywords) bind.push(...keywords.map(k=>k.toLowerCase()));
    bind.push(sanitized, limit * 2, lambda);
    return this.db.prepare(sql).all(...bind) as any[];
  }
}
