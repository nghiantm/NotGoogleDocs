import {
  Document,
  VectorClock,
  OperationBuffer,
  charIdToString,
  bigIntMax,
  toWire,
  type Operation,
  type SerializedDoc,
  type CursorState,
} from '@collab/crdt'

export class CRDTManager {
  private doc: Document
  private vc: VectorClock
  private buffer: OperationBuffer
  private clientId: string
  private docId: string
  private lamportClock: bigint = 0n
  private ws: WebSocket | null = null
  private listeners: Set<() => void> = new Set()
  private cachedText: string | null = null

  constructor(clientId: string, docId: string) {
    this.clientId = clientId
    this.docId = docId
    this.doc = new Document()
    this.vc = new VectorClock()
    this.buffer = new OperationBuffer()
  }

  localInsert(afterCharId: string, value: string): Operation {
    this.lamportClock++
    const char = this.doc.insert(afterCharId, value, this.clientId, this.lamportClock)
    this.cachedText = null
    this.vc.update(this.clientId, this.lamportClock)
    const op: Operation = {
      type: 'insert',
      char,
      docId: this.docId,
      clientId: this.clientId,
      lamportClock: this.lamportClock,
      wallClock: Date.now(),
    }
    this.ws?.send(JSON.stringify({ type: 'OP', op: toWire(op) }))
    this.notify()
    return op
  }

  localDelete(charId: string): Operation {
    this.lamportClock++
    const char = this.doc.delete(charId)
    this.cachedText = null
    this.vc.update(this.clientId, this.lamportClock)

    // Build a minimal Char for the delete op — value/leftId/rightId not needed for delete
    const charForOp = char ?? {
      id: { clientId: this.clientId, clock: this.lamportClock },
      value: null,
      encryptedValue: null,
      leftId: null,
      rightId: null,
      isDeleted: true,
    }
    const op: Operation = {
      type: 'delete',
      char: charForOp,
      docId: this.docId,
      clientId: this.clientId,
      lamportClock: this.lamportClock,
      wallClock: Date.now(),
    }
    this.ws?.send(JSON.stringify({ type: 'OP', op: toWire(op) }))
    this.notify()
    return op
  }

  applyRemoteOp(op: Operation): void {
    this.lamportClock = bigIntMax(this.lamportClock, op.lamportClock) + 1n
    if (this.vc.isReady(op)) {
      this.applyOp(op)
      this.buffer.drain(this.vc).forEach(o => this.applyOp(o))
    } else {
      this.buffer.add(op)
    }
    this.notify()
  }

  private applyOp(op: Operation): void {
    if (op.type === 'insert') {
      this.doc.integrate(op.char)
    } else {
      this.doc.delete(charIdToString(op.char.id))
    }
    this.vc.update(op.clientId, op.lamportClock)
    this.cachedText = null
  }

  initFromSnapshot(snapshot: SerializedDoc | null, ops: Operation[]): void {
    if (snapshot) {
      this.doc = Document.deserialize(snapshot)
    }
    for (const op of ops) {
      this.applyOp(op)
    }
    this.cachedText = null
    this.notify()
  }

  getText(): string {
    if (this.cachedText !== null) return this.cachedText
    this.cachedText = this.doc.getText()
    return this.cachedText
  }

  getCharIdAtIndex(i: number): string {
    return this.doc.getCharIdAtIndex(i)
  }

  getIndexOfCharId(id: string): number {
    return this.doc.getIndexOfCharId(id)
  }

  getVectorClock(): Record<string, string> {
    return this.vc.serialize()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  setWs(ws: WebSocket | null): void {
    this.ws = ws
  }

  broadcastCursor(charId: string | null): void {
    if (!this.ws) return
    this.ws.send(JSON.stringify({
      type: 'PRESENCE',
      charId,
      name: this.clientId.slice(0, 8),
    }))
  }

  private notify(): void {
    this.listeners.forEach(fn => fn())
  }
}
