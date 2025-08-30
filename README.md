# Agent Memory MCP Server

High‑quality persistent memory store for MCP clients backed by SQLite + FTS5 (BM25 ranking + keyword boosting) with automatic file persistence laid out by date.

## Core Features

- SQLite persistence (WAL enabled) – safe across restarts
- FTS5 full‑text index (summary + aggregated keywords) with BM25 ranking
- Keyword boosting (tunable weights + lambda factor)
- Structured memory upsert that ALSO writes the full provided content to disk
- Deterministic date path layout: `/YYYY/MM/DD/filename.md` (auto collision suffix)
- Direct file reads (with size cap for safety – currently 1MB)
- Memory listing & targeted retrieval by id
- Database + schema export resources for observability
- Clean modular architecture (db / repositories / search / storage / server)

## Installation

1. Install dependencies:
```bash
npm install
```
2. Build TypeScript:
```bash
npm run build
```

## Run
Development (ts-node / ts-node-dev style):
```bash
npm run dev
```
Production (after build):
```bash
npm start
```
Watch & rebuild:
```bash
npm run watch
```

The server communicates over stdio (MCP expectation). No extra config needed; a `memories.db` file will be created beside the binary plus a `data` directory for stored files.

## Tools (MCP)

| Tool | Description | Parameters | Returns |
|------|-------------|------------|---------|
| `insert_memory` | Insert new memory; content saved under dated path with slug from summary. | `content` (string, required) – full text<br>`summary` (string, required, ≤1000 chars)<br>`keywords` (string[ ] max 10, optional) | `{ message, id, file_path }` |
| `update_memory` | Update existing memory (any subset of fields). File overwritten if `content` provided. | `id` (number, required)<br>`content` (string, optional)<br>`summary` (string, optional)<br>`keywords` (string[ ] max 10, optional; omit = unchanged; empty array = clear) | `{ message, id, file_path }` |
| `search_memories` | BM25 + keyword boosted search over summaries + aggregated keywords. | `query` (string, required)<br>`keywords` (string[ ] max 10, optional, boost terms)<br>`limit` (number 1–100, default 10)<br>`summaryWeight` (number, default 0.8)<br>`keywordWeight` (number, default 2.0)<br>`lambda` (number ≥0, default 1.0) | `{ results:[{ file_path, summary, file_contents }], total_found }` |
| `get_memory` | Retrieve single memory incl. file contents. | `id` (number, required) | `{ id, file_path, file_contents, summary }` |
| `delete_memory` | Delete memory row (cascades keywords & FTS entry). | `id` (number, required) | confirmation text |
| `list_memories` | Page through memories with keywords + pagination meta. | `limit` (number 1–100, default 20)<br>`offset` (number ≥0, default 0) | `{ memories:[...], pagination:{ total, limit, offset, has_more } }` |
| `optimize_index` | Placeholder; future FTS5 optimize/merge. | (none) | success text |
| `read_file` | Read stored file (enforces path confinement; size‑capped 1MB). | `filePath` (string, absolute inside data dir) | `{ file_path, file_contents, file_exists }` |

Notes:
- All errors returned via MCP error codes (e.g., InvalidRequest, InternalError).
- Keywords are normalized to lowercase & deduplicated server‑side.
- Large files (>1MB) return a placeholder rather than contents.

## Prompts (MCP)

Structured prompt templates help capture durable, high‑value memories for later analogy and case‑based reasoning. Each template returns JSON suited for storage via `insert_memory`.

| Prompt | What it Captures | Why | Placeholders / Inputs | Output Shape (JSON) |
|--------|------------------|-----|-----------------------|---------------------|
| `documentation_session` | Session WHAT/WHY/HOW, steps, decisions, issues, outcomes | Enables fast recap and analogy for similar future tasks | `{{goal}}`, `{{context_notes}}`, `{{tool_calls_json}}` | summary, what, why, how, steps[], key_decisions[], issues[], outcome, recommended_next_actions[], tags[], confidence |
| `capture_fact` | Atomic fact statements w/ evidence & confidence | Builds factual knowledge base for retrieval | `{{source_type}}`, `{{source_ref}}`, `{{text}}` | facts[{statement, source, evidence_snippet, confidence, tags[]}], summary |
| `capture_procedure` | Reusable stepwise procedure (case pattern) | Facilitates re‑application of successful methods | `{{narrative}}` | title, use_case, prerequisites[], steps[{order,instruction,rationale?}], verification, failure_modes[], tags[] |
| `capture_troubleshooting_case` | Problem -> symptoms -> diagnostics -> root cause -> resolution | Aids future diagnosis by pattern matching | `{{case_log}}` | problem, environment, symptoms[], diagnostics[{action,observation}], root_cause, resolution_steps[], verification, preventive_actions[], tags[] |
| `generate_analogy_memory` | High‑level analogies linking current case to prior memories | Promotes transfer of principles to new problems | `{{current_case}}`, `{{related_memories_json}}` | core_pattern, analogies[{memory_ref, similarity_basis, difference, transferable_principle}], recommended_reuse_guidelines[], tags[] |

### Why Prompts vs Tool Descriptions
Tools remain concise action interfaces; prompts encapsulate richer transformation instructions without overloading tool metadata. This separation keeps side‑effecting actions (insert/update/search) distinct from generative reasoning steps.

