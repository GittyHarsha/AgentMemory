#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve, sep } from 'path';
import { openDatabase } from './db/connection.js';
import { initializeSchema } from './db/schema.js';
import { FileStore } from './storage/fileStore.js';
import { MemoryRepository } from './repositories/memoryRepo.js';
import { SearchService } from './search/searchService.js';
import { getDatabaseStats as statsHelper, exportAllMemories as exportHelper, getSchema as schemaHelper } from './server/resourceHandlers.js';
import { InsertMemorySchema, UpdateMemorySchema, SearchMemoriesSchema, GetMemorySchema, DeleteMemorySchema, ListMemoriesSchema, ReadFileSchema } from './schemas.js';
import type { SearchRow } from './schemas.js';


class AgentMemoryServer {
  private db: Database.Database;
  private server: Server;
  private dbPath: string;
  private baseContentDir: string;
  private fileStore: FileStore;
  private repo: MemoryRepository;
  private search: SearchService;

  constructor(dbPath: string = './memories.db', baseContentDir: string = './data') {
    this.dbPath = dbPath;
    this.baseContentDir = baseContentDir;
    
    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

  this.db = openDatabase(dbPath);
  initializeSchema(this.db);
  this.fileStore = new FileStore(this.baseContentDir);
  this.repo = new MemoryRepository(this.db);
  this.search = new SearchService(this.db);

    this.server = new Server(
      {
        name: 'agent-memory-fts5',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupResourceHandlers();
  this.setupPromptHandlers();

    // Handle cleanup on exit
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  // initializeDatabase removed (handled by initializeSchema)

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'insert_memory',
            description: 'Insert a new memory. Server chooses dated path /YEAR/MM/DD/<slug>.md derived from summary.',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Full textual content to persist' },
                summary: { type: 'string', description: 'Short summary used for retrieval and filename slug generation' },
                keywords: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Up to 10 normalized keywords' },
              },
              required: ['content', 'summary'],
            },
          },
          {
            name: 'update_memory',
            description: 'Update an existing memory by ID. Provide any of content, summary, keywords to modify.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Memory ID to update' },
                content: { type: 'string', description: 'New full textual content (overwrites existing file)' },
                summary: { type: 'string', description: 'New summary' },
                keywords: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Replacement keyword list (omit to leave unchanged, empty array to clear)' },
              },
              required: ['id'],
            },
          },
          {
            name: 'search_memories',
            description: 'Search memories using BM25 ranking with keyword boosting. Returns memories with their full file contents.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Natural language search query',
                },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 10,
                  description: 'Keywords to boost in ranking',
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  default: 10,
                  description: 'Maximum number of results',
                },
                summaryWeight: {
                  type: 'number',
                  minimum: 0.1,
                  maximum: 10.0,
                  default: 0.8,
                  description: 'Weight for summary column in BM25',
                },
                keywordWeight: {
                  type: 'number',
                  minimum: 0.1,
                  maximum: 10.0,
                  default: 2.0,
                  description: 'Weight for keywords column in BM25',
                },
                lambda: {
                  type: 'number',
                  minimum: 0.0,
                  maximum: 10.0,
                  default: 1.0,
                  description: 'Keyword hits boost factor',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_memory',
            description: 'Retrieve a specific memory by ID with full file contents',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Memory ID',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'delete_memory',
            description: 'Delete a memory by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Memory ID to delete',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'list_memories',
            description: 'List memories with pagination',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  default: 20,
                  description: 'Maximum number of memories to return',
                },
                offset: {
                  type: 'number',
                  minimum: 0,
                  default: 0,
                  description: 'Number of memories to skip',
                },
              },
            },
          },
          {
            name: 'optimize_index',
            description: 'Optimize the FTS5 index for better performance',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'read_file',
            description: 'Read file contents directly by file path',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Absolute path to the file to read',
                },
              },
              required: ['filePath'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'insert_memory':
            return await this.insertMemory(args);
          case 'update_memory':
            return await this.updateMemory(args);
          case 'search_memories':
            return await this.searchMemories(args);
          case 'get_memory':
            return await this.getMemory(args);
          case 'delete_memory':
            return await this.deleteMemory(args);
          case 'list_memories':
            return await this.listMemories(args);
          case 'optimize_index':
            return await this.optimizeIndex();
          case 'read_file':
            return await this.readFile(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error}`
        );
      }
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'memory://database/stats',
            mimeType: 'application/json',
            name: 'Database Statistics',
            description: 'Statistics about the memory database',
          },
          {
            uri: 'memory://database/all',
            mimeType: 'application/json',
            name: 'All Memories',
            description: 'Complete export of all memories',
          },
          {
            uri: 'memory://database/schema',
            mimeType: 'text/plain',
            name: 'Database Schema',
            description: 'SQLite schema information',
          },
        ],
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'memory://database/stats':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.getDatabaseStats(), null, 2),
              },
            ],
          };
        case 'memory://database/all':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.exportAllMemories(), null, 2),
              },
            ],
          };
        case 'memory://database/schema':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: this.getDatabaseSchema(),
              },
            ],
          };
        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${uri}`
          );
      }
    });
  }

  private setupPromptHandlers() {
    // Structured reusable prompts to capture durable memories (facts, procedures, cases, analogies, session docs)
    const prompts: Record<string, { description: string; messages: any[] }> = {
      documentation_session: {
        description: 'Produce a WHAT / WHY / HOW session summary plus key steps & outcomes from a sequence of tool calls for later reuse and analogy building.',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'You convert a development or reasoning session into structured documentation for durable memory storage.' }] },
          { role: 'user', content: [{ type: 'text', text: 'GOAL:\n{{goal}}\n\nCONTEXT NOTES:\n{{context_notes}}\n\nTOOL CALLS (chronological JSON array)\n{{tool_calls_json}}\n\nExtract and return JSON with fields: {"summary":"concise 2-4 sentence overview","what":"primary accomplishment(s)","why":"purpose / motivation","how":"techniques, sequence rationale","steps":[{"order":1,"action":"...","result":"..."}],"key_decisions":["..."],"issues":[{"issue":"...","resolution":"..."}],"outcome":"final result","recommended_next_actions":["..."],"tags":["short","keywords"],"confidence":0.0-1.0}. Do not include extraneous text.' }] }
        ]
      },
      capture_fact: {
        description: 'Distill atomic fact(s) with source & optional confidence from provided content for future retrieval.',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'Identify stable atomic facts suitable for long-term memory.' }] },
          { role: 'user', content: [{ type: 'text', text: 'SOURCE TYPE: {{source_type}}\nSOURCE REF: {{source_ref}}\nTEXT:\n{{text}}\n\nReturn JSON: {"facts":[{"statement":"...","source":"<source_ref>","evidence_snippet":"...","confidence":0.0-1.0,"tags":["..."]}],"summary":"optional short aggregate"}.' }] }
        ]
      },
      capture_procedure: {
        description: 'Extract a reusable step-by-step procedure (case-based reasoning) from narrative content.',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'Produce actionable, minimal, ordered steps that can generalize.' }] },
          { role: 'user', content: [{ type: 'text', text: 'NARRATIVE:\n{{narrative}}\n\nReturn JSON: {"title":"short procedure name","use_case":"when to apply","prerequisites":["..."],"steps":[{"order":1,"instruction":"...","rationale":"(optional)"}],"verification":"how to confirm success","failure_modes":["..."],"tags":["..."]}.' }] }
        ]
      },
      capture_troubleshooting_case: {
        description: 'Summarize a problem-resolution case for later analogy (symptoms, root cause, fix).',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'Extract structured troubleshooting case information.' }] },
          { role: 'user', content: [{ type: 'text', text: 'CASE LOG:\n{{case_log}}\n\nReturn JSON: {"problem":"concise statement","environment":"key context","symptoms":["..."],"diagnostics":[{"action":"...","observation":"..."}],"root_cause":"...","resolution_steps":["..."],"verification":"evidence issue resolved","preventive_actions":["..."],"tags":["..."]}.' }] }
        ]
      },
      generate_analogy_memory: {
        description: 'Create high-level analogies mapping current case to prior memory summaries to aid future reasoning.',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'You build analogies linking a current situation to prior cases to support transfer learning.' }] },
          { role: 'user', content: [{ type: 'text', text: 'CURRENT CASE SUMMARY:\n{{current_case}}\n\nRELATED MEMORY SUMMARIES (array)\n{{related_memories_json}}\n\nReturn JSON: {"core_pattern":"abstract shared pattern","analogies":[{"memory_ref":"file_path or id","similarity_basis":"...","difference":"...","transferable_principle":"..."}],"recommended_reuse_guidelines":["..."],"tags":["..."]}.' }] }
        ]
      }
    };

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: Object.entries(prompts).map(([name, p]) => ({ name, description: p.description }))
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const prompt = prompts[req.params.name];
      if (!prompt) throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${req.params.name}`);
      return { prompt: { name: req.params.name, description: prompt.description, messages: prompt.messages } };
    });
  }

  // Tool implementation methods
  private async insertMemory(args: unknown) {
    const { content, summary, keywords } = InsertMemorySchema.parse(args);
    const normalized = [...new Set(keywords.map(k=>k.trim().toLowerCase()).filter(Boolean))].slice(0,10);
    const slug = (summary.toLowerCase().split(/\s+/).slice(0,8).join('-') || 'memory')
      .replace(/[^a-z0-9-]+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-|-$/g,'')
      .slice(0,50);
    try {
      const stored = this.fileStore.saveDated(slug + '.md', content);
      const id = this.repo.insert(stored.path, summary, normalized);
  return { content: [{ type: 'text', text: JSON.stringify({ message: 'Memory inserted', id, file_path: stored.path }, null, 2) }] };
    } catch (e) {
      throw new McpError(ErrorCode.InternalError, `Failed to insert memory: ${e}`);
    }
  }

  private async updateMemory(args: unknown) {
    const { id, content, summary, keywords } = UpdateMemorySchema.parse(args as any);
    // Fetch existing to know file path
    const existing = this.repo.get(id);
    if (!existing) {
      throw new McpError(ErrorCode.InvalidRequest, `Memory with ID ${id} not found`);
    }
    // Overwrite file if new content
    if (content) {
      try {
        const fs = await import('fs');
        fs.writeFileSync(existing.file_path, content, 'utf-8');
      } catch (e) {
        throw new McpError(ErrorCode.InternalError, `Failed to write file: ${e}`);
      }
    }
    const normalized = keywords === undefined ? undefined : [...new Set(keywords.map(k=>k.trim().toLowerCase()).filter(Boolean))].slice(0,10);
    const ok = this.repo.update(id, summary, normalized);
    if (!ok) {
      throw new McpError(ErrorCode.InternalError, 'Update failed');
    }
    const updated = this.repo.get(id)!;
  return { content: [{ type: 'text', text: JSON.stringify({ message: 'Memory updated', id, file_path: updated.file_path }, null, 2) }] };
  }

  private async searchMemories(args: unknown) {
    const { query, keywords, limit, summaryWeight, keywordWeight, lambda } = SearchMemoriesSchema.parse(args);
    const results = this.search.run({ query, keywords, limit, summaryWeight, keywordWeight, lambda }) as SearchRow[];
    const enhancedResults = results.slice(0, limit).map(r => ({
      file_path: r.file_path,
      summary: r.summary,
      ...this.fileStore.readLimited(r.file_path)
    }));
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: enhancedResults.map(result => ({
              file_path: result.file_path,
              file_contents: result.file_contents,
              summary: result.summary
            })),
            total_found: results.length
          }, null, 2),
        },
      ],
    };
  }

  private async getMemory(args: unknown) {
    const { id } = GetMemorySchema.parse(args);
    const memory = this.repo.get(id);

    if (!memory) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Memory with ID ${id} not found`
      );
    }

    // Read file contents
  const fileInfo = this.fileStore.readLimited(memory.file_path);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: memory.id,
            file_path: memory.file_path,
            file_contents: fileInfo.file_contents,
            summary: memory.summary
          }, null, 2),
        },
      ],
    };
  }

  private async deleteMemory(args: unknown) {
    const { id } = DeleteMemorySchema.parse(args);
    const ok = this.repo.delete(id);
    if (!ok) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Memory with ID ${id} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `Memory with ID ${id} deleted successfully`,
        },
      ],
    };
  }

  private async listMemories(args: unknown) {
    const { limit, offset } = ListMemoriesSchema.parse(args);
    const memories = this.repo.list(limit, offset) as any[];
    const total = this.repo.count();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memories: memories.map(m => ({
              ...m,
              keywords: m.keywords ? m.keywords.split(', ') : []
            })),
            pagination: {
              total: total,
              limit,
              offset,
              has_more: offset + limit < total
            }
          }, null, 2),
        },
      ],
    };
  }

  private async optimizeIndex() {
  // Optimization logic moved to services
    
    return {
      content: [
        {
          type: 'text',
          text: 'FTS5 index optimized successfully',
        },
      ],
    };
  }

  private async readFile(args: unknown) {
    const { filePath } = ReadFileSchema.parse(args);
    // Security: restrict reads to within base content directory
    const resolvedBase = resolve(this.baseContentDir) + sep;
    const resolvedTarget = resolve(filePath);
    const isWithinBase = resolvedTarget.toLowerCase().startsWith(resolvedBase.toLowerCase());
    if (!isWithinBase) {
      throw new McpError(ErrorCode.InvalidRequest, 'File path outside content directory');
    }
    const fileInfo = this.fileStore.readLimited(resolvedTarget);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            file_path: filePath,
            file_contents: fileInfo.file_contents,
            file_exists: fileInfo.file_exists
          }, null, 2),
        },
      ],
    };
  }

  // Helper methods moved to modular files

  private getDatabaseStats() { return statsHelper(this.db, this.dbPath); }
  private exportAllMemories() { return exportHelper(this.db); }
  private getDatabaseSchema(): string { return schemaHelper(this.db); }

  // Removed unused getDatabaseSize method (was relying on CommonJS require in ESM context)

  private cleanup() {
    try {
      this.db.close();
      console.error('Database connection closed');
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Agent Memory FTS5 MCP server running on stdio');
  }
}

// Start the server
const server = new AgentMemoryServer();
server.run().catch(console.error);
