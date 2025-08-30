import type Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS keywords (
    memory_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    PRIMARY KEY (memory_id, keyword),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    summary,
    keywords,
    content='memories',
    content_rowid='id',
    tokenize='unicode61',
    prefix='2 3 4'
  )`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, summary, keywords)
    VALUES (new.id, new.summary,
      COALESCE((SELECT GROUP_CONCAT(keyword, ' ') FROM keywords WHERE memory_id = new.id), '')
    );
  END;`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid) VALUES ('delete', old.id);
  END;`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid) VALUES ('delete', old.id);
    INSERT INTO memories_fts(rowid, summary, keywords)
    VALUES (new.id, new.summary,
      COALESCE((SELECT GROUP_CONCAT(keyword, ' ') FROM keywords WHERE memory_id = new.id), '')
    );
  END;`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS keywords_ai AFTER INSERT ON keywords BEGIN
    INSERT INTO memories_fts(memories_fts, rowid) VALUES ('delete', new.memory_id);
    INSERT INTO memories_fts(rowid, summary, keywords)
    VALUES (new.memory_id, (SELECT summary FROM memories WHERE id = new.memory_id),
      COALESCE((SELECT GROUP_CONCAT(keyword, ' ') FROM keywords WHERE memory_id = new.memory_id), '')
    );
  END;`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS keywords_ad AFTER DELETE ON keywords BEGIN
    INSERT INTO memories_fts(memories_fts, rowid) VALUES ('delete', old.memory_id);
    INSERT INTO memories_fts(rowid, summary, keywords)
    VALUES (old.memory_id, (SELECT summary FROM memories WHERE id = old.memory_id),
      COALESCE((SELECT GROUP_CONCAT(keyword, ' ') FROM keywords WHERE memory_id = old.memory_id), '')
    );
  END;`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS keywords_au AFTER UPDATE ON keywords BEGIN
    INSERT INTO memories_fts(memories_fts, rowid) VALUES ('delete', old.memory_id);
    INSERT INTO memories_fts(rowid, summary, keywords)
    VALUES (old.memory_id, (SELECT summary FROM memories WHERE id = old.memory_id),
      COALESCE((SELECT GROUP_CONCAT(keyword, ' ') FROM keywords WHERE memory_id = old.memory_id), '')
    );
  END;`);
}