### Typical Capture Workflow (How)
1. Perform work using tools (e.g., `insert_memory`, `update_memory`, `search_memories`). Collect raw notes + tool call log.
2. Generate structured documentation: call prompt `documentation_session` with the goal, context notes, and chronological tool call JSON. Insert returned JSON (pretty‑printed) via `insert_memory` (summary = short synopsis, keywords = derived tags).
3. Extract atomic facts encountered: use `capture_fact` per source chunk; store results (each fact either individually or aggregated) as new memories.
4. When a reusable method emerges, feed narrative into `capture_procedure`; store the output.
5. For incidents or debugging: feed logs into `capture_troubleshooting_case`; store output for future pattern matching.
6. After accumulating related cases, invoke `generate_analogy_memory` with current case summary + selected related memory summaries (obtained via `search_memories` + `get_memory`). Store analogy output to strengthen future reasoning.

### Example Sequence (Successful Usage)
1. Search existing memories for context (`search_memories`).
2. Insert new raw exploration notes (`insert_memory`).
3. After completing task, call prompt `documentation_session` to synthesize; store result via `insert_memory` (acts as canonical session summary).
4. Identify a stable technique; run `capture_procedure`; store.
5. Encounter issue; resolve it; run `capture_troubleshooting_case`; store.
6. Build analogies for new task leveraging past procedures + cases using `generate_analogy_memory`; store.

### Storage Guidance
- Use the JSON output directly as the memory content; the summary field should be a concise one‑line WHAT/WHY/HOW or title.
- Derive keywords from tags (lowercase, deduplicated).
- Keep each memory focused: one fact set, one procedure, one case, etc., for sharper retrieval.

### Retrieval & Analogy Use
- Start with `search_memories` using natural language; optionally refine queries manually or (future) with a query refinement prompt.
- Combine related procedures + cases + analogies to propose an initial solution blueprint before executing tools again.

## Resources (MCP)

| URI | Description |
|-----|-------------|
| memory://database/stats | JSON statistics (row counts, sizes) |
| memory://database/all | Full export of memories + keywords |
| memory://database/schema | Raw SQLite schema (DDL) |

## File Storage Layout

When you upsert, the provided logical filePath is transformed into:
`data/<YYYY>/<MM>/<DD>/<basename>.md`

Rules:
- Date components use the current system date at upsert time.
- Extension forced to `.md` (original extension discarded).
- If a file with that name already exists for the day, a numeric suffix `-1`, `-2`, ... is appended before `.md`.

## Data Model (SQLite)

Tables:
- memories(id INTEGER PK, file_path TEXT UNIQUE, summary TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
- keywords(memory_id INTEGER, keyword TEXT, PK(memory_id, keyword))
- memories_fts (FTS5 external content: summary, keywords)

Triggers keep `memories_fts` synchronized (delete then insert strategy for updates & keyword changes).

## Architecture Overview

| Folder | Purpose |
|--------|---------|
| `src/db` | Connection + schema initialization (PRAGMAs, tables, triggers, FTS5) |
| `src/storage` | File persistence (dated path logic, collision handling, size‑capped reads) |
| `src/repositories` | Data access for memories/keywords (transactions, upsert, list) |
| `src/search` | SearchService (BM25 + keyword boosting query) |
| `src/server` | Resource helper implementations (stats, export, schema) |
| `src/schemas.ts` | Zod schemas + shared interfaces |

## Configuration & Defaults

Defaults (can be overridden by modifying constructor args in `src/index.ts`):
- Database path: `./memories.db`
- Content base directory: `./data`
- File read max size: 1 MB

## MCP Client Integration (mcp.json example)

Use an `mcp.json` manifest to register this server with an MCP‑compatible client (e.g. GitHub Copilot Chat with MCP support).

### 1. Build the server
```bash
npm install
npm run build
```

### 2. Create `mcp.json`
Place an `mcp.json` in the location your client expects (often project root or a designated config directory):
```json
{
  "servers": {
    "agent-memory": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\projects\\agent-memory\\dist\\index.js"
      ]
    }
  },
  "inputs": []
}
```
Notes:
- Adjust the path if your checkout differs.
- Double backslashes are for JSON escaping; single backslashes are fine if the loader tolerates them.
- Defaults: DB at `./memories.db`, content dir `./data`. Override by adding an `env` object under the server (e.g. `"env": { "AGENT_MEMORY_DB": "D:/mem/db.sqlite" }`).

### 3. Launch / Reload Client
Restart or reload the MCP‑aware client so it picks up `mcp.json`.

### 4. Verify
List tools via the client (e.g. command to show MCP servers) and confirm `insert_memory`, `search_memories`, etc. appear.

### 5. Use Prompts + Store
1. Call a prompt (e.g. `documentation_session`).
2. Take returned JSON -> call `insert_memory` with:
   - content: the JSON
   - summary: one line WHAT/WHY/HOW
   - keywords: tags array

### Troubleshooting
- Not listed: confirm `dist/index.js` exists and path matches.
- Permission errors: ensure Node can read/write the working directory.
- DB locked: terminate stray Node processes holding the file.
- Manual test: run `node dist/index.js` and observe stderr startup log.

### Live Development
Run `npm run watch` to auto‑rebuild while the client continues using `dist/index.js`.

## Future Improvements

- Implement real optimize_index tool (FTS5 optimize / incremental merge)
- Add configurable size limits & retention policies
- Add embedding generation hook (hybrid lexical + vector search)
- Optional encryption at rest

## Security Notes

- The read_file tool now enforces that target paths reside within the configured content base directory to prevent path traversal / arbitrary file reads.

## Error Handling

All tool errors surface MCP error codes (InvalidRequest, InternalError, etc.). Common causes:
- Missing required parameter
- Out of range limit values
- Unknown memory id

## Contributing

PRs welcome. Keep additions modular and update this README if interfaces change.

## License

MIT (add a LICENSE file if distributing publicly).
