import type { CharId, Char, Operation, SerializedDoc } from './types.js'

export interface WireCharId {
  clientId: string
  clock: string
}

export interface WireChar {
  id: WireCharId
  value: string | null
  encryptedValue: string | null
  leftId: WireCharId | null
  rightId: WireCharId | null
  isDeleted: boolean
}

export interface WireOperation {
  type: 'insert' | 'delete'
  char: WireChar
  docId: string
  clientId: string
  lamportClock: string
  wallClock: number
  seq?: string
}

export interface WireSerializedDoc {
  chars: WireChar[]
  order: string[]
}

export function charIdToWire(id: CharId): WireCharId {
  return { clientId: id.clientId, clock: id.clock.toString() }
}

export function charIdFromWire(wire: WireCharId): CharId {
  return { clientId: wire.clientId, clock: BigInt(wire.clock) }
}

export function charToWire(c: Char): WireChar {
  return {
    id: charIdToWire(c.id),
    value: c.value,
    encryptedValue: c.encryptedValue,
    leftId: c.leftId ? charIdToWire(c.leftId) : null,
    rightId: c.rightId ? charIdToWire(c.rightId) : null,
    isDeleted: c.isDeleted
  }
}

export function charFromWire(wire: WireChar): Char {
  return {
    id: charIdFromWire(wire.id),
    value: wire.value,
    encryptedValue: wire.encryptedValue,
    leftId: wire.leftId ? charIdFromWire(wire.leftId) : null,
    rightId: wire.rightId ? charIdFromWire(wire.rightId) : null,
    isDeleted: wire.isDeleted
  }
}

export function toWire(op: Operation): WireOperation {
  return {
    type: op.type,
    char: charToWire(op.char),
    docId: op.docId,
    clientId: op.clientId,
    lamportClock: op.lamportClock.toString(),
    wallClock: op.wallClock,
    seq: op.seq?.toString()
  }
}

export function fromWire(wire: WireOperation): Operation {
  return {
    type: wire.type,
    char: charFromWire(wire.char),
    docId: wire.docId,
    clientId: wire.clientId,
    lamportClock: BigInt(wire.lamportClock),
    wallClock: wire.wallClock,
    seq: wire.seq ? BigInt(wire.seq) : undefined
  }
}

export function toWireDoc(doc: SerializedDoc): WireSerializedDoc {
  return {
    chars: doc.chars.map(charToWire),
    order: doc.order
  }
}

export function fromWireDoc(wire: WireSerializedDoc): SerializedDoc {
  return {
    chars: wire.chars.map(charFromWire),
    order: wire.order
  }
}
