# Architecture

> **Claude Code:** This file is read-only reference. Do NOT modify it during implementation.
> Read this file at the start of every session before touching any code.

---

## Purpose
A real-time collaborative plain-text document editor. Multiple users edit the same document simultaneously with guaranteed convergence and no data loss. The core conflict resolution (Sequence CRDT / RGA variant) is implemented from scratch — no y-js or similar libraries.

---

## Repository Layout

```
/
├── turbo.json
├── package.json                    # root workspace
├── tsconfig.base.json
├── bun.lockb                       # committed, source of truth for dependencies
├── packages/
│   ├── crdt/                       # pure logic, zero runtime dependencies
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── utils.ts
│   │   │   ├── document.ts
│   │   │   ├── vector-clock.ts
│   │   │   ├── operation-buffer.ts
│   │   │   └── index.ts
│   │   └── tests/
│   ├── server/                     # Bun WebSocket server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   ├── fly.toml
│   │   ├── .dockerignore
│   │   ├── .env.example
│   │   ├── README.md               # deploy instructions
│   │   ├── sql/
│   │   │   └── schema.sql          # idempotent schema (CREATE IF NOT EXISTS)
│   │   ├── scripts/
│   │   │   └── benchmark.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── db.ts
│   │       ├── rooms.ts
│   │       ├── loader.ts
│   │       ├── compaction.ts
│   │       └── log.ts              # structured logging helper
│   └── client/                     # React + TypeScript + Vite
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── vercel.json
│       ├── .env.example
│       ├── .env.development        # committed, dev defaults
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── Editor.tsx
│           ├── HistorySlider.tsx
│           ├── crdt-manager.ts
│           ├── use-collab.ts
│           ├── config.ts
│           └── vite-env.d.ts       # ImportMetaEnv type declarations
```

---

## Module Responsibilities

### `packages/crdt`
- **Owns:** All CRDT logic — `Document`, `VectorClock`, `OperationBuffer`, all shared types and utilities
- **Must NOT:** Import from `packages/server` or `packages/client`, use Node/Bun/browser APIs, produce side effects
- **Constraint:** Zero runtime dependencies. `devDependencies` only (vitest, typescript)

### `packages/server`
- **Owns:** WebSocket server, room management, op persistence, sequence assignment, document load, snapshot compaction, CORS headers, DB connection pooling, structured logging
- **Must NOT:** Contain React code, contain CRDT conflict resolution logic (delegates to `packages/crdt` for replay only)
- **Runtime:** Bun

### `packages/client`
- **Owns:** React UI, DOM↔CRDT event mapping, WebSocket lifecycle, cursor rendering, history slider, environment-aware WebSocket URL
- **Must NOT:** Import from `packages/server` internals, contain persistence logic, contain sequence assignment logic

---

## Internal Storage Conventions (Critical)

These conventions exist to prevent subtle bugs around bigint equality and CharId comparison.

### CharId Storage Rule
The `Document` class stores characters in `Map<string, Char>` keyed by `charIdToString(char.id)`. Internally, all lookups use **string keys**, never `CharId` objects.

Conversion happens at exactly two boundaries:
1. **Inbound:** When constructing a `Char` from an external string ID (e.g., `insert(afterId: string, ...)`), the string is converted via `stringToCharId` only when storing in `Char.leftId`/`rightId` fields (which are typed as `CharId`).
2. **Outbound:** When serializing for the wire or DB, `Char.leftId.clientId` and `Char.leftId.clock` are read directly — no string conversion.

**Why:** `bigint` equality fails with `===` between objects (`{clock: 1n} !== {clock: 1n}`). All comparisons that matter happen on string keys, where equality is well-defined.

### BigInt Wire Format Rule
JSON cannot represent `bigint`. Every layer that crosses a JSON boundary must serialize `bigint` to string and deserialize back.

Layers that cross JSON boundaries:
- `Document.serialize()` → `Document.deserialize()` (in-memory → JSONB)
- WebSocket message payloads (server ↔ client)
- `db.writeSnapshot()` (Document state → JSONB column)

Layers that do NOT need conversion (driver handles it):
- `postgres` package with `types: { bigint: postgres.BigInt }` configured returns `BIGINT` columns as native `bigint`
- Native column reads/writes for `lamport_clock`, `seq`, `wall_clock` columns

**Implementation:** `Char` and `Operation` types use `bigint` in TypeScript. A separate `WireChar` and `WireOperation` type uses `string` for clock fields. Conversion functions `toWire(char): WireChar` and `fromWire(wire): Char` live in `packages/crdt/src/wire.ts`.

---

## Data Flow

