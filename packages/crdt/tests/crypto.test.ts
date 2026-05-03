import { describe, it, expect } from 'vitest'
import {
  deriveMasterKey,
  deriveSubKey,
  encryptValue,
  decryptValue,
  createVerifier,
  verifyPassword,
  generateSalt,
  KDF_ITERATIONS_DEFAULT
} from '../src/crypto.js'

describe('generateSalt', () => {
  it('produces 32 bytes', () => {
    expect(generateSalt().length).toBe(32)
  })

  it('produces different output each call', () => {
    const a = generateSalt()
    const b = generateSalt()
    expect(a).not.toEqual(b)
  })
})

describe('deriveMasterKey', () => {
  it('is deterministic for same inputs', async () => {
    const salt = new Uint8Array(32)
    salt[0] = 1
    const key1 = await deriveMasterKey('password', salt, 1000)
    const key2 = await deriveMasterKey('password', salt, 1000)

    // Keys are non-extractable — verify by deriving identical verifiers from both
    const v1 = await createVerifier(key1)
    const v2 = await createVerifier(key2)
    expect(v1).toBe(v2)
  })
})

describe('encryptValue / decryptValue', () => {
  it('round-trips correctly', async () => {
    const salt = generateSalt()
    const masterKey = await deriveMasterKey('test-password', salt, 1000)
    const opKey = await deriveSubKey(masterKey, 'op-encryption')

    const charId = { clientId: 'c1', clock: 5n }
    const ciphertext = await encryptValue('A', opKey, charId)
    const plaintext = await decryptValue(ciphertext, opKey, charId)

    expect(plaintext).toBe('A')
  })

  it('produces deterministic ciphertext for same inputs (deterministic nonce)', async () => {
    const salt = generateSalt()
    const masterKey = await deriveMasterKey('test-password', salt, 1000)
    const opKey = await deriveSubKey(masterKey, 'op-encryption')

    const charId = { clientId: 'c1', clock: 5n }
    const c1 = await encryptValue('A', opKey, charId)
    const c2 = await encryptValue('A', opKey, charId)

    expect(c1).toBe(c2)
  })

  it('produces different ciphertext for different charIds', async () => {
    const salt = generateSalt()
    const masterKey = await deriveMasterKey('test-password', salt, 1000)
    const opKey = await deriveSubKey(masterKey, 'op-encryption')

    const c1 = await encryptValue('A', opKey, { clientId: 'c1', clock: 1n })
    const c2 = await encryptValue('A', opKey, { clientId: 'c1', clock: 2n })

    expect(c1).not.toBe(c2)
  })

  it('decrypt with wrong key throws', async () => {
    const salt = generateSalt()
    const correctKey = await deriveSubKey(
      await deriveMasterKey('correct', salt, 1000),
      'op-encryption'
    )
    const wrongKey = await deriveSubKey(
      await deriveMasterKey('wrong', salt, 1000),
      'op-encryption'
    )

    const charId = { clientId: 'c1', clock: 1n }
    const ciphertext = await encryptValue('secret', correctKey, charId)

    await expect(decryptValue(ciphertext, wrongKey, charId)).rejects.toThrow()
  })
})

describe('verifyPassword', () => {
  it('returns valid: true with correct password', async () => {
    const salt = generateSalt()
    const masterKey = await deriveMasterKey('correct-password', salt, 1000)
    const verifier = await createVerifier(masterKey)

    const result = await verifyPassword('correct-password', salt, 1000, verifier)
    expect(result.valid).toBe(true)
    expect(result.masterKey).toBeDefined()
  })

  it('returns valid: false with wrong password without throwing', async () => {
    const salt = generateSalt()
    const masterKey = await deriveMasterKey('correct-password', salt, 1000)
    const verifier = await createVerifier(masterKey)

    const result = await verifyPassword('wrong-password', salt, 1000, verifier)
    expect(result.valid).toBe(false)
    expect(result.masterKey).toBeUndefined()
  })
})

describe('PBKDF2 performance', () => {
  it('600k iterations completes in under 5 seconds', async () => {
    const salt = generateSalt()
    const start = performance.now()
    await deriveMasterKey('benchmark-password', salt, KDF_ITERATIONS_DEFAULT)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  }, 10000)
})
