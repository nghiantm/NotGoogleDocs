# Server — Deploy to Fly.io

## Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated
- A Supabase (or compatible PostgreSQL) database with the schema applied:
  ```bash
  psql $DATABASE_URL -f sql/schema.sql
  ```

## Deploy

All commands run from the **repo root** (not `packages/server`).

**1. Launch the app (first time only)**

```bash
fly launch --config packages/server/fly.toml
```

Accept the generated `fly.toml` or use the existing one — do not overwrite.

**2. Set secrets**

```bash
fly secrets set \
  DATABASE_URL="postgresql://..." \
  CORS_ORIGIN="https://your-vercel-app.vercel.app" \
  COMPACTION_THRESHOLD=10000
```

Use `CORS_ORIGIN=*` temporarily until the Vercel URL is known, then tighten it.

**3. Deploy**

```bash
fly deploy --config packages/server/fly.toml
```

**4. Verify**

```bash
curl https://collab-editor-server.fly.dev/health
# {"ok":true}
```

## Docker (local test)

Build context must be the **repo root** so the lockfile and `packages/crdt` are available:

```bash
docker build -t collab-server -f packages/server/Dockerfile .
docker run \
  -e DATABASE_URL="$DATABASE_URL" \
  -e CORS_ORIGIN="*" \
  -e PORT=3001 \
  -p 3001:3001 \
  collab-server
```

Then in another shell:

```bash
curl http://localhost:3001/health   # {"ok":true}
```

## Environment Variables

| Variable               | Required | Default | Description                              |
|------------------------|----------|---------|------------------------------------------|
| `DATABASE_URL`         | yes      | —       | PostgreSQL connection string             |
| `PORT`                 | no       | 3001    | HTTP/WebSocket listen port               |
| `CORS_ORIGIN`          | no       | `*`     | Allowed origin for CORS headers          |
| `COMPACTION_THRESHOLD` | no       | 10000   | Ops-since-snapshot before compaction     |