### Write path (user types)
```
User keystroke
  → Editor captures keydown/input event
  → getCaretOffset() → integer DOM position
  → manager.getCharIdAtIndex(pos) → CharId string
  → manager.localInsert(afterId, value)
      → increment lamportClock
      → Document.insert() → Char
      → invalidate cachedText
      → VectorClock.update()
      → ws.send({ type: 'OP', op: toWire(op) })
      → notify() → React re-render
  → Server receives OP
      → wireOp = msg.op  (still in wire format)
      → op = fromWire(wireOp)
      → db.nextSeq(docId) → seq (atomic, returned as bigint)
      → db.persistOp(op with seq)
      → rooms.broadcast(toWire(op)) to other clients
      → ws.send({ type: 'ACK', seq: seq.toString() })
  → Remote clients receive OP (wire format)
      → op = fromWire(msg.op)
      → manager.applyRemoteOp(op)
          → update lamportClock (max(local, remote) + 1n)
          → vc.isReady(op) ? integrate : buffer.add
          → buffer.drain(vc) after each integrate
          → invalidate cachedText
          → notify() → React re-render
```

### Read path (user opens document)
```
Client WebSocket connects /doc/:docId?clientId=xxx
  → Server: db.getLatestSnapshot(docId)  (returns wire format from JSONB)
  → Server: db.getOpsSince(docId, snapshot.snapshotSeq)
  → Server sends INIT { snapshot: WireSerializedDoc, ops: WireOp[], snapshotSeq: string }
  → Client: snapshot ? Document.deserialize(fromWireDoc(snapshot)) : new Document()
  → Client: applyOp(fromWire(op)) for each delta op
  → notify()
```

### Document creation path (no docId in URL)
```
App.tsx mounts, reads window.location.pathname
  → if pathname is '/' or empty
      → fetch POST /docs → { id, title }
      → window.history.replaceState({}, '', `/${id}`)
      → re-read pathname
  → useCollab(docId)
```

### Offline reconnect path
```
WebSocket reconnects after close
  → Client sends SYNC { vectorClock: vc.serialize() }  (string values)
  → Server: deserialize vc, db.getOpsSince filtered by vectorClock per clientId
  → Server sends SYNC_RESPONSE { ops: WireOp[] }
  → manager applies each op via applyRemoteOp(fromWire(op))
```

### Compaction path (background)
```
After each persisted OP message:
  setImmediate(() => maybeCompact(docId, db))
    → opsSinceSnapshot = db.getOpCount(docId) - (snapshot?.snapshotSeq ?? 0n)
    → if opsSinceSnapshot < COMPACTION_THRESHOLD: return
    → fetch all ops for docId
    → replay into fresh Document()
    → wireDoc = toWireDoc(doc.serialize())
    → db.writeSnapshot(docId, lastSeq, wireDoc)
    → log.info('compaction.complete', { docId, opCount, durationMs })
    → future loader.load() returns snapshot + delta
```

### History fetch path
```
HistorySlider mounts
  → fetch GET /docs/:docId/ops?limit=1000&offset=0
  → repeat with offset += 1000 until response.length < 1000
  → store accumulated ops (in wire format, converted on use)
  → slider change → replay ops[0..N] into fresh Document()
```

---

## Dependency Rules

| Package | May import from | Must NOT import from |
|---|---|---|
| `packages/crdt` | nothing | server, client, Node APIs, browser APIs |
| `packages/server` | `packages/crdt` | `packages/client`, React |
| `packages/client` | `packages/crdt` | `packages/server` internals |

---

## Canonical Type Definitions
> Defined once in `packages/crdt/src/types.ts`. Imported everywhere. Never redefined.

```typescript
export type ClientId = string        // uuid v4
export type Clock = bigint           // Lamport logical clock — bigint, NOT number

export interface CharId {
  clientId: ClientId
  clock: Clock
}

export interface Char {
  id: CharId
  value: string | null               // null = tombstone
  leftId: CharId | null
  rightId: CharId | null
  isDeleted: boolean
}

export interface Operation {
  type: 'insert' | 'delete'
  char: Char
  docId: string
  clientId: ClientId
  lamportClock: Clock
  wallClock: number                  // Date.now() — history UI only, never for ordering
  seq?: bigint                       // assigned by server after persist
}

export interface SerializedDoc {
  chars: Char[]
  order: string[]                    // ordered charIdToString values, includes tombstones
}

export interface CursorState {
  charId: string | null              // CRDT char ID anchor — NOT an integer offset
  color: string
  name: string
}
```

### Wire types (in `packages/crdt/src/wire.ts`)
```typescript
// Same shapes but with bigint fields as string
export interface WireCharId { clientId: string; clock: string }
export interface WireChar {
  id: WireCharId
  value: string | null
  leftId: WireCharId | null
  rightId: WireCharId | null
  isDeleted: boolean
}
export interface WireOperation { /* mirrors Operation, bigint → string */ }
export interface WireSerializedDoc { chars: WireChar[]; order: string[] }

export function toWire(op: Operation): WireOperation
export function fromWire(wire: WireOperation): Operation
export function toWireDoc(doc: SerializedDoc): WireSerializedDoc
export function fromWireDoc(wire: WireSerializedDoc): SerializedDoc
```

---

## Database Schema Summary
Full schema in `packages/server/sql/schema.sql`. Schema is idempotent — uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Safe to re-run.

