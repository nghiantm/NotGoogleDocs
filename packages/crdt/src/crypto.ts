import type { CharId } from './types.js'
import { charIdToString } from './utils.js'

export const KDF_ITERATIONS_DEFAULT = 600000
export const SALT_BYTES = 32
export const NONCE_BYTES = 12
export const VERIFIER_CONSTANT = 'collab-editor-verifier-v1'

export function generateSalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  return salt
}

export async function deriveMasterKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    256
  )

  return crypto.subtle.importKey(
    'raw',
    masterBits,
    'HKDF',
    false,
    ['deriveKey']
  )
}

export async function deriveSubKey(
  masterKey: CryptoKey,
  purpose: 'op-encryption' | 'verifier' | 'snapshot-encryption'
): Promise<CryptoKey> {
  const algorithmConfig = purpose === 'verifier'
    ? { name: 'HMAC', hash: 'SHA-256' }
    : { name: 'AES-GCM', length: 256 }

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(`collab-editor:v1:${purpose}`)
    },
    masterKey,
    algorithmConfig,
    false,
    purpose === 'verifier' ? ['sign', 'verify'] : ['encrypt', 'decrypt']
  )
}

async function nonceFromCharId(charId: CharId): Promise<Uint8Array<ArrayBuffer>> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(charIdToString(charId))
  )
  return new Uint8Array(hash, 0, NONCE_BYTES)
}

export async function encryptValue(
  value: string,
  opKey: CryptoKey,
  charId: CharId
): Promise<string> {
  const nonce = await nonceFromCharId(charId)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    opKey,
    new TextEncoder().encode(value)
  )
  return base64Encode(new Uint8Array(ciphertext))
}

export async function decryptValue(
  ciphertext: string,
  opKey: CryptoKey,
  charId: CharId
): Promise<string> {
  const nonce = await nonceFromCharId(charId)
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    opKey,
    base64Decode(ciphertext)
  )
  return new TextDecoder().decode(plaintextBuffer)
}

export async function createVerifier(masterKey: CryptoKey): Promise<string> {
  const verifierKey = await deriveSubKey(masterKey, 'verifier')
  const signature = await crypto.subtle.sign(
    'HMAC',
    verifierKey,
    new TextEncoder().encode(VERIFIER_CONSTANT)
  )
  return base64Encode(new Uint8Array(signature))
}

export async function verifyPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  expectedVerifier: string
): Promise<{ valid: boolean; masterKey?: CryptoKey }> {
  const masterKey = await deriveMasterKey(password, salt, iterations)
  const computedVerifier = await createVerifier(masterKey)

  if (constantTimeEqual(computedVerifier, expectedVerifier)) {
    return { valid: true, masterKey }
  }
  return { valid: false }
}

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64Decode(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
