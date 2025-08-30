import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';

export interface StoredFileResult { path: string; bytes: number; }

export class FileStore {
  constructor(private baseDir: string = './data') {}

  ensureDir(p: string) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  saveDated(basenameHint: string, content: string, now = new Date()): StoredFileResult {
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const rawName = basename(basenameHint || 'note.md');
    const finalFileName = rawName.endsWith('.md') ? rawName : rawName + '.md';
    const targetDir = join(this.baseDir, year, month, day);
    this.ensureDir(targetDir);
    let candidate = join(targetDir, finalFileName);
    if (existsSync(candidate)) {
      const stem = finalFileName.replace(/\.md$/i, '');
      let i = 1;
      while (existsSync(candidate)) {
        candidate = join(targetDir, `${stem}-${i}.md`);
        i++;
      }
    }
    writeFileSync(candidate, content, 'utf-8');
    return { path: candidate, bytes: content.length };
  }

  readLimited(path: string, limitBytes = 1024 * 1024) {
    try {
      if (!existsSync(path)) return { file_exists: false };
      const stats = statSync(path);
      if (stats.size > limitBytes) {
        return {
          file_exists: true,
          file_size: stats.size,
          file_contents: `[File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Contents not loaded.]`
        };
      }
      const contents = readFileSync(path, 'utf-8');
      return { file_exists: true, file_size: stats.size, file_contents: contents };
    } catch (e) {
      return { file_exists: false, file_contents: `[Error reading file: ${e}]` };
    }
  }
}
