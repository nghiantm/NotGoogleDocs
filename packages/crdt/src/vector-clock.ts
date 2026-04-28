import type { Operation } from './types.js'

export class VectorClock {
  private clocks: Map<string, bigint> = new Map()

  update(clientId: string, clock: bigint): void {
    const current = this.clocks.get(clientId) ?? 0n
    if (clock > current) this.clocks.set(clientId, clock)
  }

  hasSeen(clientId: string, clock: bigint): boolean {
    return (this.clocks.get(clientId) ?? 0n) >= clock
  }

  isReady(op: Operation): boolean {
    const { leftId, rightId } = op.char
    if (leftId !== null && !this.hasSeen(leftId.clientId, leftId.clock)) return false
    if (rightId !== null && !this.hasSeen(rightId.clientId, rightId.clock)) return false
    return true
  }

  serialize(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [clientId, clock] of this.clocks) {
      result[clientId] = clock.toString()
    }
    return result
  }

  static deserialize(data: Record<string, string>): VectorClock {
    const vc = new VectorClock()
    for (const [clientId, clockStr] of Object.entries(data)) {
      vc.clocks.set(clientId, BigInt(clockStr))
    }
    return vc
  }

  clone(): VectorClock {
    const copy = new VectorClock()
    for (const [clientId, clock] of this.clocks) {
      copy.clocks.set(clientId, clock)
    }
    return copy
  }
}
