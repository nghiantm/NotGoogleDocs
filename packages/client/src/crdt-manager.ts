import {
  Document,
  VectorClock,
  OperationBuffer,
  charIdToString,
  bigIntMax,
  toWire,
  encryptValue,
  decryptValue,
  type WireOperation,
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
  private sendFn: ((wireOp: WireOperation) => void) | null = null
  private listeners: Set<() => void | Promise<void>> = new Set()
  private cachedText: string | null = null
  private opKey: CryptoKey | null = null
  private decryptionCache: Map<string, string> = new Map()

  constructor(clientId: string, docId: string) {
    this.clientId = clientId
    this.docId = docId
    this.doc = new Document()
    this.vc = new VectorClock()
    this.buffer = new OperationBuffer()
  }

  setOpKey(key: CryptoKey | null): void {
    this.opKey = key
    this.cachedText = null
    this.decryptionCache.clear()
    this.notify()
  }

  setSendFn(fn: ((wireOp: WireOperation) => void) | null): void {
    this.sendFn = fn
  }

  async localInsert(afterCharId: string, value: string): Promise<Operation> {
    this.lamportClock++

    if (this.opKey) {
      // Encrypt before inserting so the char is never in the doc with plaintext value
      const tempId = { clientId: this.clientId, clock: this.lamportClock }
      const encrypted = await encryptValue(value, this.opKey, tempId)

      const char = this.doc.insert(afterCharId, value, this.clientId, this.lamportClock)
      // Nullify plaintext immediately after structural insertion
      char.value = null
      char.encryptedValue = encrypted
      this.decryptionCache.set(charIdToString(char.id), value)
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
      this.sendFn?.(toWire(op))
      this.notify()
      return op
    }

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
    this.sendFn?.(toWire(op))
    this.notify()
    return op
  }

  async localDelete(charId: string): Promise<Operation> {
    this.lamportClock++
    const char = this.doc.delete(charId)
    this.cachedText = null
    this.decryptionCache.delete(charId)
    this.vc.update(this.clientId, this.lamportClock)

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
    this.sendFn?.(toWire(op))
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
      const key = charIdToString(op.char.id)
      this.doc.delete(key)
      this.decryptionCache.delete(key)
    }
    this.vc.update(op.clientId, op.lamportClock)
    this.cachedText = null
  }

  initFromSnapshot(snapshot: SerializedDoc | null, ops: Operation[]): void {
    if (snapshot) {
      this.doc = Document.deserialize(snapshot)
      // Compaction folds ops into the snapshot without a trace in `ops`, so
      // without this the vc never marks those clientId/clock pairs as seen —
      // any later op whose leftId/rightId points into pre-snapshot history
      // would then buffer forever, since isReady() can never become true.
      for (const char of snapshot.chars) {
        this.vc.update(char.id.clientId, char.id.clock)
      }
    }
    for (const op of ops) {
      this.applyOp(op)
    }
    this.cachedText = null
    this.notify()
  }

  async getText(): Promise<string> {
    if (!this.opKey) {
      if (this.cachedText !== null) return this.cachedText
      this.cachedText = this.doc.getText()
      return this.cachedText
    }

    if (this.cachedText !== null) return this.cachedText

    const { chars, order } = this.doc.serialize()
    const charMap = new Map(chars.map(c => [charIdToString(c.id), c]))
    const parts: string[] = []

    for (const id of order) {
      if (id === Document.START_ID || id === Document.END_ID) continue
      const char = charMap.get(id)
      if (!char || char.isDeleted) continue

      let plaintext = this.decryptionCache.get(id)
      if (plaintext === undefined) {
        plaintext = await decryptValue(char.encryptedValue!, this.opKey, char.id)
        this.decryptionCache.set(id, plaintext)
      }
      parts.push(plaintext)
    }

    this.cachedText = parts.join('')
    return this.cachedText
  }

  // Synchronous access to last-cached text — for event handlers that can't await
  getTextSync(): string {
    return this.cachedText ?? ''
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

  subscribe(fn: () => void | Promise<void>): () => void {
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
    this.listeners.forEach(fn => void fn())
  }
}

// Re-export so App.tsx can use CursorState without a separate import
export type { CursorState }
