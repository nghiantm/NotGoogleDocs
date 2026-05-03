import type { WireOperation, WireSerializedDoc, WireCharId } from '@collab/crdt'
import type { Database, PersistedOp } from './db.js'

function wireIdFromString(s: string): WireCharId {
  const sep = s.lastIndexOf(':')
  return { clientId: s.slice(0, sep), clock: s.slice(sep + 1) }
}

function persistedOpToWire(op: PersistedOp, docId: string): WireOperation {
  return {
    type: op.opType as 'insert' | 'delete',
    char: {
      id: wireIdFromString(op.charId),
      value: op.charValue,
      encryptedValue: null,
      leftId: op.leftId ? wireIdFromString(op.leftId) : null,
      rightId: op.rightId ? wireIdFromString(op.rightId) : null,
      isDeleted: op.isDeleted,
    },
    docId,
    clientId: op.clientId,
    lamportClock: op.lamportClock.toString(),
    wallClock: op.wallClock,
    seq: op.seq.toString(),
  }
}

export async function load(
  docId: string,
  db: Database,
  clientVectorClock?: Record<string, string>
): Promise<{ snapshot: WireSerializedDoc | null; ops: WireOperation[]; snapshotSeq: string }> {
  const snapshot = await db.getLatestSnapshot(docId)
  const snapshotSeq = snapshot?.snapshotSeq ?? 0n
  const persistedOps = await db.getOpsSince(docId, snapshotSeq)

  let ops = persistedOps.map(op => persistedOpToWire(op, docId))

  if (clientVectorClock) {
    ops = ops.filter(op => {
      const seen = clientVectorClock[op.clientId]
      return seen === undefined || BigInt(seen) < BigInt(op.lamportClock)
    })
  }

  return {
    snapshot: snapshot?.state ?? null,
    ops,
    snapshotSeq: snapshotSeq.toString(),
  }
}

export async function loadPage(
  docId: string,
  db: Database,
  limit: number,
  offset: number
): Promise<WireOperation[]> {
  const ops = await db.getOpsPage(docId, limit, offset)
  return ops.map(op => persistedOpToWire(op, docId))
}
