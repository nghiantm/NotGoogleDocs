import type { CharId, Clock } from './types.js'

export function charIdToString(id: CharId): string {
  return `${id.clientId}:${id.clock.toString()}`
}

export function stringToCharId(s: string): CharId {
  const colonIndex = s.lastIndexOf(':')
  return {
    clientId: s.slice(0, colonIndex),
    clock: BigInt(s.slice(colonIndex + 1)) as Clock
  }
}

export function bigIntMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}
