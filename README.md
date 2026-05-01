# NotGoogleDocs

A real-time collaborative plain-text editor. Multiple users edit the same document simultaneously with guaranteed convergence and no data loss. The conflict-resolution engine (Sequence CRDT / RGA variant) is implemented from scratch — no y-js or similar libraries.

**[Live Demo →](https://notgoogledocs.vercel.app)**

---

<!-- Replace with a demo GIF: two browser tabs side-by-side, real-time sync and history slider visible -->
![Demo](docs/demo.gif)

---

## Architecture

<!-- Replace with an Excalidraw export PNG showing: Client ↔ Bun WS Server ↔ Supabase PostgreSQL, with CRDT package shared by both -->
![Architecture](docs/architecture.png)

### How it works

Each keystroke produces a CRDT **Operation** — an insert or delete tagged with a `(clientId, lamportClock)` pair. The server assigns a monotonic `seq` number and broadcasts the op to all peers. Every client independently integrates ops into a local `Document` using the RGA algorithm, which guarantees that all replicas converge to the same text regardless of arrival order.

Causal ordering is enforced via a `VectorClock`: an op that references a character not yet seen is held in an `OperationBuffer` until its dependency arrives.

```
User keystroke
  → Editor captures beforeInput
  → manager.localInsert(afterCharId, char)
      → Document.insert() → Char placed in CRDT order
      → ws.send({ type: 'OP', op: toWire(op) })
  → Server: nextSeq() (atomic PL/pgSQL), persistOp(), broadcast to peers, ACK
  → Remote clients: fromWire(op) → applyRemoteOp() → re-render
```

Background snapshot compaction keeps INIT payloads small: after every `COMPACTION_THRESHOLD` ops, the full document state is replayed into a fresh `Document`, serialized to JSONB, and written as a new snapshot row. Future loads return `snapshot + delta ops` instead of the full op log.

---

## Benchmark Results

Measured against a Supabase PostgreSQL instance with 10,000 ops and `COMPACTION_THRESHOLD=1`.

| Measurement | Time |
|---|---|
| Load without snapshot (10k ops replay) | ~TBD ms |
| Compaction (10k → snapshot) | ~TBD ms |
| Load with snapshot (snapshot + 1k delta) | ~TBD ms |
| Reconnect sync (1k missing ops) | ~TBD ms |

*Run `DATABASE_URL=... bun run packages/server/scripts/benchmark.ts` after deploy to fill in real numbers.*

---

## Tech Stack

| Layer | Technology |
|---|---|
| CRDT engine | TypeScript, custom RGA implementation |
| Server | Bun, built-in WebSocket (`Bun.serve`) |
| Client | React 19, Vite 8, TypeScript |
| Database | PostgreSQL via Supabase (JSONB snapshots, append-only op log) |
| Server deploy | Render |
| Client deploy | Vercel |
| Monorepo | Turborepo + Bun workspaces |

---

## Local Setup

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1, [PostgreSQL client](https://www.postgresql.org/download/) (`psql`), a [Supabase](https://supabase.com) project (free tier works).

```bash
# 1. Clone
git clone https://github.com/your-username/NotGoogleDocs.git
cd NotGoogleDocs

# 2. Install dependencies
bun install

# 3. Create packages/server/.env from the example
cp packages/server/.env.example packages/server/.env
# Fill in DATABASE_URL with your Supabase connection string:
# postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require

# 4. Apply the schema (idempotent — safe to re-run)
psql $DATABASE_URL -f packages/server/sql/schema.sql

# 5. Start the server (Terminal 1)
cd packages/server && bun run src/index.ts

# 6. Start the client dev server (Terminal 2)
cd packages/client && bun run dev

# 7. Open http://localhost:5173
#    → auto-creates a document and redirects to /[uuid]
#    → open the same URL in a second tab to test real-time sync
```

---

## Deploying

See the step-by-step guide below, or read:
- `packages/server/README.md` — Fly.io server deploy
- `packages/client/README.md` — Vercel client deploy

---

## Known Limitations

These are real constraints, acknowledged rather than silently ignored:

1. **Snapshot size grows with edit history, not live document size.** Without tombstone garbage collection, a 100k-edit document accumulates a large JSONB snapshot even if the live text is short. In production this would require causal GC via vector clocks.

2. **Initial INIT message can be large for heavily-edited documents.** Bun's WebSocket frame limit is 16 MB by default. The server does not chunk INIT payloads — choose `COMPACTION_THRESHOLD` low enough to keep snapshots manageable.

3. **History slider fetches the full op log on mount.** Paginated fetching (`limit=1000`) mitigates per-request size, but for very long-lived documents this is still a multi-second mount. Acceptable for a demo.

4. **`integrate()` is O(n) per concurrent insertion at the same position.** A skip list would improve this. Not implemented.
