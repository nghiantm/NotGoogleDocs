# Architecture

> **Claude Code:** This file is read-only reference. Do NOT modify it during implementation.
> Read this file at the start of every session before touching any code.

---

## Purpose
A real-time collaborative plain-text document editor. Multiple users edit the same document simultaneously with guaranteed convergence and no data loss. The core conflict resolution (Sequence CRDT / RGA variant) is implemented from scratch — no y-js or similar libraries.

As of Milestone 16+, the editor also supports optional password-based end-to-end encryption inspired by ProtectedText.com: users pick a URL slug, set a password, and the server stores only ciphertext. Plaintext documents created before encryption was added continue to work unchanged.

---

## Threat Model

This section was added with the encryption work (Milestones 16-20). It applies to encrypted documents only.

### In scope
- **Honest-but-curious server operator.** Has full DB access and full server logs but follows the protocol. Cannot read document content.
- **Database breach.** Attacker obtains a snapshot of PostgreSQL but no live server access. Document content remains encrypted.
- **Network adversary on the wire.** TLS handles transport security; the encryption layer is defense-in-depth.

### Out of scope (documented in README)
- **Malicious server pushing modified JavaScript.** The server serves the JS that performs encryption — a compromised server can replace it. This is the fundamental limitation of all browser-based E2EE systems including ProtectedText.
- **Sophisticated traffic analysis** correlating users across documents.
- **Compromised client devices** (keyloggers, malware).
- **Weak passwords.** PBKDF2 with 600k iterations slows offline attacks but cannot make a 4-character password secure.

The threat model deliberately matches ProtectedText's. Going further (oblivious sync, post-quantum) is beyond scope for this project.

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

### Additions for Encryption (Milestones 16-20)

```
packages/crdt/src/
  ├── crypto.ts                # Web Crypto API wrappers — KDF, encrypt, decrypt, verifier
  └── crypto-types.ts          # WireEncryptedChar, WireEncryptedOperation types

packages/crdt/tests/
  └── crypto.test.ts           # Round-trip, deterministic nonce, verifier tests

packages/server/sql/
  └── migration_001_encryption.sql   # Idempotent ALTER TABLE additions

packages/client/src/
  ├── crypto-context.tsx       # React context providing derived keys (in-memory only)
  ├── PasswordPrompt.tsx       # Password entry / creation UI
  └── SlugPicker.tsx           # URL slug entry + availability check
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

## Encryption Architecture

This section applies to documents created with `encryption_version >= 1`. Documents with `encryption_version = 0` (the default for all docs from Milestones 1-15) continue to operate in plaintext mode unchanged.

### Key Derivation
- **KDF:** PBKDF2-HMAC-SHA256
- **Iterations:** 600,000 (OWASP 2023 recommendation for PBKDF2-SHA256)
- **Salt:** 32 bytes from `crypto.getRandomValues`, generated once at document creation, stored server-side as `documents.salt BYTEA`
- **Master key length:** 256 bits

The salt is **not secret** — it's a public input to the KDF that prevents rainbow tables. It's served by `GET /docs/:slug/meta` before any encryption happens.

### Subkey Derivation
Master key is never used directly for encryption. Three purpose-specific subkeys are derived via HKDF-SHA256 with domain-separation `info` strings:
- `"collab-editor:v1:op-encryption"` — encrypts character values
- `"collab-editor:v1:verifier"` — produces the password verifier
- `"collab-editor:v1:snapshot-encryption"` — reserved for future use

### Cipher
- **Algorithm:** AES-256-GCM
- **Nonce:** 12 bytes, **deterministic**, derived as `SHA-256(charIdToString(char.id)).slice(0, 12)`
- **Authentication tag:** 16 bytes (default GCM)
- **Why deterministic nonce is safe:** AES-GCM nonce reuse with the same key is catastrophic. Because CharIds are globally unique by construction (clientId + Lamport clock), nonces derived from them are guaranteed unique without storing them separately.

### Encryption Granularity
Per-character encryption applied to the `value` field only. CRDT structural metadata stays plaintext:

| Field | Plaintext or Ciphertext |
|---|---|
| `char.id` (clientId, clock) | Plaintext |
| `char.value` (the actual character) | **Ciphertext** |
| `char.leftId`, `char.rightId` | Plaintext |
| `char.isDeleted` | Plaintext |
| `op.lamportClock`, `op.seq`, `op.wallClock` | Plaintext |

Encrypting structural fields would prevent the server from running compaction. The metadata leakage is documented under "Metadata Leakage" below and acknowledged honestly in the README.

### Password Verification
Verifier is `HMAC-SHA256("collab-editor-verifier-v1", verifierKey)`, base64-encoded. Stored as `documents.verifier`.

Client verification flow:
1. Client fetches `{ salt, kdfIterations, verifier }` from `GET /docs/:slug/meta`
2. Client derives master key from password + salt + iterations
3. Client derives verifier subkey via HKDF
4. Client computes its own verifier from the constant string
5. Constant-time compares against server's stored verifier
6. Match → password correct, proceed; mismatch → reject

This avoids a known-plaintext oracle: an attacker stealing the verifier from the database can run an offline dictionary attack, but PBKDF2 with 600k iterations makes each guess take ~1 second on a modern CPU.

### Key Lifetime
- Keys are imported as **non-extractable** `CryptoKey` objects via Web Crypto API
- Keys live in **memory only** — never written to localStorage, sessionStorage, or IndexedDB
- Reload = re-derive from password (re-prompt user)
- Browser tab close = key gone

This is a deliberate UX tradeoff for security. Users know they need to remember the password.

### Encryption Version Field
`documents.encryption_version SMALLINT` controls behavior:
- `0` → plaintext mode (default for legacy docs from M1-15)
- `1` → AES-256-GCM with the parameters above

Documents are **immutable in their encryption mode**. There is no migration path from 0 to 1 or vice versa. New encrypted docs use version 1; legacy docs stay version 0 forever.

---

## URL Slug System

Added in Milestone 17 to support ProtectedText-style URL-based document access.

### Slug Format
- Pattern: `[a-zA-Z0-9-]{1,64}`
- Stored in `documents.slug VARCHAR(64) UNIQUE` (nullable for legacy docs)
- The existing `documents.id UUID` remains the primary key; slug is a separate unique alias

### Slug Lifecycle
1. User visits `https://[client]/[slug]`
2. Client calls `GET /docs/:slug/meta`
3. If `{ exists: false }`: client shows password creation UI, then `POST /docs/encrypted` to claim the slug
4. If `{ exists: true }`: client shows password prompt, derives key, verifies, then connects via WebSocket

