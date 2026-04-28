import { Document, stringToCharId, toWireDoc } from '@collab/crdt'
import type { Char } from '@collab/crdt'
import type { Database } from './db.js'
import { log } from './log.js'

export async function maybeCompact(docId: string, db: Database): Promise<void> {
  const threshold = parseInt(process.env.COMPACTION_THRESHOLD ?? '10000')
  const latestSnapshot = await db.getLatestSnapshot(docId)
  const latestSeq = await db.getLatestSeq(docId)
  const opsSinceSnapshot = latestSeq - (latestSnapshot?.snapshotSeq ?? 0n)

  if (opsSinceSnapshot < BigInt(threshold)) return

  const startTime = performance.now()
  const ops = await db.getAllOps(docId)
  const doc = new Document()

  for (const op of ops) {
    if (op.opType === 'insert') {
      const char: Char = {
        id: stringToCharId(op.charId),
        value: op.charValue,
        leftId: op.leftId ? stringToCharId(op.leftId) : null,
        rightId: op.rightId ? stringToCharId(op.rightId) : null,
        isDeleted: op.isDeleted,
      }
      doc.integrate(char)
    } else {
      doc.delete(op.charId)
    }
  }

  const wireDoc = toWireDoc(doc.serialize())
  await db.writeSnapshot(docId, latestSeq, wireDoc)
  log.info('compaction.complete', { docId, opCount: Number(latestSeq), durationMs: performance.now() - startTime })
}
