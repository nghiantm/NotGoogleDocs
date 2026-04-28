import { describe, it, expect } from 'vitest'
import { Document } from '../src/document.js'

function makeDoc() {
  return new Document()
}

describe('Document', () => {
  it('basic insert ordering produces correct text', () => {
    const doc = makeDoc()
    const h = doc.insert(Document.START_ID, 'h', 'c1', 1n)
    const e = doc.insert(h.id.clientId + ':' + h.id.clock, 'e', 'c1', 2n)
    const l1 = doc.insert(e.id.clientId + ':' + e.id.clock, 'l', 'c1', 3n)
    const l2 = doc.insert(l1.id.clientId + ':' + l1.id.clock, 'l', 'c1', 4n)
    doc.insert(l2.id.clientId + ':' + l2.id.clock, 'o', 'c1', 5n)
    expect(doc.getText()).toBe('hello')
  })

  it('tombstone preserved in order after delete', () => {
    const doc = makeDoc()
    const char = doc.insert(Document.START_ID, 'x', 'c1', 1n)
    const charKey = char.id.clientId + ':' + char.id.clock
    const orderBefore = doc.serialize().order.length
    doc.delete(charKey)
    expect(doc.serialize().order.length).toBe(orderBefore)
    expect(doc.getText()).toBe('')
  })

  it('2-way convergence: cross-applied ops produce identical text', () => {
    const docA = makeDoc()
    const docB = makeDoc()

    const charA = docA.insert(Document.START_ID, 'A', 'clientA', 1n)
    const charB = docB.insert(Document.START_ID, 'B', 'clientB', 1n)

    // Apply A's char to B and B's char to A
    docB.integrate(charA)
    docA.integrate(charB)

    expect(docA.getText()).toBe(docB.getText())
  })

  it('3-way convergence: all orderings produce identical text', () => {
    const makeThree = () => [makeDoc(), makeDoc(), makeDoc()] as const

    const buildOps = () => {
      const [d1, d2, d3] = makeThree()
      const c1 = d1.insert(Document.START_ID, 'X', 'aaa', 1n)
      const c2 = d2.insert(Document.START_ID, 'Y', 'bbb', 1n)
      const c3 = d3.insert(Document.START_ID, 'Z', 'ccc', 1n)
      return [c1, c2, c3] as const
    }

    const orderings = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2],
      [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ]

    const ops = buildOps()
    const results: string[] = []

    for (const order of orderings) {
      const doc = makeDoc()
      for (const i of order) doc.integrate(ops[i])
      results.push(doc.getText())
    }

    expect(new Set(results).size).toBe(1)
  })

  it('concurrent insert at same position: deterministic tiebreaker (greater clientId first)', () => {
    const docA = makeDoc()
    const docB = makeDoc()

    // Both insert after START with same left anchor
    const charA = docA.insert(Document.START_ID, 'A', 'clientA', 1n)
    const charB = docB.insert(Document.START_ID, 'B', 'clientZ', 1n)

    // Apply both ways
    const doc1 = makeDoc()
    doc1.integrate(charA)
    doc1.integrate(charB)

    const doc2 = makeDoc()
    doc2.integrate(charB)
    doc2.integrate(charA)

    expect(doc1.getText()).toBe(doc2.getText())
    // 'clientZ' > 'clientA' lexicographically, so charB (clientZ) goes first
    expect(doc1.getText()).toBe('BA')
  })

  it('concurrent insert + delete: both orderings converge', () => {
    // A inserts char X; B deletes X (the Char object is shared as if B had it)
    const docA = makeDoc()
    const charX = docA.insert(Document.START_ID, 'X', 'clientA', 1n)

    // Simulate B receiving and deleting X
    const docB = makeDoc()
    docB.integrate(charX)
    docB.delete(charX.id.clientId + ':' + charX.id.clock)
    const deletedChar = docB.serialize().chars.find(
      c => c.id.clientId === charX.id.clientId && c.id.clock === charX.id.clock
    )!

    // Order 1: A sees deletion after insert
    const doc1 = makeDoc()
    doc1.integrate(charX)
    doc1.integrate(deletedChar)
    doc1.delete(charX.id.clientId + ':' + charX.id.clock)

    // Order 2: fresh doc applies delete-state char first, then original insert attempt
    const doc2 = makeDoc()
    doc2.integrate(deletedChar)
    doc2.integrate(charX)
    doc2.delete(charX.id.clientId + ':' + charX.id.clock)

    expect(doc1.getText()).toBe(doc2.getText())
    expect(doc1.getText()).toBe('')
  })

  it('idempotency: integrate called twice produces no duplicate', () => {
    const doc = makeDoc()
    const char = doc.insert(Document.START_ID, 'A', 'c1', 1n)
    doc.integrate(char)
    doc.integrate(char)
    const key = char.id.clientId + ':' + char.id.clock
    const occurrences = doc.serialize().order.filter(k => k === key).length
    expect(occurrences).toBe(1)
    expect(doc.getText()).toBe('A')
  })

  it('position round-trip: getIndexOfCharId(getCharIdAtIndex(i)) === i', () => {
    const doc = makeDoc()
    let prev = Document.START_ID
    for (let i = 0; i < 5; i++) {
      const char = doc.insert(prev, String(i), 'c1', BigInt(i + 1))
      prev = char.id.clientId + ':' + char.id.clock
    }
    const text = doc.getText()
    for (let i = 0; i < text.length; i++) {
      const charId = doc.getCharIdAtIndex(i)
      expect(doc.getIndexOfCharId(charId)).toBe(i)
    }
  })

  it('serialize round-trip: deserialize produces same getText() and order', () => {
    const doc = makeDoc()
    let prev = Document.START_ID
    for (let i = 0; i < 4; i++) {
      const char = doc.insert(prev, 'abcd'[i], 'c1', BigInt(i + 1))
      prev = char.id.clientId + ':' + char.id.clock
    }
    doc.delete(doc.getCharIdAtIndex(1)) // delete 'b'

    const serialized = doc.serialize()
    const json = JSON.parse(JSON.stringify(serialized, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ))
    // Restore bigints manually (simulating fromWireDoc)
    const restored = {
      order: json.order,
      chars: json.chars.map((c: any) => ({
        ...c,
        id: { clientId: c.id.clientId, clock: BigInt(c.id.clock) },
        leftId: c.leftId ? { clientId: c.leftId.clientId, clock: BigInt(c.leftId.clock) } : null,
        rightId: c.rightId ? { clientId: c.rightId.clientId, clock: BigInt(c.rightId.clock) } : null,
      })),
    }

    const doc2 = Document.deserialize(restored)
    expect(doc2.getText()).toBe(doc.getText())
    expect(doc2.serialize().order).toEqual(doc.serialize().order)
  })
})