### Slug Conflicts
`POST /docs/encrypted` returns 409 Conflict if slug is taken. The client surfaces this and prompts for a different slug.

### Legacy URL Compatibility
URLs of the form `https://[client]/[uuid]` continue to work for plaintext documents created before M17. The client distinguishes by checking the format: UUIDs match the standard regex, slugs do not.

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

### Encrypted document creation path (added M17-19)
```
User visits /[slug]
  → fetch GET /docs/:slug/meta
  → if { exists: false }:
      → SlugPicker shows password creation UI
      → user enters password, confirms
      → client generates: salt = crypto.getRandomValues(32 bytes)
      → masterKey = deriveMasterKey(password, salt, 600000)
      → verifierKey = deriveSubKey(masterKey, 'verifier')
      → verifier = HMAC(verifierKey, 'collab-editor-verifier-v1')
      → fetch POST /docs/encrypted { slug, salt, verifier, kdfIterations: 600000, encryptionVersion: 1 }
      → server returns { id, slug } or 409 if slug taken
      → opKey = deriveSubKey(masterKey, 'op-encryption') stored in CryptoContext (memory only)
      → useCollab(slug, opKey)
  → if { exists: true, salt, verifier, ... }:
      → PasswordPrompt UI shown
      → user enters password
      → client derives masterKey, computes own verifier
      → constant-time compare against server's verifier
      → mismatch → reject, do not connect
      → match → opKey stored in CryptoContext, useCollab(slug, opKey)
```

### Encrypted write path (added M19)
```
User keystroke
  → Editor captures input event, gets caret offset
  → manager.localInsert(afterId, value)
      → if cryptoContext present:
          → encryptedValue = await encryptValue(value, opKey, charId)
          → char.encryptedValue = encryptedValue, char.value = null
        else (legacy plaintext):
          → char.value = value, char.encryptedValue = null
      → Document.insert() integrates the char structurally
      → invalidate cachedText (for plaintext) or invalidate cachedDecryption[charId] (for encrypted)
      → ws.send({ type: 'OP', op: toWire(op) })  — server sees encrypted_value as base64 blob
  → Server receives OP, routes by document's encryption_version:
      → encryption_version = 0: persist to char_value column (legacy path)
      → encryption_version = 1: persist to encrypted_value column, char_value stays NULL
      → broadcast unchanged — server treats encrypted_value as opaque
```

