import { describe, it, expect } from 'vitest'
import { VectorClock } from '../src/vector-clock.js'
import { OperationBuffer } from '../src/operation-buffer.js'
import type { Operation, CharId } from '../src/types.js'

function makeCharId(clientId: string, clock: bigint): CharId {
  return { clientId, clock }
}

function makeOp(clientId: string, clock: bigint, leftId: CharId | null = null): Operation {
  return {
    type: 'insert',
    char: {
      id: makeCharId(clientId, clock),
      value: 'x',
      leftId,
      rightId: null,
      isDeleted: false,
    },
    docId: 'doc1',
    clientId,
    lamportClock: clock,
    wallClock: 0,
  }
}

describe('OperationBuffer', () => {
  it('drain releases ready ops and leaves unready ones', () => {
    const vc = new VectorClock()
    const buf = new OperationBuffer()

    const readyOp = makeOp('client-a', 1n, null)
    const blockedOp = makeOp('client-b', 2n, makeCharId('client-c', 99n))

    buf.add(readyOp)
    buf.add(blockedOp)

    const released = buf.drain(vc)
    expect(released).toHaveLength(1)
    expect(released[0]).toBe(readyOp)
    expect(buf.size()).toBe(1)
  })

  it('drain called twice does not return same ops', () => {
    const vc = new VectorClock()
    const buf = new OperationBuffer()
    buf.add(makeOp('client-a', 1n, null))

    const first = buf.drain(vc)
    expect(first).toHaveLength(1)

    const second = buf.drain(vc)
    expect(second).toHaveLength(0)
  })

  it('size decreases after drain', () => {
    const vc = new VectorClock()
    const buf = new OperationBuffer()
    buf.add(makeOp('client-a', 1n))
    buf.add(makeOp('client-b', 2n))
    expect(buf.size()).toBe(2)

    buf.drain(vc)
    expect(buf.size()).toBe(0)
  })

  it('blocked op becomes ready after vc update and second drain', () => {
    const vc = new VectorClock()
    const buf = new OperationBuffer()

    const blockedOp = makeOp('client-b', 1n, makeCharId('client-a', 5n))
    buf.add(blockedOp)

    expect(buf.drain(vc)).toHaveLength(0)
    expect(buf.size()).toBe(1)

    vc.update('client-a', 5n)
    const released = buf.drain(vc)
    expect(released).toHaveLength(1)
    expect(released[0]).toBe(blockedOp)
    expect(buf.size()).toBe(0)
  })
})
