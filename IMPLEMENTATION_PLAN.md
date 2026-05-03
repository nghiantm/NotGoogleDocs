# Implementation Plan

> **Claude Code:** Use this file to find the next task after completing CURRENT_TASK.md.
> Do NOT skip milestones. Do NOT work on a milestone until all prior milestones pass their acceptance criteria.
> Each milestone must leave the project in a working, non-broken state before proceeding.
> All install commands use `bun install`. Do not run `npm install`.

---

## Milestone 1 — Monorepo Setup, Core Types, and Wire Format

### Objective
Establish project skeleton: Turborepo monorepo, shared TypeScript config, all canonical type definitions, wire-format conversion helpers, working test pipeline. Zero business logic.

### Deliverables
- `turbo.json`, root `package.json` with workspaces
- `tsconfig.base.json` at root
- `bun.lockb` committed at root
- `packages/crdt/src/types.ts` — all canonical types
- `packages/crdt/src/utils.ts` — `charIdToString`, `stringToCharId`
- `packages/crdt/src/wire.ts` — `toWire`/`fromWire`/`toWireDoc`/`fromWireDoc`
- `packages/crdt/src/index.ts` — barrel export
- Vitest configured in `packages/crdt`
- Skeleton `package.json` + `tsconfig.json` for all three packages
- Server and client `test` scripts use `tsc --noEmit`

### Tasks
- `mkdir -p packages/{crdt,server,client}/src packages/crdt/tests`
- Write `turbo.json` with `build` and `test` pipeline
- Write root `package.json` with `workspaces: ["packages/*"]`, `packageManager: "bun@1.1.0"` or current Bun version
- Write `tsconfig.base.json` with `strict: true`, `target: ES2022`, `module: ES2022`, `moduleResolution: bundler`
- Write per-package `tsconfig.json` files extending base
- Implement all types in `types.ts` exactly as specified in ARCHITECTURE.md
- Implement utilities in `utils.ts`
- Implement wire format in `wire.ts`:
  - `WireCharId`, `WireChar`, `WireOperation`, `WireSerializedDoc` types
  - `toWire(op: Operation): WireOperation` — converts every `bigint` to string
  - `fromWire(wire: WireOperation): Operation` — converts every string back to `bigint`
  - `toWireDoc(doc: SerializedDoc): WireSerializedDoc`
  - `fromWireDoc(wire: WireSerializedDoc): SerializedDoc`
- Configure Vitest in `packages/crdt/package.json`
- Set `"test": "tsc --noEmit"` in server and client `package.json`
- Write `packages/crdt/tests/utils.test.ts` — utility round-trip tests
- Write `packages/crdt/tests/wire.test.ts` — wire format round-trip tests including JSON.stringify/parse cycle

### Acceptance Criteria
```bash
bun install        # produces bun.lockb at root, no errors
turbo build        # exits 0, no TypeScript errors
turbo test         # exits 0, all tests pass
```
- `charIdToString({ clientId: 'abc', clock: 99999999999999999n })` round-trips with bigint precision preserved
- `JSON.parse(JSON.stringify(toWire(op)))` round-trips through `fromWire` to identical `Operation` (deep equal)
- All types exported from `packages/crdt/src/index.ts`
- `bun.lockb` exists at repo root

### Out of Scope
- Document, VectorClock, OperationBuffer classes
- Database, server, React, Vite, Dockerfile

---

## Milestone 2 — CRDT Document Class

### Objective
Implement `Document` with correct `integrate()` and exhaustive convergence tests. Internal storage uses string keys exclusively. Zero test failures before proceeding.

### Deliverables
- `packages/crdt/src/document.ts`
- `packages/crdt/tests/document.test.ts`

### Tasks
- Implement `Document` with `chars: Map<string, Char>` and `order: string[]`
  - **All Map keys are `charIdToString(char.id)` strings — never CharId objects**
  - `Char.leftId` and `Char.rightId` are CharId objects (typed as such), but every lookup converts to string first
- Define `Document.START_ID = 'START'` and `Document.END_ID = 'END'` as static string constants
- Implement public methods (all use string IDs):
  - `insert(afterId: string, value: string, clientId: string, clock: bigint): Char`
  - `delete(charId: string): Char | null` — tombstone only, never splice from `order`
  - `integrate(char: Char): void` — convert `char.leftId`/`rightId` to strings via `charIdToString` before lookup; deterministic tiebreaker: lexicographic `clientId` comparison
  - `getText(): string` — filter tombstones, join values
  - `getCharIdAtIndex(index: number): string`
  - `getIndexOfCharId(charId: string): number`
  - `serialize(): SerializedDoc`
  - `static deserialize(data: SerializedDoc): Document`
- Idempotency: `integrate()` checks if `charIdToString(char.id)` already in `chars` Map and returns early
- Export `Document` from `packages/crdt/src/index.ts`
- Tests:
  - Basic insert ordering produces correct text
  - Tombstone preserved in `order` array after `delete`
  - 2-way convergence: cross-apply ops in both orders, both docs match
  - 3-way convergence: 3 docs cross-applying ops in all orderings produce identical text
  - Concurrent insert at same position with different clientIds → deterministic order via tiebreaker
  - Concurrent insert + delete on same character → both docs converge
  - Idempotency: `integrate()` called twice with same char produces no duplicate
  - Position round-trip: `getIndexOfCharId(getCharIdAtIndex(i)) === i` for all valid i
  - `serialize()` → JSON.stringify → JSON.parse → `deserialize()` produces equal Document state

### Acceptance Criteria
```bash
turbo test   # all tests pass, zero failures
```
- All convergence tests pass
- All idempotency tests pass
- Position round-trip test passes
- Serialize round-trip test passes

### Out of Scope
- VectorClock, OperationBuffer, server, React

---

## Milestone 3 — VectorClock and OperationBuffer

### Objective
Implement causal ordering primitives.

### Deliverables
- `packages/crdt/src/vector-clock.ts`
- `packages/crdt/src/operation-buffer.ts`
- `packages/crdt/tests/vector-clock.test.ts`
- `packages/crdt/tests/operation-buffer.test.ts`

### Tasks
- `VectorClock`:
  - `update(clientId: string, clock: bigint): void` — set if greater
  - `hasSeen(clientId: string, clock: bigint): boolean`
  - `isReady(op: Operation): boolean` — false if `op.char.leftId` exists and not seen, or `op.char.rightId` exists and not seen
  - `serialize(): Record<string, string>` — bigint values to strings
  - `static deserialize(data: Record<string, string>): VectorClock`
  - `clone(): VectorClock`
- `OperationBuffer`:
  - `add(op: Operation): void`
  - `drain(vc: VectorClock): Operation[]` — returns newly-ready ops, removes from buffer
  - `size(): number` — for testing
- Export from `packages/crdt/src/index.ts`
- Tests:
  - `isReady` false when leftId dependency unseen, true after `update`
  - `isReady` false when rightId dependency unseen
  - `isReady` true for delete op with no leftId/rightId
  - `drain` releases ready ops, leaves unready ones in buffer
  - `drain` called twice does not return same ops
  - VectorClock serialization round-trip preserves bigint precision
  - VectorClock `clone()` is independent (mutating clone does not affect original)

### Acceptance Criteria
```bash
turbo test   # all tests pass
```

### Out of Scope
- Server, React, database

---

## Milestone 4 — PostgreSQL Schema and DB Layer

### Objective
Define and apply the database schema. Implement typed DB layer with bigint type configured and bounded pool.