### Encrypted read path (added M19)
```
INIT message arrives with encryptionVersion field
  → if encryptionVersion === 1:
      → manager initialized with opKey from CryptoContext
      → getText() becomes async — decrypts each character on first read
      → decryptionCache: Map<charId, string> avoids per-render decryption cost
      → Editor's manager.subscribe callback awaits getText() before updating div.textContent
  → if encryptionVersion === 0:
      → existing synchronous getText() path unchanged
```

### Encrypted compaction path (added M18)
```
maybeCompact runs server-side without ever decrypting
  → fetch all ops for docId (encrypted_value column populated, char_value NULL)
  → replay into fresh Document():
      → doc.integrate(char) called with encryptedValue intact, value=null
      → CRDT integrate() only acts on structural fields (leftId, rightId, id)
      → integrate() never inspects value or encryptedValue
  → wireDoc = toWireDoc(doc.serialize())
  → db.writeSnapshot(docId, lastSeq, wireDoc) — snapshot contains ciphertext blobs
  → log.info('compaction.complete', ...) — same as plaintext path
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
  value: string | null               // null = tombstone (plaintext mode)
                                     // also null when encryptedValue is set (encrypted mode)
  encryptedValue: string | null      // base64 ciphertext (encrypted mode); null for plaintext docs
                                     // ADDED M16. Existing M1-15 ops have this as null.
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

// ADDED M16-17 — Encryption-related types

export type EncryptionVersion = 0 | 1   // 0 = plaintext (legacy), 1 = AES-256-GCM

export interface DocumentMetadata {
  slug: string                       // URL-safe identifier
  salt: string                       // base64, 32 bytes
  kdfIterations: number              // 600000
  verifier: string                   // base64, HMAC-SHA256 result
  encryptionVersion: EncryptionVersion
  createdAt: string                  // ISO timestamp
}
```

### Wire types (in `packages/crdt/src/wire.ts`)
```typescript
// Same shapes but with bigint fields as string
export interface WireCharId { clientId: string; clock: string }
export interface WireChar {
  id: WireCharId
  value: string | null
  encryptedValue: string | null      // ADDED M16 — base64 ciphertext or null
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

### Schema Additions for Encryption (Milestone 17)

These are applied via `packages/server/sql/migration_001_encryption.sql`. All `IF NOT EXISTS` for idempotency. Existing columns and rows are untouched — backward compatible with all M1-15 data.

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS slug VARCHAR(64) UNIQUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS salt BYTEA;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kdf_iterations INTEGER DEFAULT 600000;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verifier TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_version SMALLINT DEFAULT 0 NOT NULL;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS encrypted_value TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(slug) WHERE slug IS NOT NULL;
```

**Routing rule:** Server reads `documents.encryption_version` once per request and routes accordingly:
- `encryption_version = 0`: read/write `operations.char_value` (legacy path, unchanged)
- `encryption_version = 1`: read/write `operations.encrypted_value`, `char_value` always NULL

`char_value` and `encrypted_value` are mutually exclusive per row. Documents are immutable in their mode, so a single document never mixes the two columns.

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
- Authentication or user accounts (password is per-document, not per-user)
- Multiple documents per user in UI
- Mobile browser support
- Tombstone garbage collection — designed, not implemented
- S3 / object storage — PostgreSQL JSONB only
- Redis for presence — in-memory server Map only
- Custom domains
- CI/CD pipeline

### Encryption-specific Non-Goals (M16-20)

- **Password reset / recovery.** If you forget the password, the document is unrecoverable. This is by design.
- **Password change.** Would require re-encrypting the entire op log. Out of scope. New password = new document.
- **Block-based encryption optimization.** Per-character encryption is used despite higher decryption cost. Block-based would be a v2 optimization.
- **Snapshot blob encryption.** Snapshots contain individually-encrypted character values, not a single re-encrypted blob.
- **Argon2id KDF.** PBKDF2 is used because Web Crypto supports it natively. Argon2id would require a 200KB WASM bundle.
- **Constant-size padding** of ciphertext to hide message length.
- **Defense against malicious server pushing modified JS.** Inherent limitation of browser-based E2EE.

