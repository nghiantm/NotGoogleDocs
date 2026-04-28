import { describe, it, expect } from 'vitest'
import { toWire, fromWire, toWireDoc, fromWireDoc } from '../src/wire.js'
import type { Operation, SerializedDoc } from '../src/types.js'

describe('toWire / fromWire — Operation', () => {
  const op: Operation = {
    type: 'insert',
    char: {
      id: { clientId: 'c1', clock: 5n },
      value: 'a',
      leftId: { clientId: 'c1', clock: 4n },
      rightId: null,
      isDeleted: false
    },
    docId: 'doc-1',
    clientId: 'c1',
    lamportClock: 5n,
    wallClock: 1700000000000,
    seq: 42n
  }

  it('round-trips through toWire/fromWire', () => {
    expect(fromWire(toWire(op))).toEqual(op)
  })

  it('survives JSON.stringify + JSON.parse cycle', () => {
    const wire = toWire(op)
    const json = JSON.stringify(wire)
    const parsed = JSON.parse(json)
    const restored = fromWire(parsed)
    expect(restored).toEqual(op)
  })

  it('preserves bigint precision through JSON', () => {
    const big: Operation = {
      ...op,
      lamportClock: 99999999999999999n,
      seq: 12345678901234567n
    }
    const restored = fromWire(JSON.parse(JSON.stringify(toWire(big))))
    expect(restored.lamportClock).toBe(99999999999999999n)
    expect(restored.seq).toBe(12345678901234567n)
  })

  it('handles undefined seq correctly', () => {
    const noSeq: Operation = { ...op, seq: undefined }
    const restored = fromWire(JSON.parse(JSON.stringify(toWire(noSeq))))
    expect(restored.seq).toBeUndefined()
  })

  it('handles null leftId/rightId', () => {
    const nullSides: Operation = {
      ...op,
      char: { ...op.char, leftId: null, rightId: null }
    }
    expect(fromWire(toWire(nullSides))).toEqual(nullSides)
  })
})

describe('toWireDoc / fromWireDoc', () => {
  it('round-trips a SerializedDoc through JSON', () => {
    const doc: SerializedDoc = {
      chars: [
        {
          id: { clientId: 'c1', clock: 1n },
          value: 'h',
          leftId: null,
          rightId: null,
          isDeleted: false
        },
        {
          id: { clientId: 'c1', clock: 2n },
          value: 'i',
          leftId: { clientId: 'c1', clock: 1n },
          rightId: null,
          isDeleted: false
        }
      ],
      order: ['c1:1', 'c1:2']
    }
    const restored = fromWireDoc(JSON.parse(JSON.stringify(toWireDoc(doc))))
    expect(restored).toEqual(doc)
  })
})