### Deliverables
- `packages/server/sql/schema.sql` — idempotent schema
- `packages/server/src/db.ts`
- `packages/server/.env.example`

### Tasks
- Write idempotent schema: every `CREATE TABLE` uses `IF NOT EXISTS`, every `CREATE INDEX` uses `IF NOT EXISTS`, the `next_seq` function uses `CREATE OR REPLACE`
- Schema includes:
  - `documents (id UUID PK, title VARCHAR, created_at TIMESTAMPTZ)`
  - `operations (id UUID PK, doc_id UUID, seq BIGINT, client_id VARCHAR, lamport_clock BIGINT, op_type VARCHAR, char_id VARCHAR, char_value CHAR(1), left_id VARCHAR, right_id VARCHAR, is_deleted BOOLEAN, wall_clock BIGINT, UNIQUE(doc_id, seq))`
  - `snapshots (id UUID PK, doc_id UUID, snapshot_seq BIGINT, state JSONB, created_at TIMESTAMPTZ, UNIQUE(doc_id, snapshot_seq))`
  - `doc_sequences (doc_id UUID PK, next_seq BIGINT)`
- Indexes: `(doc_id, seq ASC)` and `(doc_id, wall_clock ASC)` on `operations`; `(doc_id, snapshot_seq DESC)` on `snapshots`
- `next_seq(doc_id UUID) RETURNS BIGINT` PL/pgSQL using `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
- Implement `Database` class:
  - Constructor: `postgres(process.env.DATABASE_URL!, { max: 10, types: { bigint: postgres.BigInt } })`
  - Throw if `DATABASE_URL` is missing
  - Methods (all returning bigint where applicable, never strings):
    - `createDocument(): Promise<{ id: string; title: string }>`
    - `nextSeq(docId: string): Promise<bigint>`
    - `persistOp(docId: string, op: Operation, seq: bigint): Promise<void>`
    - `getAllOps(docId: string): Promise<PersistedOp[]>`
    - `getOpsSince(docId: string, afterSeq: bigint): Promise<PersistedOp[]>`
    - `getOpsPage(docId: string, limit: number, offset: number): Promise<PersistedOp[]>`
    - `getOpCount(docId: string): Promise<bigint>`
    - `getLatestSnapshot(docId: string): Promise<PersistedSnapshot | null>` — `state` field returned as `WireSerializedDoc` directly from JSONB
    - `getLatestSeq(docId: string): Promise<bigint>` — return 0n if no ops
    - `writeSnapshot(docId: string, snapshotSeq: bigint, state: WireSerializedDoc): Promise<void>` — accepts WIRE format, JSONB column stores it as-is
- Define `PersistedOp` type — same fields as `operations` columns, with `lamportClock: bigint`, `seq: bigint`, `wallClock: number`
- Define `PersistedSnapshot` type — `{ id: string; docId: string; snapshotSeq: bigint; state: WireSerializedDoc }`
- Write `.env.example` with: `DATABASE_URL`, `PORT`, `COMPACTION_THRESHOLD`, `CORS_ORIGIN`

### Acceptance Criteria
```bash
psql $DATABASE_URL -f packages/server/sql/schema.sql   # exits 0
psql $DATABASE_URL -f packages/server/sql/schema.sql   # exits 0 again (idempotency)
cd packages/server && bun tsc --noEmit                 # exits 0
```
- Schema is idempotent: running it twice produces no errors
- `next_seq()` is atomic: 100 concurrent calls for same `doc_id` produce 100 distinct values (verifiable via small test script)
- `db.nextSeq()` returns native `bigint`, not string (verifiable via `typeof result === 'bigint'`)
- `getOpsSince(docId, 50n)` returns only ops with `seq > 50`
- `getOpsPage(docId, 100, 0)` returns at most 100 ops

### Out of Scope
- WebSocket server, compaction logic

---

## Milestone 5 — Bun WebSocket Server (Core)

### Objective
Implement WebSocket server with all message handlers, REST endpoints, CORS, structured logging. Compaction stubbed.

### Deliverables
- `packages/server/src/index.ts`
- `packages/server/src/rooms.ts`
- `packages/server/src/loader.ts`
- `packages/server/src/log.ts`

### Tasks
- `log.ts`: structured logging helper
  ```typescript
  export const log = {
    info: (event: string, data?: object) => console.log(JSON.stringify({ level: 'info', event, ...data, ts: Date.now() })),
    error: (event: string, data?: object) => console.error(JSON.stringify({ level: 'error', event, ...data, ts: Date.now() })),
  }
  ```
- `index.ts`:
  - `Bun.serve` with WebSocket upgrade on `/doc/:docId`
  - Helper `corsHeaders()` returning `{ 'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }`
  - REST endpoints with CORS headers and OPTIONS handling:
    - `GET /health` → `{ ok: true }`
    - `POST /docs` → create doc, return `{ id, title }`
    - `GET /docs/:docId/ops?limit=N&offset=N` — paginated, default limit 1000, max 5000, returns `WireOp[]` (server converts via `toWire`)
  - WebSocket message handler wrapped in try/catch — log errors, do not throw
  - On `OP` (msg.op is wire format): `op = fromWire(msg.op)`, `seq = await db.nextSeq()`, `db.persistOp(docId, op, seq)`, `rooms.broadcast(docId, clientId, JSON.stringify({ type: 'OP', op: toWire({ ...op, seq }) }))`, ACK with `{ type: 'ACK', seq: seq.toString() }`, `setImmediate(() => maybeCompact(docId, db))` (stub returns immediately for this milestone)
  - On `SYNC`: parse vectorClock from `msg.vectorClock` (string values), `loader.load(docId, vc)`, send `SYNC_RESPONSE { ops: WireOp[] }`
  - On `PRESENCE`: broadcast to room
  - On `open`: `rooms.join()`, `loader.load(docId)`, send `INIT { snapshot: WireSerializedDoc | null, ops: WireOp[], snapshotSeq: string }`
  - On `close`: `rooms.leave()`, broadcast null cursor presence
  - Log: `connection.open`, `connection.close`, `op.persisted`, `error.unhandled`
- `rooms.ts`: in-memory `Map<docId, Map<clientId, { ws, cursor, color, name }>>`
  - Color: hash `clientId` into 6-color palette (deterministic across sessions)
  - Methods: `join`, `leave`, `broadcast(docId, excludeClientId, message)`, `getCursors(docId)`
- `loader.ts`: `load(docId, clientVectorClock?)` returns `{ snapshot: WireSerializedDoc | null, ops: WireOp[], snapshotSeq: string }`
  - `db.getLatestSnapshot(docId)` → already in wire format
  - `db.getOpsSince(docId, snapshotSeq)` → convert each via `toWire`
  - If `clientVectorClock` provided, filter ops to only those with `lamport_clock > clientVectorClock[client_id]`

### Acceptance Criteria
```bash
cd packages/server && bun run src/index.ts            # starts, logs "server.listening"
curl http://localhost:3001/health                     # returns {"ok":true}
curl -X POST http://localhost:3001/docs               # returns {"id":"...","title":"Untitled"}
curl http://localhost:3001/docs/[id]/ops              # returns []
```
- Two WebSocket clients connecting to same `docId` receive identical `INIT` state
- OP from client A received by client B
- ACK contains `seq` as string (wire format)
- SYNC with stale vectorClock returns only missing ops
- Malformed JSON message logged as `error.unhandled` but does not crash server
- All HTTP responses include `Access-Control-Allow-Origin` header
- OPTIONS request to any endpoint returns 204 with CORS headers

### Out of Scope
- Real compaction (stub)
- Dockerfile, fly.toml

---

## Milestone 6 — Snapshot Compaction

### Objective
Implement background compaction. Verify load time improvement.

### Deliverables
- `packages/server/src/compaction.ts`

### Tasks
- `maybeCompact(docId: string, db: Database): Promise<void>`:
  - Read `COMPACTION_THRESHOLD` from env (default 10000)
  - `latestSnapshot = await db.getLatestSnapshot(docId)`
  - `latestSeq = await db.getLatestSeq(docId)`
  - `opsSinceSnapshot = latestSeq - (latestSnapshot?.snapshotSeq ?? 0n)`
  - If `opsSinceSnapshot < BigInt(threshold)`: return
  - `startTime = performance.now()`
  - Fetch all ops, replay into fresh `Document`:
    - For each op: if `op_type === 'insert'`, construct `Char` from columns and `doc.integrate(char)`; if `delete`, `doc.delete(char_id)`
  - `wireDoc = toWireDoc(doc.serialize())`
  - `await db.writeSnapshot(docId, latestSeq, wireDoc)`
  - `log.info('compaction.complete', { docId, opCount: latestSeq, durationMs: performance.now() - startTime })`
- Wire `maybeCompact` into `index.ts` OP handler replacing the stub
- Update `loader.load()` to return snapshot when present (already done in M5, just verify)

### Acceptance Criteria
- Set `COMPACTION_THRESHOLD=100` for testing, send 100+ ops, observe `compaction.complete` log
- After compaction: `db.getLatestSnapshot(docId)` returns non-null
- After compaction: `loader.load()` returns `snapshot !== null` and only delta ops
- `GET /docs/:docId/ops` still returns all ops (compaction does not affect log)
- Compaction in `setImmediate` — ops sent during compaction still get persisted and broadcast

### Out of Scope
- Tombstone GC, client changes

---

## Milestone 7 — Vite Client Build Setup

### Objective
Configure Vite for the client. Set up environment variable typing. Produce a real deployable build.

### Deliverables
- `packages/client/vite.config.ts`
- `packages/client/index.html`
- `packages/client/.env.example`
- `packages/client/.env.development` (committed)
- `packages/client/src/config.ts`
- `packages/client/src/vite-env.d.ts`
- `packages/client/vercel.json`
- Placeholder `packages/client/src/main.tsx` and `App.tsx`

### Tasks
- `bun add` Vite, `@vitejs/plugin-react` in `packages/client`
- `vite.config.ts`:
  ```typescript
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  export default defineConfig({
    plugins: [react()],
    server: { port: 5173 }
  })
  ```
- `index.html` with `<div id="root"></div>` and `<script type="module" src="/src/main.tsx">`
- `vite-env.d.ts`:
  ```typescript
  /// <reference types="vite/client" />
  interface ImportMetaEnv {
    readonly VITE_SERVER_WS_URL: string
    readonly VITE_SERVER_HTTP_URL: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
  ```
- `config.ts`:
  ```typescript
  export const WS_URL = import.meta.env.VITE_SERVER_WS_URL ?? 'ws://localhost:3001'
  export const HTTP_URL = import.meta.env.VITE_SERVER_HTTP_URL ?? 'http://localhost:3001'
  ```
- `.env.example`:
  ```
  VITE_SERVER_WS_URL=wss://your-server.fly.dev
  VITE_SERVER_HTTP_URL=https://your-server.fly.dev
  ```
- `.env.development` (committed):
  ```
  VITE_SERVER_WS_URL=ws://localhost:3001
  VITE_SERVER_HTTP_URL=http://localhost:3001
  ```
- Update `packages/client/package.json` scripts: `"dev": "vite"`, `"build": "vite build"`, `"test": "tsc --noEmit && vite build"` (test must catch build failures)
- `vercel.json` at `packages/client/`:
  ```json
  {
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
  ```
- Placeholder `main.tsx` and `App.tsx` rendering `<div>Loading...</div>`

### Acceptance Criteria
```bash
cd packages/client && bun run build   # exits 0, produces dist/index.html
cd packages/client && bun run dev     # starts vite dev server on :5173
# Open http://localhost:5173 in browser → see "Loading..."
```
- `dist/` directory with `index.html` and hashed JS/CSS assets
- `tsc --noEmit` exits 0 (vite-env.d.ts makes `import.meta.env` typed)
- `WS_URL` falls back to `ws://localhost:3001` when env var absent

### Out of Scope
- Real React components

---

## Milestone 8 — Vercel Deploy Configuration (Workspace Awareness)

### Objective
Configure Vercel to correctly install workspace dependencies. This is infrastructure-only — no functional changes.

### Deliverables
- Updated `packages/client/vercel.json`
- Root `vercel.json` (project root)
- Documentation in `packages/client/README.md` for Vercel setup

### Tasks
- Vercel needs to be told the project root and workspace structure. There are two valid approaches; this plan uses the **root deployment approach**:
- Create root `vercel.json`:
  ```json
  {
    "buildCommand": "cd packages/client && bun run build",
    "installCommand": "bun install",
    "outputDirectory": "packages/client/dist",
    "framework": null,
    "rewrites": [
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }
  ```
- Delete the per-package `packages/client/vercel.json` (root config supersedes it)
- Write `packages/client/README.md`:
  - "Deploy: connect repo to Vercel, set root to repo root (not packages/client), set environment variables `VITE_SERVER_WS_URL` and `VITE_SERVER_HTTP_URL` in Vercel dashboard"
  - Document that the root `vercel.json` handles workspace install correctly
- Verify locally that the build command produces `packages/client/dist`:
  ```bash
  rm -rf packages/client/dist
  cd packages/client && bun run build
  test -f packages/client/dist/index.html
  ```

### Acceptance Criteria
- Root `vercel.json` exists with correct `buildCommand`, `installCommand`, `outputDirectory`
- Running build from repo root produces `packages/client/dist/index.html`
- `packages/client/README.md` documents Vercel deploy steps

### Out of Scope
- Actual Vercel deploy (Milestone 14)

---

## Milestone 9 — CRDTManager and useCollab Hook

### Objective
Client-side state bridge with cached text, wire format conversion, environment-aware URLs, full reconnection logic.

### Deliverables
- `packages/client/src/crdt-manager.ts`
- `packages/client/src/use-collab.ts`

### Tasks
- `CRDTManager`:
  - Private fields: `doc: Document`, `vc: VectorClock`, `buffer: OperationBuffer`, `clientId: string`, `docId: string`, `lamportClock: bigint = 0n`, `ws: WebSocket | null = null`, `listeners: Set<() => void>`, `cachedText: string | null = null`
  - `constructor(clientId: string, docId: string)`
  - `localInsert(afterCharId: string, value: string): Operation`:
    - `this.lamportClock++`
    - `char = this.doc.insert(afterCharId, value, this.clientId, this.lamportClock)`
    - `this.cachedText = null`
    - `this.vc.update(this.clientId, this.lamportClock)`
    - Build `Operation`, `ws.send(JSON.stringify({ type: 'OP', op: toWire(op) }))`
    - `notify()`
  - `localDelete(charId: string): Operation` — same pattern with `doc.delete()`
  - `applyRemoteOp(op: Operation): void`:
    - `this.lamportClock = bigIntMax(this.lamportClock, op.lamportClock) + 1n`
    - If `vc.isReady(op)`: `applyOp(op)`, then `buffer.drain(vc).forEach(applyOp)`
    - Else: `buffer.add(op)`
    - `notify()`
  - Private `applyOp(op)`:
    - If `insert`: `doc.integrate(op.char)`
    - If `delete`: `doc.delete(charIdToString(op.char.id))`
    - `vc.update(op.clientId, op.lamportClock)`
    - `cachedText = null`
  - `initFromSnapshot(snapshot: SerializedDoc | null, ops: Operation[]): void`:
    - If snapshot: `this.doc = Document.deserialize(snapshot)`
    - For each op: `applyOp(op)`
    - `cachedText = null`
    - `notify()`
  - `getText(): string`:
    - If `cachedText !== null`: return it
    - Else: `cachedText = doc.getText()`, return it
  - `getCharIdAtIndex(i: number)`, `getIndexOfCharId(id: string)`, `getVectorClock(): Record<string, string>` (returns `vc.serialize()`)
  - `subscribe(fn: () => void): () => void` — returns unsubscribe
  - `setWs(ws: WebSocket | null): void`
  - `broadcastCursor(charId: string | null): void` — sends PRESENCE message
  - Private `notify()` — calls all listeners
- `useCollab(docId: string)`:
  - `clientId` from `localStorage.getItem('collab-client-id')` or generate via `crypto.randomUUID()` then store
  - Build WebSocket URL from `WS_URL` in `config.ts`: `${WS_URL}/doc/${docId}?clientId=${clientId}`
  - Reconnect with exponential backoff: `[1000, 2000, 4000, 8000, 16000]` ms, clamp at 16000
  - Status: `'connecting' | 'reconnecting' | 'connected' | 'offline'`
  - On `open`: status → `connected`, send `SYNC` with current `vc.serialize()`
  - Handle messages: convert all wire-format payloads via `fromWire`/`fromWireDoc` before passing to manager
    - `INIT`: `manager.initFromSnapshot(msg.snapshot ? fromWireDoc(msg.snapshot) : null, msg.ops.map(fromWire))`
    - `SYNC_RESPONSE`: `msg.ops.forEach(o => manager.applyRemoteOp(fromWire(o)))`
    - `OP`: `manager.applyRemoteOp(fromWire(msg.op))`
    - `PRESENCE`: update cursors state
    - `ACK`: optionally log/track
  - On `close`: status → `reconnecting` if retry attempts remain, else `offline`; schedule reconnect
  - Returns `{ manager, cursors: Record<string, CursorState>, status }`

### Acceptance Criteria
- `localInsert` reflected in `getText()` immediately, before ACK
- Op with unseen `leftId` dependency is buffered (verify via test exposing buffer size)
- `clientId` survives page refresh
- WebSocket reconnects after `ws.close()` within backoff window
- Status transitions correct: `connecting` → `connected` → `reconnecting` → `connected`
- `WS_URL` sourced from `config.ts` only — `grep -r "ws://" packages/client/src` finds no hardcoded URLs except in `config.ts`
- `cachedText` returns same reference until a mutation occurs (verify with `===` comparison after multiple `getText()` calls)

### Out of Scope
- Editor DOM rendering, history slider

---

## Milestone 10 — React Editor Component (Imperative DOM Strategy)

### Objective
Editor that maps DOM events to CRDT ops, renders text imperatively (not via `dangerouslySetInnerHTML`), shows remote cursors. Cursor position survives remote edits.

### Deliverables
- `packages/client/src/Editor.tsx`
- `packages/client/src/App.tsx` (replace placeholder)
- Document creation flow in `App.tsx`

### Tasks
- `Editor.tsx` uses **imperative DOM updates**, not React's reconciliation, for the text content. This avoids the `dangerouslySetInnerHTML` cursor-loss problem.
  - Component renders a stable `contentEditable` div (the React tree never changes its children)
  - Subscribes to `manager` via `useEffect`: on every `manager.subscribe` notification, imperatively update the div's `textContent` to `manager.getText()`
  - Before each text update: capture caret offset via `getCaretOffset(div)`
  - After each text update: restore caret via `setCaretOffset(div, savedOffset)`
  - This means the `contentEditable` div is uncontrolled from React's perspective — React renders it once, the manager updates it imperatively
- Event handlers:
  - `handleBeforeInput`: prevent default, parse input type:
    - `insertText`: get caret offset, `afterId = manager.getCharIdAtIndex(offset - 1)` (or `START_ID` if offset 0), `manager.localInsert(afterId, e.data)`
    - `deleteContentBackward`: `charId = manager.getCharIdAtIndex(offset - 1)`, `manager.localDelete(charId)`
    - `deleteContentForward`: `charId = manager.getCharIdAtIndex(offset)`, `manager.localDelete(charId)`
    - `insertParagraph` / `insertLineBreak`: insert `'\n'` character via localInsert
  - `handleSelectionChange` (on document, not div): if selection inside our div, `charId = manager.getCharIdAtIndex(offset)`, `manager.broadcastCursor(charId)`
  - IME guard: track `isComposing` ref via `compositionstart`/`compositionend`. During composition, do not handle `beforeInput`. On composition end, take the composed text and call `localInsert` for each character.
- DOM utilities:
  - `getCaretOffset(el: HTMLElement): number` via `Range.cloneRange()` + `toString().length`
  - `setCaretOffset(el: HTMLElement, offset: number): void` via `TreeWalker` over text nodes
- Remote cursors: rendered as React-managed absolutely positioned `<span>` elements (these CAN use React because they're separate from the editable text). Position computed by:
  - `manager.getIndexOfCharId(cursor.charId)` → integer index
  - Walk text nodes to find DOM position at that index
  - Use `Range.getBoundingClientRect()` to position the cursor span
- `readOnly` prop: when true, set `contentEditable={false}` on the div, disable all event handlers
- `App.tsx`:
  - On mount, read URL: `pathname = window.location.pathname.slice(1)`
  - If empty: `fetch(POST /docs)`, get `{ id }`, `window.history.replaceState({}, '', '/' + id)`, set state
  - Else: use pathname as docId
  - `const { manager, cursors, status } = useCollab(docId)`
  - Render:
    - Header with status badge (Connected/Reconnecting/Offline)
    - `<Editor manager={manager} cursors={cursors} readOnly={isHistoryView} />`
    - Placeholder for `<HistorySlider>` (Milestone 11)
- `main.tsx`: `createRoot(document.getElementById('root')!).render(<App />)`

### Acceptance Criteria
- Visit `http://localhost:5173/` → redirected to `/[uuid]`, see editor
- Open same URL in second tab → both load same (empty) doc
- Type in tab A → text appears in tab B in real time
- Caret stays at correct position during local typing (no flicker, no jumps)
- Type in tab A while tab B is mid-typing → both caret positions stable, no character loss
- Backspace and Delete work without skipping or doubling characters
- Remote cursor visible in tab A when tab B is connected, with correct color
- Remote cursor does not jump when typing above it
- IME composition (if testable) does not produce duplicate characters
- No React warnings or `contentEditable` warnings in console

### Out of Scope
- History slider
- Rich text formatting

---

## Milestone 11 — Fix PRESENCE Protocol

### Objective
The PRESENCE message format is inconsistent between the client sender, server receiver, and server broadcaster. Remote cursors never appear because the server silently drops malformed messages and `useCollab` never populates the cursors state. Fix all three layers so the full cursor lifecycle works: appear on connect, move on selection change, disappear on disconnect.

### Root Cause
Three separate mismatches exist:

| Layer | Current (broken) | Expected |
|---|---|---|
| `crdt-manager.ts` → server | `{ type:'PRESENCE', cursor:{ charId, name, clientId } }` | `{ type:'PRESENCE', charId, name }` |
| Server → other clients | `{ type:'PRESENCE', clientId, charId, color, name }` (flat) ✓ | same |
| `use-collab.ts` ← server | reads `msg.cursor` (always undefined) | reads flat `msg.clientId`, `msg.charId`, `msg.color`, `msg.name` |

The server's receive handler (`index.ts:101`) reads `msg.charId` (flat) — correct if client sends flat. The server broadcast (`index.ts:104-110`) is already flat and correct. Only the client send and client receive are wrong.

### Deliverables
- `packages/client/src/crdt-manager.ts` (modify)
- `packages/client/src/use-collab.ts` (modify)

### Tasks
- `crdt-manager.ts` — `broadcastCursor` method:
  - Replace `this.ws.send(JSON.stringify({ type: 'PRESENCE', cursor }))` with a flat send:
    ```typescript
    this.ws.send(JSON.stringify({ type: 'PRESENCE', charId, name: this.clientId.slice(0, 8) }))
    ```
  - Remove the `cursor` object construction entirely. The server derives `clientId` from `ws.data`, so there is no need to send it.
- `use-collab.ts` — `PRESENCE` case in `ws.onmessage`:
  - Remove the `msg.cursor` cast.
  - Read fields directly from `msg`:
    ```typescript
    case 'PRESENCE': {
      const clientId = msg.clientId as string | undefined
      if (!clientId) break
      const charId = (msg.charId as string | null) ?? null
      const color = (msg.color as string) ?? '#888888'
      const name = (msg.name as string) ?? ''
      setCursors(prev => {
        if (charId === null) {
          const next = { ...prev }
          delete next[clientId]
          return next
        }
        return { ...prev, [clientId]: { charId, color, name } }
      })
      break
    }
    ```

### Acceptance Criteria
```bash
bun run --filter='*' test   # exits 0, no regressions
```
- Open two browser tabs at the same doc URL
- Click in tab B → a colored cursor label appears in tab A at the correct character position
- Move caret in tab B → cursor in tab A follows
- Close tab B → cursor disappears from tab A
- No TypeScript errors in `crdt-manager.ts` or `use-collab.ts`

### Out of Scope
- Server changes (server protocol is already correct)
- History slider, Dockerfile, deploy

---

## Milestone 12 — History Slider

### Objective
Point-in-time replay UI using paginated op fetch.

### Deliverables
- `packages/client/src/HistorySlider.tsx`

### Tasks
- On mount: paginated fetch in a loop:
  ```typescript
  const allOps: WireOperation[] = []
  let offset = 0
  while (true) {
    const res = await fetch(`${HTTP_URL}/docs/${docId}/ops?limit=1000&offset=${offset}`)
    const page: WireOperation[] = await res.json()
    allOps.push(...page)
    if (page.length < 1000) break
    offset += 1000
  }
  setOps(allOps.map(fromWire))
  ```
- Show loading state while fetching
- `<input type="range" min={0} max={100}>` controlled
- On change: `opCount = Math.floor((pct / 100) * ops.length)`, build fresh `Document`, apply first `opCount` ops, set `previewText` and `previewTime` (`ops[opCount - 1].wallClock`)
- At 100%: clear `previewText`, set `isHistoryView` false
- Below 100%: set `isHistoryView` true, show banner "Viewing history at [time] — [Return to live]"
- Pass `isHistoryView` up to `App.tsx` via callback prop or shared state
- App passes `readOnly={isHistoryView}` to `<Editor>`
- When `isHistoryView`, manager.getText() does not control editor — instead, editor displays `previewText` (handled by App)

### Acceptance Criteria
- Slider at 0% → empty document displayed
- Slider at 50% → document state at halfway point
- Slider at 100% → live document, editing works
- Timestamp display updates as slider moves
- Typing while in history view has no effect
- Returning to live works without page refresh
- No hardcoded URLs — all use `HTTP_URL` from `config.ts`

### Out of Scope
- Branching from history, per-user filter

---

## Milestone 13 — Server Dockerization and Fly.io Config

### Objective
Make server deployable to Fly.io. Infrastructure only.

### Deliverables
- `packages/server/Dockerfile`
- `packages/server/fly.toml`
- `packages/server/.dockerignore`
- `packages/server/README.md` with deploy commands

### Tasks
- `Dockerfile`:
  ```dockerfile
  FROM oven/bun:1-alpine AS base
  WORKDIR /app
  
  # Copy lockfile and workspace manifests first for cache
  COPY package.json bun.lockb turbo.json tsconfig.base.json ./
  COPY packages/crdt/package.json ./packages/crdt/package.json
  COPY packages/server/package.json ./packages/server/package.json
  
  # Install all workspace deps (crdt has no runtime deps, server has postgres)
  RUN bun install --frozen-lockfile
  
  # Copy source
  COPY packages/crdt ./packages/crdt
  COPY packages/server ./packages/server
  
  EXPOSE 3001
  CMD ["bun", "run", "packages/server/src/index.ts"]
  ```
- `.dockerignore`: `node_modules`, `**/node_modules`, `.env`, `.env.*`, `dist`, `**/*.test.ts`, `packages/client`
- `fly.toml`:
  ```toml
  app = "collab-editor-server"
  primary_region = "iad"
  
  [build]
  
  [http_service]
    internal_port = 3001
    force_https = true
    auto_stop_machines = true
    auto_start_machines = true
    min_machines_running = 0
    # WebSocket support: http_service handles ws/wss upgrade automatically
    # No additional config needed for WebSocket
    
    [[http_service.checks]]
      interval = "30s"
      timeout = "5s"
      grace_period = "10s"
      method = "GET"
      path = "/health"
  
  [[vm]]
    memory = "256mb"
    cpu_kind = "shared"
    cpus = 1
  ```
- `packages/server/README.md` documents:
  - `fly launch` from this directory
  - `fly secrets set DATABASE_URL=... CORS_ORIGIN=... COMPACTION_THRESHOLD=10000`
  - `fly deploy`

### Acceptance Criteria
```bash
cd packages/server
docker build -t collab-server -f Dockerfile ../..   # exits 0 (note: build context is repo root)
docker run -e DATABASE_URL="$DATABASE_URL" -e CORS_ORIGIN=* -e PORT=3001 -p 3001:3001 collab-server
# In another shell:
curl http://localhost:3001/health   # returns {"ok":true}
```
- Docker image builds without error
- Container starts and `/health` returns 200
- `fly.toml` has health check configured
- `packages/server/README.md` documents `fly secrets set` commands

### Notes for Claude Code
The Docker build context must be the **repo root**, not `packages/server`. The Dockerfile uses paths relative to repo root because it copies the workspace lockfile and the `crdt` package. Adjust the build command accordingly: `docker build -t collab-server -f packages/server/Dockerfile .` (run from repo root).

### Out of Scope
- Actual deploy (Milestone 15)

---

## Milestone 14 — Benchmarks

### Objective
Produce real benchmark numbers against real database.

### Deliverables
- `packages/server/scripts/benchmark.ts`

### Tasks
- Script accepts `DATABASE_URL` from env, throws if missing
- Creates test document via `db.createDocument()`
- Inserts 10,000 ops directly via `db.persistOp()` in batches of 500 (use Promise.all per batch for speed)
  - Each op is a sequential insert of a random character at the end of the previous char
  - Use a single fixed `clientId` for benchmark
- Measure 1: time `loader.load(docId)` before any compaction → record `loadWithoutSnapshot`
- Trigger `maybeCompact(docId, db)` with `process.env.COMPACTION_THRESHOLD = '1'` set
- Measure 2: time `loader.load(docId)` after compaction → record `loadWithSnapshot`
- Insert 1000 more ops (now snapshot exists, these are delta)
- Measure 3: time reconnect sync — `loader.load(docId, vectorClockMissingMostRecent1000Ops)` → record `reconnectSync`
- Measure 4: time of `maybeCompact` itself → record `compactionTime`
- Print results table to stdout
- Cleanup: `DELETE FROM documents WHERE id = $testDocId` (cascade deletes ops + snapshots)
- On error: still attempt cleanup before exit

### Acceptance Criteria
```bash
cd packages/server && DATABASE_URL=$DATABASE_URL bun run scripts/benchmark.ts
# Exits 0, prints table
```
- Table shows `loadWithSnapshot` ≥ 5× faster than `loadWithoutSnapshot`
- Test doc removed from DB after run (verify with `SELECT count(*) FROM documents WHERE title LIKE 'benchmark-%'`)

### Out of Scope
- README updates (Milestone 15)

---

## Milestone 15 — Deploy and README

### Objective
Deploy server to Fly.io, deploy client to Vercel, verify live, write README.

### Deliverables
- Live server URL (Fly.io)
- Live client URL (Vercel)
- `README.md` at repo root

### Tasks
**Database:**
- Apply schema to production Supabase: `psql $PROD_DATABASE_URL -f packages/server/sql/schema.sql`

**Server deploy:**
- From `packages/server`: `fly launch` (use existing `fly.toml`, do not overwrite)
- `fly secrets set DATABASE_URL="$PROD_DATABASE_URL" CORS_ORIGIN="*" COMPACTION_THRESHOLD=10000`
  - Use `*` initially, restrict to Vercel URL after client deploys
- `fly deploy`
- Verify: `curl https://[fly-url]/health` returns `{"ok":true}`
- Verify: WebSocket connection from browser dev tools succeeds

**Client deploy:**
- Connect repo to Vercel (web UI)
- Set Vercel project settings:
  - Root directory: repo root (NOT packages/client — root vercel.json handles routing)
  - Environment variables: `VITE_SERVER_WS_URL=wss://[fly-url]`, `VITE_SERVER_HTTP_URL=https://[fly-url]`
- Deploy via Vercel UI or `vercel --prod` from repo root
- Verify: client loads at Vercel URL
- Verify: open dev tools, WebSocket connects to wss://[fly-url], no CORS errors
- Verify: `POST /docs` from client succeeds (no CORS error)

**Tighten CORS:**
- `fly secrets set CORS_ORIGIN="https://[vercel-url]"`
- `fly deploy` to apply
- Verify client still works after CORS tightening

**README at repo root:**
- Demo GIF at top: two browser tabs side-by-side, real-time sync visible, history slider used
- Architecture diagram PNG (Excalidraw export)
- Benchmark results table from Milestone 13 output
- Live URL link
- Tech stack list
- Local setup section:
  ```
  1. Clone repo
  2. bun install
  3. Set up Supabase, get DATABASE_URL
  4. cp packages/server/.env.example packages/server/.env (fill in DATABASE_URL)
  5. psql $DATABASE_URL -f packages/server/sql/schema.sql
  6. Terminal 1: cd packages/server && bun run src/index.ts
  7. Terminal 2: cd packages/client && bun run dev
  8. Open http://localhost:5173 — auto-creates document and redirects
  ```
- Section "Known Limitations" listing the 4 items from ARCHITECTURE.md

### Acceptance Criteria
- `curl https://[fly-url]/health` → `{"ok":true}`
- Two tabs at live Vercel URL: typing in one appears in the other
- History slider works on live URL
- No CORS errors in browser console
- README contains: demo GIF, architecture diagram, benchmark table, live URL, setup, known limitations

### Out of Scope
- Custom domain
- CI/CD
- Tombstone GC

---

## Milestone 16 — Encryption Primitives in CRDT Package

### Objective
Add Web Crypto API wrappers as a pure-functional module in `packages/crdt`. KDF, encrypt, decrypt, verifier — fully tested in isolation. No UI, no server, no schema changes yet. Existing 33 tests must continue to pass with no modifications.

### Deliverables
- `packages/crdt/src/crypto.ts` — KDF, encrypt, decrypt, verifier functions
- `packages/crdt/src/crypto-types.ts` — `EncryptionVersion`, `WireEncryptedChar` if needed (probably not — `WireChar` already extended in this milestone)
- `packages/crdt/tests/crypto.test.ts` — round-trip, deterministic nonce, verifier, wrong-password tests
- Updated `packages/crdt/src/types.ts` — add `encryptedValue: string | null` to `Char`, add `EncryptionVersion` and `DocumentMetadata` types
- Updated `packages/crdt/src/wire.ts` — add `encryptedValue` field to `WireChar`, update `toWire`/`fromWire`/`toWireDoc`/`fromWireDoc` to pass it through

### Tasks
- Implement `crypto.ts` with these exported functions:
  ```typescript
  export async function deriveMasterKey(
    password: string,
    salt: Uint8Array,
    iterations: number
  ): Promise<CryptoKey>

  export async function deriveSubKey(
    masterKey: CryptoKey,
    purpose: 'op-encryption' | 'verifier' | 'snapshot-encryption'
  ): Promise<CryptoKey>

  export async function encryptValue(
    value: string,
    opKey: CryptoKey,
    charId: CharId
  ): Promise<string>  // base64

  export async function decryptValue(
    ciphertext: string,
    opKey: CryptoKey,
    charId: CharId
  ): Promise<string>

  export async function createVerifier(masterKey: CryptoKey): Promise<string>

  export async function verifyPassword(
    password: string,
    salt: Uint8Array,
    iterations: number,
    expectedVerifier: string
  ): Promise<{ valid: boolean; masterKey?: CryptoKey }>

  export function generateSalt(): Uint8Array  // 32 bytes
  ```
- Use `crypto.subtle` from the global `crypto` object — works in both Bun (server-side tests) and browser
- Constants in module:
  - `KDF_ITERATIONS_DEFAULT = 600000`
  - `SALT_BYTES = 32`
  - `NONCE_BYTES = 12`
  - `VERIFIER_CONSTANT = 'collab-editor-verifier-v1'`
- Update `Char` type in `types.ts`:
  ```typescript
  export interface Char {
    id: CharId
    value: string | null
    encryptedValue: string | null   // NEW
    leftId: CharId | null
    rightId: CharId | null
    isDeleted: boolean
  }
  ```
- Update `WireChar` correspondingly. `toWire` / `fromWire` / `charToWire` / `charFromWire` must pass `encryptedValue` through unchanged.
- Update existing tests in `document.test.ts` and `wire.test.ts` to construct `Char` objects with `encryptedValue: null`. **No test logic changes — only object literals updated to include the new field.** This is the only modification to M1-M3 work.
- Write `crypto.test.ts` with these test cases:
  - `deriveMasterKey` produces deterministic output for same password+salt+iterations
  - `encryptValue` followed by `decryptValue` round-trips correctly
  - `encryptValue` with same value, opKey, charId produces identical ciphertext (deterministic nonce)
  - `encryptValue` with different charId produces different ciphertext (different nonce)
  - `decryptValue` with wrong key throws `OperationError`
  - `createVerifier` produces deterministic output for same masterKey
  - `verifyPassword` with correct password returns `{ valid: true, masterKey: <key> }`
  - `verifyPassword` with wrong password returns `{ valid: false }` and does not throw
  - `generateSalt` produces 32 unique random bytes (run twice, assert different)
- Add new exports to `packages/crdt/src/index.ts`

### Acceptance Criteria
```bash
turbo test   # all 33 existing tests + ~9 new crypto tests pass
turbo build  # exit 0
```
- `crypto.ts` is fully self-contained — no imports from server or client
- All existing tests still pass after `Char` type extension (the new `encryptedValue: null` field is the only diff)
- Crypto tests run in under 30 seconds total (mostly PBKDF2 cost)
- 600k PBKDF2 iterations complete in under 2 seconds on modern CPU

### Out of Scope
- UI components
- Server changes
- Schema changes
- React context

---

## Milestone 17 — Database Schema Migration and Encrypted Op Persistence

### Objective
Apply backward-compatible schema migration. Server can persist and retrieve encrypted ops. Plaintext docs continue to work unchanged.

### Deliverables
- `packages/server/sql/migration_001_encryption.sql` — idempotent ALTER TABLE statements
- `packages/server/sql/schema.sql` — updated for fresh installs to include encryption columns from the start
- `packages/server/src/db.ts` — extended with new methods, existing methods unchanged
- Updated `PersistedOp` type to include `encryptedValue: string | null`

### Tasks
- Write `migration_001_encryption.sql` with the additions documented in ARCHITECTURE.md "Schema Additions for Encryption"
- Update `schema.sql` so a fresh install gets the same end state as `schema.sql + migration_001`
- Add new methods to `Database` class in `db.ts`:
  ```typescript
  createEncryptedDocument(
    slug: string,
    salt: Uint8Array,
    verifier: string,
    kdfIterations: number
  ): Promise<{ id: string; slug: string }>

  getDocumentMetaBySlug(slug: string): Promise<DocumentMetadata | null>

  getDocumentEncryptionVersion(docId: string): Promise<EncryptionVersion>

  persistEncryptedOp(docId: string, op: Operation, seq: bigint): Promise<void>
  ```
- Modify `persistOp` (existing method) to route based on `documents.encryption_version`:
  - If version 0: write to `char_value` column (current behavior)
  - If version 1: write to `encrypted_value` column, leave `char_value` NULL
- Modify `getAllOps`, `getOpsSince`, `getOpsPage` to populate `encryptedValue` field when reading rows where it's non-null
- Update `PersistedOp` type to include `encryptedValue: string | null`
- Slug uniqueness: `createEncryptedDocument` catches `unique_violation` on slug column and returns a typed error result `{ error: 'slug_taken' }` instead of throwing

### Acceptance Criteria
- Migration applies cleanly to existing production DB:
  ```bash
  psql $DATABASE_URL -f packages/server/sql/migration_001_encryption.sql  # exits 0
  psql $DATABASE_URL -f packages/server/sql/migration_001_encryption.sql  # exits 0 again (idempotency)
  ```
- Existing plaintext document loads continue to return correct data — verify by curling production API for an existing M1-15 document
- New encrypted document insert: `createEncryptedDocument(slug, ...)` succeeds, `getDocumentMetaBySlug(slug)` returns the metadata
- Duplicate slug returns `{ error: 'slug_taken' }` not a thrown exception
- TypeScript compiles cleanly: `cd packages/server && bun tsc --noEmit` exits 0

### Out of Scope
- WebSocket protocol changes (Milestone 18)
- Client encryption logic (Milestone 19)
- Compaction changes (Milestone 18)

---

## Milestone 18 — Server Endpoints, Protocol Versioning, Compaction Update

### Objective
New REST endpoints for slug-based document creation and metadata fetch. WebSocket INIT message includes `encryptionVersion`. Compaction operates on encrypted ops as opaque blobs.

### Deliverables
- `packages/server/src/index.ts` — new endpoints `GET /docs/:slug/meta`, `POST /docs/encrypted`
- `packages/server/src/loader.ts` — `load()` returns `encryptionVersion` field
- `packages/server/src/compaction.ts` — verified to work on encrypted ops without modification (CRDT structural fields are plaintext)

### Tasks
- Implement `GET /docs/:slug/meta`:
  - Path param: slug
  - Returns 200 with `{ exists: true, salt: base64, verifier, kdfIterations, encryptionVersion, slug, id }` if slug exists
  - Returns 200 with `{ exists: false }` if slug does not exist (NOT 404 — distinguishing slug-doesnt-exist from server-error matters for the client UX)
  - Validate slug format: `[a-zA-Z0-9-]{1,64}`. Invalid format returns 400.
- Implement `POST /docs/encrypted`:
  - Body: `{ slug, salt, verifier, kdfIterations, encryptionVersion: 1 }`
  - Calls `db.createEncryptedDocument`
  - Returns 201 with `{ id, slug }` on success
  - Returns 409 with `{ error: 'slug_taken' }` on conflict
  - Returns 400 on invalid slug format or missing fields
- Update `loader.load()` to:
  - Read `documents.encryption_version` once
  - Include `encryptionVersion` in the returned shape
  - Pass through `encrypted_value` from ops untransformed
- Update INIT WebSocket message to include `encryptionVersion: 0 | 1` field
- Verify `compaction.ts` works without modification:
  - The `Document.integrate(char)` call only inspects `char.id`, `char.leftId`, `char.rightId`, `char.isDeleted`
  - It never touches `char.value` or `char.encryptedValue`
  - Snapshot serialization passes both fields through `toWireDoc`
  - **No code changes to compaction.ts.** This is the proof that the encryption design preserves server-side compaction.
- Add CORS preflight handling for new endpoints (OPTIONS returning 204)

### Acceptance Criteria
- `curl https://[server]/docs/nonexistent/meta` returns 200 with `{ exists: false }`
- `curl -X POST https://[server]/docs/encrypted -d '{slug, salt, verifier, kdfIterations, encryptionVersion: 1}'` returns 201 with `{ id, slug }`
- Same POST with same slug returns 409 with `{ error: 'slug_taken' }`
- `GET /docs/:slug/meta` for that slug now returns 200 with full metadata
- Compaction triggered on a doc with 100+ encrypted ops completes successfully (`log.info('compaction.complete', ...)` emitted)
- Server-side decryption attempt is impossible by inspection — `grep -r "decrypt" packages/server/src/` finds no matches
- All existing endpoints (`POST /docs`, `GET /docs/:docId/ops`, `GET /health`) work unchanged
- `bun tsc --noEmit` in packages/server exits 0

### Out of Scope
- Client-side encryption / decryption
- Password UI
- Decryption cache

---

## Milestone 19 — Client Encryption Integration

### Objective
Client encrypts before sending, decrypts on receive. Password UI flow. Decryption cache to keep render performance reasonable. Op batching to reduce timing leakage.

### Deliverables
- `packages/client/src/crypto-context.tsx` — React context with derived keys (memory only)
- `packages/client/src/PasswordPrompt.tsx` — password entry/creation UI
- `packages/client/src/SlugPicker.tsx` — slug entry + availability check
- `packages/client/src/crdt-manager.ts` — extended with optional `opKey`; encrypts/decrypts when present
- `packages/client/src/use-collab.ts` — handles `encryptionVersion` from INIT, op batching
- `packages/client/src/Editor.tsx` — async getText() path for encrypted docs
- `packages/client/src/App.tsx` — slug + password gating before EditorApp renders

### Tasks
- `crypto-context.tsx`:
  - React context exposing `{ opKey: CryptoKey | null, isUnlocked: boolean }`
  - Provider takes `masterKey: CryptoKey | null` and derives `opKey` via HKDF on mount
  - Keys are never persisted — destroyed when provider unmounts (page close, navigation)
- `SlugPicker.tsx`:
  - Renders when `pathname === '/'` or pathname is a UUID-format ID (legacy)
  - User enters slug in input, submits
  - Calls `GET /docs/:slug/meta`
  - On `{ exists: false }`: shows "claim this slug" UI with password creation
  - On `{ exists: true, encryptionVersion: 1 }`: shows password prompt to unlock existing doc
  - On `{ exists: true, encryptionVersion: 0 }`: redirects to legacy plaintext flow (this case shouldn't normally occur but handle gracefully)
  - On 400 (invalid slug): inline error message
- `PasswordPrompt.tsx`:
  - Two modes: `create` and `unlock`
  - `create` mode: two password fields (password + confirm), warning text "If you forget this password, the document cannot be recovered."
  - `unlock` mode: single password field
  - On submit:
    - Derives masterKey, computes verifier
    - `create`: generates salt, calls `POST /docs/encrypted`
    - `unlock`: constant-time compare verifier against fetched `meta.verifier`
  - Error states: wrong password, slug taken, network error
- Extend `CRDTManager`:
  - Constructor accepts optional `opKey: CryptoKey`
  - `localInsert` becomes async when `opKey` is set:
    - `encryptedValue = await encryptValue(value, opKey, charId)`
    - Set `char.encryptedValue = encryptedValue`, `char.value = null`
  - `applyRemoteOp` is unchanged — it integrates ops structurally without touching value
  - `getText` becomes async when `opKey` is set:
    - For each char, look up decryption cache `Map<charId, string>`
    - If miss: `await decryptValue(char.encryptedValue, opKey, char.id)`, store in cache
    - If hit: use cached value
  - Cache invalidation: on any mutation to a char (delete), remove its entry from cache
  - Subscribe/notify mechanism unchanged — but Editor's subscription handler must `await` the new async `getText`
- Extend `useCollab`:
  - Accept `opKey: CryptoKey | null` parameter
  - Pass `opKey` to CRDTManager constructor
  - INIT message: read `encryptionVersion` field; if 1 and no opKey, abort with error (should not happen — UI flow gates this)
  - **Op batching:** `localInsert` calls accumulate ops in a 100ms window before sending. Implementation: `batchTimerRef` set on first localInsert, fires `ws.send({ type: 'OP_BATCH', ops })`. Server-side: handle `OP_BATCH` by iterating ops with same flow as single OP.
- Update `Editor.tsx`:
  - Subscribe handler must handle async getText:
    ```typescript
    manager.subscribe(async () => {
      const text = await manager.getText()
      // existing imperative DOM update logic
    })
    ```
  - For initial render, await getText before first paint
- Update `App.tsx`:
  - Wrap `EditorApp` in `<CryptoProvider masterKey={masterKey}>` when slug + password flow completes
  - Show `<SlugPicker>` first, then `<PasswordPrompt>`, then `<EditorApp>`
  - URL `https://[client]/[uuid]` (legacy UUID format): bypass slug/password, render EditorApp with no crypto context — plaintext mode preserved
- Update server `index.ts` to handle `OP_BATCH` message type — iterate ops, persist each, broadcast each as individual `OP` to other clients

### Acceptance Criteria
- Two browser tabs at `/test-encrypted` with same password: real-time sync works, ciphertext visible in WebSocket frames in DevTools, plaintext visible in editor
- Two tabs same slug different passwords: second tab sees verifier mismatch, cannot unlock
- Reload tab: password prompt reappears (key not persisted)
- Existing plaintext URL `https://notgoogledocs.vercel.app/[existing-uuid]` continues to work without password prompt
- No ciphertext appears in browser console or React DevTools
- Wrong password rejected client-side without sending password to server (verify in Network tab — no password in any request)
- Op batching: typing 10 chars in <100ms produces a single `OP_BATCH` WebSocket frame, not 10 `OP` frames
- `bun tsc --noEmit` in packages/client exits 0
- `vite build` in packages/client exits 0

### Out of Scope
- Tombstone GC
- Block-based encryption optimization
- Key rotation
- Mobile UI

---

## Milestone 20 — Encrypted Deploy and README Update

### Objective
Apply migration to production. Deploy updated server and client. Update README with encryption flow and threat model. Verify the end-to-end encrypted experience on the live URLs.

### Deliverables
- Production database migrated via `migration_001_encryption.sql`
- Updated server deployed on Render
- Updated client deployed on Vercel
- `README.md` at repo root with encryption section, threat model summary, demo GIF
- Live verification of encrypted document flow

### Tasks
- **Database migration:**
  - Run `psql $PROD_DATABASE_URL -f packages/server/sql/migration_001_encryption.sql` against the production Supabase
  - Verify with `\d documents` and `\d operations` that new columns exist
  - Verify existing M1-15 documents still load: `curl https://notgoogledocs.onrender.com/docs/[existing-uuid]/ops?limit=5` returns expected data
- **Server deploy (Render):**
  - Push to main branch
  - Render auto-deploys
  - `curl https://notgoogledocs.onrender.com/health` returns `{"ok":true}`
  - `curl https://notgoogledocs.onrender.com/docs/test-slug/meta` returns `{"exists": false}`
- **Client deploy (Vercel):**
  - Push to main branch
  - Vercel auto-deploys
  - Visit `https://notgoogledocs.vercel.app/test-encrypted-001` — should show SlugPicker → PasswordPrompt
- **End-to-end verification:**
  - Open two browser tabs at `https://notgoogledocs.vercel.app/test-encrypted-002`
  - First tab: enter password, claim slug
  - Second tab: enter same password
  - Type in tab 1 → appears in tab 2
  - Open Network tab in DevTools, confirm WebSocket frames contain `encrypted_value` (base64 blobs), no plaintext
  - Open one tab with wrong password → rejected
- **README updates:**
  - Add "Encryption" section explaining slug + password flow
  - Add "Threat Model" subsection — what's protected, what's not
  - Add "Metadata Leakage" subsection — copy from ARCHITECTURE.md
  - Add demo GIF showing: visit URL → password prompt → editor → ciphertext in DevTools
  - Add new live URL examples (encrypted: `https://notgoogledocs.vercel.app/[slug]`, legacy: `https://notgoogledocs.vercel.app/[uuid]`)
  - Add "Password Recovery" warning section: **"If you forget the password, the document cannot be recovered. There is no reset."**
  - Update tech stack table to include "Web Crypto API (PBKDF2, AES-256-GCM, HKDF, HMAC-SHA256)"
- **Verify legacy compatibility one more time:**
  - Existing M1-15 plaintext URLs work without password prompt
  - Switching between legacy and encrypted URL works without browser refresh oddities

### Acceptance Criteria
- Migration applied to production with no downtime
- `https://notgoogledocs.onrender.com/health` → `{"ok":true}`
- `https://notgoogledocs.vercel.app/[new-slug]` → SlugPicker → password creation → editor
- Two tabs with same slug + password: real-time encrypted sync verified in DevTools
- Wrong password rejected client-side
- Existing plaintext URLs still work
- README contains: encryption section, threat model, metadata leakage, password warning, demo GIF, updated tech stack

### Out of Scope
- Custom domain
- Multi-region deploy
- Operational monitoring / alerting
- CI/CD pipeline