---

## Known Limitations (Documented, Accepted)

These are real limitations that should be acknowledged in the README and in interview discussions, not silently ignored.

1. **Snapshot size grows with edit history, not live document size.** Without tombstone GC, a 100k-edit document accumulates a large JSONB snapshot even if the live text is short. For a demo project this is acceptable. In production this would require causal GC via vector clocks.
2. **Initial INIT message can be large for heavily-edited documents.** Bun's WebSocket frame limit is 16MB by default. The plan does not address chunking for documents that exceed this — accept this as a known limit and choose `COMPACTION_THRESHOLD` low enough to keep snapshots small.
3. **History slider fetches full op log on mount.** Paginated fetching mitigates the per-request size, but for very long-lived documents this is still a multi-second mount. Acceptable for demo.
4. **`integrate()` is O(n) per concurrent insertion at the same position.** A skip list would improve this. Not implemented.
5. **Encrypted document load is O(n) async decryptions** (added M19). For a 10k-char document, ~500ms initial decrypt latency. Mitigated by per-character decryption cache so it's a one-time cost. Block-based encryption would reduce this but is out of scope.
6. **Encrypted snapshots cannot be decompressed by the server.** Compaction works structurally but the snapshot still grows with edit history. Same compaction tradeoff as plaintext, just on opaque blobs.

---

## Metadata Leakage (Encrypted Documents Only)

This section is mandatory reading and must be reflected in the README. Honest documentation of what the server can and cannot see is the difference between marketing E2EE and lying about E2EE.

### What the server inevitably sees

| Leaked metadata | Can be reduced? |
|---|---|
| Document exists at slug `/my-notes` | No — it's the URL |
| Number of operations in document | No |
| Op timing (typing rhythm) | Partial — 100ms client-side batching |
| Number of distinct clients editing | No |
| Approximate document length (op count - tombstones) | No |
| Op log structure (which char references which leftId) | No — required for CRDT |
| Approximate edit patterns (insert-heavy vs delete-heavy) | No |
| Salt, kdfIterations, verifier | By design — these are public KDF inputs |

### What the server does NOT see

- Actual character values typed
- Whether the document contains real text vs gibberish
- Document language
- Specific words or content
- The password (never sent to server)
- Derived keys (never leave the browser)

### Mitigations Implemented

- **Op batching.** Client buffers ops for 100ms before sending, so the server sees "8 chars in this batch" rather than 8 timestamped events. Implemented in M19.
- **Deterministic nonces from charId.** No nonce field on the wire; saves bandwidth and prevents nonce-reuse bugs.

### Mitigations NOT Implemented (Out of Scope)
- Constant-size padding of ciphertext
- Decoy ops to hide edit patterns
- Onion routing or mix networks for connection-level anonymity

### Honest Marketing Language for the README

> *"Document content is encrypted in your browser before being sent to the server. The server stores and synchronizes only ciphertext and cannot read what you type. The server does see metadata: when you're editing, how many edits, document length in characters, and the URL slug. This is the same model as ProtectedText.com. If you forget the password, the document cannot be recovered."*

This is accurate. Don't claim more than this.

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

### Encryption Principles (Added M16-20)

13. **Encryption is opt-in per document via `encryption_version`.** Plaintext documents continue to work. Encrypted documents cannot be downgraded. The mode is fixed at creation time.
14. **Server treats `encrypted_value` as opaque.** Server never decrypts. Server's only job for encrypted ops is to assign sequence numbers, persist ciphertext blobs, and broadcast them.
15. **Keys live in memory only.** Non-extractable `CryptoKey` objects, re-derived from password on every page load. No `localStorage` / `sessionStorage` of keys, ever. Reload = re-prompt.
16. **CRDT structural metadata stays plaintext.** Per-character encryption applies only to `value`. `leftId`, `rightId`, `charId`, `isDeleted` remain readable by the server because they are required for compaction.
17. **Deterministic nonces from CharIds.** AES-GCM nonces are derived as `SHA-256(charIdToString).slice(0, 12)`. Globally-unique CharIds guarantee globally-unique nonces, which is required for AES-GCM safety.
18. **Document mode is immutable.** No re-encryption, no key rotation, no password change — these would require re-encrypting the entire op log. New password = new document.