| Table | Purpose |
|---|---|
| `documents` | Document metadata (id, title, created_at) |
| `operations` | Append-only operation log — never UPDATE or DELETE rows |
| `snapshots` | Compacted CRDT state stored as JSONB (wire format with string clocks) |
| `doc_sequences` | Monotonic per-document sequence counter |

Key DB function: `next_seq(doc_id UUID) → BIGINT` — atomic via `INSERT ... ON CONFLICT DO UPDATE`.

**Snapshot atomicity:** A single `INSERT INTO snapshots` is atomic at the row level — partial inserts produce no row. The loader picks the row with the highest `snapshot_seq` for a given `doc_id`. Latest-wins is correct because partial inserts cannot be the latest.

**DB pool:** max 10 connections. Supabase free tier allows 60.

**BigInt handling:** The `postgres` package is configured with `types: { bigint: postgres.BigInt }` so `BIGINT` columns return native `bigint` values, not strings. JSONB columns require manual wire format conversion (handled by `toWireDoc`/`fromWireDoc` from `packages/crdt`).

---

## Environment Variables

```bash
# packages/server/.env
DATABASE_URL=postgresql://...?sslmode=require
PORT=3001
COMPACTION_THRESHOLD=10000
CORS_ORIGIN=http://localhost:5173

# packages/client/.env (production via Vercel UI)
VITE_SERVER_WS_URL=wss://your-app.fly.dev
VITE_SERVER_HTTP_URL=https://your-app.fly.dev

# packages/client/.env.development (committed)
VITE_SERVER_WS_URL=ws://localhost:3001
VITE_SERVER_HTTP_URL=http://localhost:3001
```

---

## WebSocket URL Protocol Rule
- Development (`import.meta.env.DEV === true`): `ws://localhost:3001`
- Production: `VITE_SERVER_WS_URL` env var, must start with `wss://`
- Browsers block `ws://` from `https://` pages — this is not optional

---

## Package Manager
**Bun is the project's package manager.** All install commands use `bun install`. The committed lockfile is `bun.lockb`. Do not mix `npm` and `bun` install commands within the project — Bun is required because the server runtime is Bun and the Dockerfile uses `bun install --frozen-lockfile`.

---

## Non-Goals
- Rich text formatting — plain text only
- Authentication or user accounts
- Multiple documents per user in UI
- Mobile browser support
- Tombstone garbage collection — designed, not implemented
- S3 / object storage — PostgreSQL JSONB only
- Redis for presence — in-memory server Map only
- Custom domains
- CI/CD pipeline

---

## Known Limitations (Documented, Accepted)

These are real limitations that should be acknowledged in the README and in interview discussions, not silently ignored.

1. **Snapshot size grows with edit history, not live document size.** Without tombstone GC, a 100k-edit document accumulates a large JSONB snapshot even if the live text is short. For a demo project this is acceptable. In production this would require causal GC via vector clocks.
2. **Initial INIT message can be large for heavily-edited documents.** Bun's WebSocket frame limit is 16MB by default. The plan does not address chunking for documents that exceed this — accept this as a known limit and choose `COMPACTION_THRESHOLD` low enough to keep snapshots small.
3. **History slider fetches full op log on mount.** Paginated fetching mitigates the per-request size, but for very long-lived documents this is still a multi-second mount. Acceptable for demo.
4. **`integrate()` is O(n) per concurrent insertion at the same position.** A skip list would improve this. Not implemented.

---

## Design Principles

1. **CRDT package is pure.** Zero runtime deps. Tests run in isolation.
2. **String keys internally, CharId at boundaries.** All `Map` lookups use string keys. `CharId` objects exist only in `Char.leftId`/`Char.rightId` fields and at conversion boundaries. This avoids bigint equality bugs.
3. **Wire format is separate from runtime format.** `bigint` becomes `string` at every JSON boundary. `toWire`/`fromWire` are the only allowed conversions.
4. **Server assigns sequence, not clients.** `seq` is monotonic per document, assigned atomically server-side. Lamport clocks handle causal ordering. `seq` handles log replay ordering.
5. **Append-only operation log.** Never `UPDATE` or `DELETE` from `operations`.
6. **Snapshot stores CRDT state, not rendered text.** Snapshots must deserialize back into a live `Document`.
7. **Latest-wins snapshot semantics.** Snapshot row inserts are atomic at the DB level. The loader picks the row with the highest `snapshot_seq` per `doc_id`. No separate boundary table is needed.
8. **Cursor anchors are always CRDT IDs.** `CursorState.charId` is always a `charIdToString()` result.
9. **`wss://` in production, always.**
10. **Bounded DB connection pool.** `max: 10` is set explicitly.
11. **Cached text in CRDTManager.** `getText()` is called on every render. The CRDTManager caches the rendered string and invalidates on every mutation. `Document.getText()` itself is not cached — caching lives at the manager layer to avoid coupling.
12. **Bun is the project's package manager.** No `npm install` or `pnpm install` anywhere.
