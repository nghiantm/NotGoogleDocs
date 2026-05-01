import postgres from 'postgres'
import { Database } from '../src/db.js'
import { load } from '../src/loader.js'
import { maybeCompact } from '../src/compaction.js'
import type { Operation, CharId } from '@collab/crdt'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const BENCH_CLIENT_ID = 'bench-client-0000-0000-0000-000000000000'
const TOTAL_OPS = 1_000
const DELTA_OPS = 100
const BATCH_SIZE = 100
const CHARS = 'abcdefghijklmnopqrstuvwxyz'

async function insertOps(
  db: Database,
  docId: string,
  count: number,
  startClock: bigint,
  startLeftId: CharId | null
): Promise<{ endClock: bigint; lastCharId: CharId }> {
  let clock = startClock
  let leftId: CharId | null = startLeftId
  let lastCharId: CharId | null = null

  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, count - batchStart)
    const ops: Operation[] = []

    for (let i = 0; i < batchCount; i++) {
      clock++
      const charId: CharId = { clientId: BENCH_CLIENT_ID, clock }
      ops.push({
        type: 'insert',
        char: {
          id: charId,
          value: CHARS[Math.floor(Math.random() * CHARS.length)],
          leftId,
          rightId: null,
          isDeleted: false,
        },
        docId,
        clientId: BENCH_CLIENT_ID,
        lamportClock: clock,
        wallClock: Date.now(),
      })
      leftId = charId
      lastCharId = charId
    }

    const seqs = await Promise.all(ops.map(() => db.nextSeq(docId)))
    await Promise.all(ops.map((op, i) => db.persistOp(docId, op, seqs[i])))
  }

  return { endClock: clock, lastCharId: lastCharId as CharId }
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

function fmtMs(n: number): string {
  return `${n.toFixed(2)} ms`
}

async function main(): Promise<void> {
  const db = new Database()
  const sql = postgres(DATABASE_URL!, {
    max: 1,
    types: { bigint: postgres.BigInt },
    family: 4,
  })

  let docId = ''

  try {
    const doc = await db.createDocument()
    docId = doc.id
    console.log(`Benchmark doc: ${docId}\n`)

    // Insert 10,000 ops in batches of 500
    process.stdout.write(`Inserting ${TOTAL_OPS} ops in batches of ${BATCH_SIZE}...`)
    const { endClock: clockAfter10k, lastCharId: lastCharAfter10k } = await insertOps(
      db, docId, TOTAL_OPS, 0n, null
    )
    console.log(' done')

    // Measure 1: load without snapshot
    const loadWithoutSnapshot = await timed(() => load(docId, db))

    // Measure 4: compaction time (set threshold to 1 to force compaction)
    process.env.COMPACTION_THRESHOLD = '1'
    const compactionTime = await timed(() => maybeCompact(docId, db))

    // Measure 2: load after compaction (snapshot + 0 delta ops)
    const loadWithSnapshot = await timed(() => load(docId, db))

    // Insert 1,000 delta ops on top of the snapshot
    process.stdout.write(`Inserting ${DELTA_OPS} delta ops...`)
    await insertOps(db, docId, DELTA_OPS, clockAfter10k, lastCharAfter10k)
    console.log(' done')

    // Measure 3: reconnect sync — client vector clock has seen first 10k ops,
    // so only the 1k delta ops should be returned
    const vcAtSnapshot: Record<string, string> = {
      [BENCH_CLIENT_ID]: clockAfter10k.toString(),
    }
    const reconnectSync = await timed(() => load(docId, db, vcAtSnapshot))

    // Print results table
    const col = 50
    const speedup = loadWithoutSnapshot / loadWithSnapshot

    console.log('\nBenchmark Results')
    console.log('─'.repeat(68))
    console.log(
      `  ${`loadWithoutSnapshot  (${TOTAL_OPS} ops, no snapshot):`.padEnd(col)}` +
      `  ${fmtMs(loadWithoutSnapshot).padStart(12)}`
    )
    console.log(
      `  ${`compactionTime       (replay ${TOTAL_OPS} ops → snapshot):`.padEnd(col)}` +
      `  ${fmtMs(compactionTime).padStart(12)}`
    )
    console.log(
      `  ${'loadWithSnapshot     (snapshot + 0 delta ops):'.padEnd(col)}` +
      `  ${fmtMs(loadWithSnapshot).padStart(12)}`
    )
    console.log(
      `  ${'reconnectSync        (snapshot + 1k delta ops):'.padEnd(col)}` +
      `  ${fmtMs(reconnectSync).padStart(12)}`
    )
    console.log('─'.repeat(68))
    console.log(
      `  ${'Speedup (without / with snapshot):'.padEnd(col)}` +
      `  ${(speedup.toFixed(1) + 'x').padStart(12)}`
    )
    console.log()

    if (speedup < 5) {
      console.warn(`WARNING: speedup ${speedup.toFixed(1)}x is below the expected 5x threshold`)
    }
  } finally {
    if (docId) {
      try {
        await sql`DELETE FROM documents WHERE id = ${docId}::uuid`
        console.log(`Cleaned up: ${docId}`)
      } catch (err) {
        console.error('Cleanup failed:', err)
      }
    }
    await sql.end({ timeout: 0 })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
