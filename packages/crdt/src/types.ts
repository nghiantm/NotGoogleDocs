export type ClientId = string
export type Clock = bigint

export interface CharId {
  clientId: ClientId
  clock: Clock
}

export interface Char {
  id: CharId
  value: string | null
  encryptedValue: string | null
  leftId: CharId | null
  rightId: CharId | null
  isDeleted: boolean
}

export interface Operation {
  type: 'insert' | 'delete'
  char: Char
  docId: string
  clientId: ClientId
  lamportClock: Clock
  wallClock: number
  seq?: bigint
}

export interface SerializedDoc {
  chars: Char[]
  order: string[]
}

export interface CursorState {
  charId: string | null
  color: string
  name: string
}

export type EncryptionVersion = 0 | 1

export interface DocumentMetadata {
  slug: string
  salt: string
  kdfIterations: number
  verifier: string
  encryptionVersion: EncryptionVersion
  createdAt: string
}
