import { describe, it, expect } from 'vitest'
import { charIdToString, stringToCharId, bigIntMax } from '../src/utils.js'

describe('charIdToString / stringToCharId', () => {
  it('round-trips a standard CharId', () => {
    const id = { clientId: 'abc-123', clock: 42n }
    expect(stringToCharId(charIdToString(id))).toEqual(id)
  })

  it('preserves bigint precision beyond Number.MAX_SAFE_INTEGER', () => {
    const id = { clientId: 'client1', clock: 99999999999999999n }
    expect(stringToCharId(charIdToString(id)).clock).toBe(99999999999999999n)
  })

  it('handles uuid-format clientId', () => {
    const id = { clientId: '550e8400-e29b-41d4-a716-446655440000', clock: 1n }
    expect(stringToCharId(charIdToString(id))).toEqual(id)
  })

  it('clock 0n round-trips correctly', () => {
    const id = { clientId: 'c1', clock: 0n }
    expect(stringToCharId(charIdToString(id)).clock).toBe(0n)
  })
})

describe('bigIntMax', () => {
  it('returns larger of two bigints', () => {
    expect(bigIntMax(5n, 10n)).toBe(10n)
    expect(bigIntMax(10n, 5n)).toBe(10n)
    expect(bigIntMax(0n, 0n)).toBe(0n)
  })
})
