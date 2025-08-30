import { z } from 'zod';

// Zod Schemas
export const InsertMemorySchema = z.object({
  content: z.string().min(1),
  summary: z.string().min(1).max(1000),
  keywords: z.array(z.string()).max(10).optional().default([]),
});

export const UpdateMemorySchema = z.object({
  id: z.number().int().positive(),
  content: z.string().min(1).optional(),
  summary: z.string().min(1).max(1000).optional(),
  keywords: z.array(z.string()).max(10).optional(),
}).refine(d => d.content || d.summary || d.keywords, {
  message: 'At least one of content, summary, or keywords must be provided',
});

export const SearchMemoriesSchema = z.object({
  query: z.string().min(1),
  keywords: z.array(z.string()).max(10).optional().default([]),
  limit: z.number().int().positive().max(100).optional().default(10),
  summaryWeight: z.number().positive().optional().default(0.8),
  keywordWeight: z.number().positive().optional().default(2.0),
  lambda: z.number().min(0).optional().default(1.0),
});

export const GetMemorySchema = z.object({ id: z.number().int().positive() });
export const DeleteMemorySchema = z.object({ id: z.number().int().positive() });
export const ListMemoriesSchema = z.object({
  limit: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});
export const ReadFileSchema = z.object({ filePath: z.string() });

// Interfaces
export interface Memory {
  id: number;
  file_path: string;
  summary: string;
  created_at: string;
}

export interface SearchRow extends Memory {
  matched_keywords: number;
  bm25_score: number;
  final_score: number;
}
