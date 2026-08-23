import { fromWire, toWire, type WireOperation } from '@collab/crdt'
import { Database } from './db.js'
import { Rooms } from './rooms.js'
import { load, loadPage } from './loader.js'
import { log } from './log.js'
import { maybeCompact } from './compaction.js'

type WSData = { docId: string; clientId: string }

const db = new Database()
const rooms = new Rooms()

const allowedOrigins = (process.env.CORS_ORIGIN ?? '*').split(',').map(o => o.trim())

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// documents.id (UUID) is the real key everywhere in the DB layer, but slug-based
// (encrypted) docs are addressed by documents.slug on the wire — resolve here once.
async function resolveDocId(idOrSlug: string): Promise<string | null> {
  if (UUID_RE.test(idOrSlug)) return idOrSlug
  return db.resolveSlugToId(idOrSlug)
}

function corsHeaders(origin: string | null) {
  const allowOrigin = allowedOrigins.includes('*')
    ? '*'
    : origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function jsonResponse(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

const server = Bun.serve<WSData>({
  port: parseInt(process.env.PORT ?? '3001'),

  async fetch(req, server) {
    const url = new URL(req.url)
    const { method } = req
    const origin = req.headers.get('origin')

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (url.pathname.startsWith('/doc/')) {
      const docId = await resolveDocId(url.pathname.slice(5))
      if (!docId) return new Response('Document not found', { status: 404, headers: corsHeaders(origin) })
      const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID()
      if (server.upgrade(req, { data: { docId, clientId } })) return new Response(null)
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    if (method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true }, 200, origin)
    }

    if (method === 'POST' && url.pathname === '/docs') {
      const doc = await db.createDocument()
      return jsonResponse(doc, 201, origin)
    }

    const opsMatch = url.pathname.match(/^\/docs\/([^/]+)\/ops$/)
    if (method === 'GET' && opsMatch) {
      const docId = await resolveDocId(opsMatch[1])
      if (!docId) return jsonResponse([], 200, origin)
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '1000'), 5000)
      const offset = parseInt(url.searchParams.get('offset') ?? '0')
      const wireOps = await loadPage(docId, db, limit, offset)
      return jsonResponse(wireOps, 200, origin)
    }

    const slugMetaMatch = url.pathname.match(/^\/docs\/([^/]+)\/meta$/)
    if (method === 'GET' && slugMetaMatch) {
      const slug = slugMetaMatch[1]
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(slug)) {
        return jsonResponse({ error: 'invalid_slug' }, 400, origin)
      }
      const meta = await db.getDocumentMetaBySlug(slug)
      if (!meta) return jsonResponse({ exists: false }, 200, origin)
      return jsonResponse({ exists: true, ...meta }, 200, origin)
    }

    if (method === 'POST' && url.pathname === '/docs/encrypted') {
      const body = await req.json() as Record<string, unknown>
      const { slug, salt: saltBase64, verifier, kdfIterations, encryptionVersion } = body
      if (
        typeof slug !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(slug) ||
        typeof saltBase64 !== 'string' ||
        typeof verifier !== 'string' ||
        typeof kdfIterations !== 'number' ||
        encryptionVersion !== 1
      ) {
        return jsonResponse({ error: 'invalid_request' }, 400, origin)
      }
      const salt = Uint8Array.from(Buffer.from(saltBase64, 'base64'))
      const result = await db.createEncryptedDocument(slug, salt, verifier, kdfIterations)
      if ('error' in result) return jsonResponse({ error: 'slug_taken' }, 409, origin)
      return jsonResponse(result, 201, origin)
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders(origin) })
  },

  websocket: {
    async open(ws) {
      const { docId, clientId } = ws.data
      rooms.join(docId, clientId, ws)
      log.info('connection.open', { docId, clientId })
      try {
        const initData = await load(docId, db)
        ws.send(JSON.stringify({ type: 'INIT', ...initData }))
      } catch (err) {
        log.error('error.unhandled', { phase: 'init', docId, clientId, error: String(err) })
      }
    },

    async message(ws, raw) {
      const { docId, clientId } = ws.data
      try {
        const text = typeof raw === 'string' ? raw : raw.toString()
        const msg = JSON.parse(text)

        if (msg.type === 'OP') {
          const op = fromWire(msg.op as WireOperation)
          const seq = await db.nextSeq(docId)
          await db.persistOp(docId, op, seq)
          log.info('op.persisted', { docId, clientId, seq: seq.toString() })
          rooms.broadcast(docId, clientId, JSON.stringify({ type: 'OP', op: toWire({ ...op, seq }) }))
          ws.send(JSON.stringify({ type: 'ACK', seq: seq.toString() }))
          setImmediate(() => maybeCompact(docId, db))

        } else if (msg.type === 'OP_BATCH') {
          for (const wireOp of msg.ops as WireOperation[]) {
            const op = fromWire(wireOp)
            const seq = await db.nextSeq(docId)
            await db.persistOp(docId, op, seq)
            log.info('op.persisted', { docId, clientId, seq: seq.toString() })
            rooms.broadcast(docId, clientId, JSON.stringify({ type: 'OP', op: toWire({ ...op, seq }) }))
            ws.send(JSON.stringify({ type: 'ACK', seq: seq.toString() }))
          }
          setImmediate(() => maybeCompact(docId, db))

        } else if (msg.type === 'SYNC') {
          const vc = (msg.vectorClock ?? {}) as Record<string, string>
          const { ops } = await load(docId, db, vc)
          ws.send(JSON.stringify({ type: 'SYNC_RESPONSE', ops }))

        } else if (msg.type === 'PRESENCE') {
          const charId = (msg.charId as string | null) ?? null
          const name = (msg.name as string) ?? ''
          rooms.updatePresence(docId, clientId, charId, name)
          rooms.broadcast(docId, clientId, JSON.stringify({
            type: 'PRESENCE',
            clientId,
            charId,
            color: rooms.getColor(docId, clientId),
            name,
          }))
        }

      } catch (err) {
        log.error('error.unhandled', { docId, clientId, error: String(err) })
      }
    },

    close(ws) {
      const { docId, clientId } = ws.data
      const color = rooms.getColor(docId, clientId)
      rooms.broadcast(docId, clientId, JSON.stringify({
        type: 'PRESENCE',
        clientId,
        charId: null,
        color,
        name: '',
      }))
      rooms.leave(docId, clientId)
      log.info('connection.close', { docId, clientId })
    },
  },
})

log.info('server.listening', { port: server.port })
