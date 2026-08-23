import type { Operation } from './types.js'
import type { VectorClock } from './vector-clock.js'

export class OperationBuffer {
  private ops: Operation[] = []

  add(op: Operation): void {
    this.ops.push(op)
  }

  // Loops to a fixpoint: releasing op A can make a buffered op B (chained
  // off A) ready too, so a single classify pass isn't enough — B would
  // otherwise sit stuck until an unrelated future op happened to re-trigger
  // a drain. Marking vc as seen here (ahead of the caller's own applyOp)
  // is safe: everything in this method runs synchronously in one tick,
  // so the doc is fully caught up before any other message is processed.
  drain(vc: VectorClock): Operation[] {
    const ready: Operation[] = []
    let releasedThisPass = true
    while (releasedThisPass) {
      releasedThisPass = false
      for (let i = this.ops.length - 1; i >= 0; i--) {
        const op = this.ops[i]
        if (vc.isReady(op)) {
          ready.push(op)
          this.ops.splice(i, 1)
          vc.update(op.clientId, op.lamportClock)
          releasedThisPass = true
        }
      }
    }
    return ready
  }

  size(): number {
    return this.ops.length
  }
}
