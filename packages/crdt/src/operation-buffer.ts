import type { Operation } from './types.js'
import type { VectorClock } from './vector-clock.js'

export class OperationBuffer {
  private ops: Operation[] = []

  add(op: Operation): void {
    this.ops.push(op)
  }

  drain(vc: VectorClock): Operation[] {
    const ready: Operation[] = []
    const remaining: Operation[] = []
    for (const op of this.ops) {
      if (vc.isReady(op)) ready.push(op)
      else remaining.push(op)
    }
    this.ops = remaining
    return ready
  }

  size(): number {
    return this.ops.length
  }
}
