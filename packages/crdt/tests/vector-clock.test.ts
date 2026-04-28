import { describe, it, expect } from 'vitest'
import { VectorClock } from '../src/vector-clock.js'
import type { Operation, Char, CharId } from '../src/types.js'

function makeCharId(clientId: string, clock: bigint): CharId {
  return { clientId, clock }
}

function makeInsertOp(leftId: CharId | null, rightId: CharId | null): Operation {
  return {
    type: 'insert',
    char: {
      id: makeCharId('client-x', 1n),
      value: 'a',
      leftId,
      rightId,
      isDeleted: false,
    },
    docId: 'doc1',
    clientId: 'client-x',
    lamportClock: 1n,
    wallClock: 0,
  }
}

function makeDeleteOp(): Operation {
  return {
    type: 'delete',
    char: {
      id: makeCharId('client-x', 2n),
      value: null,
      leftId: null,
      rightId: null,
      isDeleted: true,
    },
    docId: 'doc1',
    clientId: 'client-x',
    lamportClock: 2n,
    wallClock: 0,
  }
}

describe('VectorClock', () => {
  it('isReady false when leftId dependency unseen', () => {
    const vc = new VectorClock()
    const op = makeInsertOp(makeCharId('client-a', 5n), null)
    expect(vc.isReady(op)).toBe(false)
  })

  it('isReady true after updating leftId dependency', () => {
    const vc = new VectorClock()
    const op = makeInsertOp(makeCharId('client-a', 5n), null)
    vc.update('client-a', 5n)
    expect(vc.isReady(op)).toBe(true)
  })

  it('isReady false when rightId dependency unseen', () => {
    const vc = new VectorClock()
    const op = makeInsertOp(null, makeCharId('client-b', 3n))
    expect(vc.isReady(op)).toBe(false)
  })

  it('isReady true for delete op with null leftId and rightId', () => {
    const vc = new VectorClock()
    const op = makeDeleteOp()
    expect(vc.isReady(op)).toBe(true)
  })

  it('isReady true for insert op with null leftId and rightId', () => {
    const vc = new VectorClock()
    const op = makeInsertOp(null, null)
    expect(vc.isReady(op)).toBe(true)
  })

  it('hasSeen returns false for unseen client', () => {
    const vc = new VectorClock()
    expect(vc.hasSeen('unknown-client', 1n)).toBe(false)
  })

  it('hasSeen returns true for seen clock and false for higher clock', () => {
    const vc = new VectorClock()
    vc.update('client-a', 10n)
    expect(vc.hasSeen('client-a', 10n)).toBe(true)
    expect(vc.hasSeen('client-a', 11n)).toBe(false)
  })

  it('serialization round-trip preserves bigint precision', () => {
    const vc = new VectorClock()
    const largeClock = 9007199254740993n
    vc.update('client-a', largeClock)
    const serialized = vc.serialize()
    const restored = VectorClock.deserialize(serialized)
    expect(restored.hasSeen('client-a', largeClock)).toBe(true)
    expect(restored.hasSeen('client-a', largeClock + 1n)).toBe(false)
  })

  it('clone is independent: mutating clone does not affect original', () => {
    const vc = new VectorClock()
    vc.update('client-a', 5n)
    const clone = vc.clone()
    clone.update('client-a', 99n)
    clone.update('client-b', 1n)
    expect(vc.hasSeen('client-a', 99n)).toBe(false)
    expect(vc.hasSeen('client-b', 1n)).toBe(false)
    expect(vc.hasSeen('client-a', 5n)).toBe(true)
  })
})
