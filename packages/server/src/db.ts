import postgres from 'postgres'
import type { Operation } from '@collab/crdt'
import type { WireSerializedDoc } from '@collab/crdt'

export interface PersistedOp {
  id: string
  docId: string
  seq: bigint
  clientId: string
  lamportClock: bigint
  opType: string
  charId: string
  charValue: string | null
  leftId: string | null
  rightId: string | null
  isDeleted: boolean
  wallClock: number
}

export interface PersistedSnapshot {
  id: string
  docId: string
  snapshotSeq: bigint
  state: WireSerializedDoc
}

type DbRow = Record<string, unknown>

export class Database {
  private sql: ReturnType<typeof postgres>

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    this.sql = postgres(process.env.DATABASE_URL, {
      max: 10,
      types: { bigint: postgres.BigInt },
    })
  }

  async createDocument(): Promise<{ id: string; title: string }> {
    const rows = await this.sql<DbRow[]>`
      INSERT INTO documents DEFAULT VALUES
      RETURNING id, title
    `
    const row = rows[0]
    return { id: row.id as string, title: row.title as string }
  }

  async nextSeq(docId: string): Promise<bigint> {
    const rows = await this.sql<DbRow[]>`
      SELECT next_seq(${docId}::uuid) AS next_seq
    `
    return rows[0].next_seq as bigint
  }

  async persistOp(docId: string, op: Operation, seq: bigint): Promise<void> {
    const charId = op.char.id.clientId + ':' + op.char.id.clock.toString()
    const leftId = op.char.leftId
      ? op.char.leftId.clientId + ':' + op.char.leftId.clock.toString()
      : null
    const rightId = op.char.rightId
      ? op.char.rightId.clientId + ':' + op.char.rightId.clock.toString()
      : null

    await this.sql<DbRow[]>`
      INSERT INTO operations
        (doc_id, seq, client_id, lamport_clock, op_type, char_id, char_value,
         left_id, right_id, is_deleted, wall_clock)
      VALUES (
        ${docId}::uuid,
        ${seq.toString()}::bigint,
        ${op.clientId},
        ${op.lamportClock.toString()}::bigint,
        ${op.type},
        ${charId},
        ${op.char.value},
        ${leftId},
        ${rightId},
        ${op.char.isDeleted},
        ${op.wallClock}
      )
    `
  }

  private rowToPersistedOp(row: DbRow): PersistedOp {
    return {
      id: row.id as string,
      docId: row.doc_id as string,
      seq: row.seq as bigint,
      clientId: row.client_id as string,
      lamportClock: row.lamport_clock as bigint,
      opType: row.op_type as string,
      charId: row.char_id as string,
      charValue: row.char_value as string | null,
      leftId: row.left_id as string | null,
      rightId: row.right_id as string | null,
      isDeleted: row.is_deleted as boolean,
      wallClock: Number(row.wall_clock),
    }
  }

  async getAllOps(docId: string): Promise<PersistedOp[]> {
    const rows = await this.sql<DbRow[]>`
      SELECT * FROM operations
      WHERE doc_id = ${docId}::uuid
      ORDER BY seq ASC
    `
    return rows.map(r => this.rowToPersistedOp(r))
  }

  async getOpsSince(docId: string, afterSeq: bigint): Promise<PersistedOp[]> {
    const rows = await this.sql<DbRow[]>`
      SELECT * FROM operations
      WHERE doc_id = ${docId}::uuid AND seq > ${afterSeq.toString()}::bigint
      ORDER BY seq ASC
    `
    return rows.map(r => this.rowToPersistedOp(r))
  }

  async getOpsPage(docId: string, limit: number, offset: number): Promise<PersistedOp[]> {
    const rows = await this.sql<DbRow[]>`
      SELECT * FROM operations
      WHERE doc_id = ${docId}::uuid
      ORDER BY seq ASC
      LIMIT ${limit} OFFSET ${offset}
    `
    return rows.map(r => this.rowToPersistedOp(r))
  }

  async getOpCount(docId: string): Promise<bigint> {
    const rows = await this.sql<DbRow[]>`
      SELECT COUNT(*)::bigint AS count FROM operations
      WHERE doc_id = ${docId}::uuid
    `
    return rows[0].count as bigint
  }

  async getLatestSnapshot(docId: string): Promise<PersistedSnapshot | null> {
    const rows = await this.sql<DbRow[]>`
      SELECT id, doc_id, snapshot_seq, state FROM snapshots
      WHERE doc_id = ${docId}::uuid
      ORDER BY snapshot_seq DESC
      LIMIT 1
    `
    if (rows.length === 0) return null
    const row = rows[0]
    return {
      id: row.id as string,
      docId: row.doc_id as string,
      snapshotSeq: row.snapshot_seq as bigint,
      state: row.state as WireSerializedDoc,
    }
  }

  async getLatestSeq(docId: string): Promise<bigint> {
    const rows = await this.sql<DbRow[]>`
      SELECT seq FROM operations
      WHERE doc_id = ${docId}::uuid
      ORDER BY seq DESC
      LIMIT 1
    `
    if (rows.length === 0) return 0n
    return rows[0].seq as bigint
  }

  async writeSnapshot(docId: string, snapshotSeq: bigint, state: WireSerializedDoc): Promise<void> {
    await this.sql<DbRow[]>`
      INSERT INTO snapshots (doc_id, snapshot_seq, state)
      VALUES (
        ${docId}::uuid,
        ${snapshotSeq.toString()}::bigint,
        ${JSON.stringify(state)}::jsonb
      )
      ON CONFLICT (doc_id, snapshot_seq) DO NOTHING
    `
  }
}
