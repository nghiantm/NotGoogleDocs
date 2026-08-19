import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  deriveMasterKey,
  createVerifier,
  generateSalt,
  verifyPassword,
} from '@collab/crdt'
import type { DocumentMetadata } from '@collab/crdt'
import { HTTP_URL } from './config.js'

interface CreateProps {
  mode: 'create'
  slug: string
  onSuccess: (masterKey: CryptoKey) => void
  onSlugTaken: () => void
}

interface UnlockProps {
  mode: 'unlock'
  meta: DocumentMetadata
  onSuccess: (masterKey: CryptoKey) => void
}

type Props = CreateProps | UnlockProps

function toBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export default function PasswordPrompt(props: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 1) {
      setError('Password cannot be empty.')
      return
    }

    if (props.mode === 'create') {
      if (password !== confirm) {
        setError('Passwords do not match.')
        return
      }
      setLoading(true)
      try {
        const salt = generateSalt()
        const masterKey = await deriveMasterKey(password, salt, 600000)
        const verifier = await createVerifier(masterKey)
        const res = await fetch(`${HTTP_URL}/docs/encrypted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: props.slug,
            salt: toBase64(salt),
            verifier,
            kdfIterations: 600000,
            encryptionVersion: 1,
          }),
        })
        if (res.status === 409) {
          props.onSlugTaken()
          return
        }
        if (!res.ok) {
          setError('Failed to create document. Try again.')
          return
        }
        props.onSuccess(masterKey)
      } catch {
        setError('An error occurred. Try again.')
      } finally {
        setLoading(false)
      }
    } else {
      setLoading(true)
      try {
        const salt = fromBase64(props.meta.salt)
        const result = await verifyPassword(
          password,
          salt,
          props.meta.kdfIterations,
          props.meta.verifier,
        )
        if (!result.valid || !result.masterKey) {
          setError('Wrong password.')
          return
        }
        props.onSuccess(result.masterKey)
      } catch {
        setError('An error occurred. Try again.')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div style={s.container}>
      <div style={s.card}>
        <h2 style={s.title}>
          {props.mode === 'create' ? 'Set a password' : 'Enter password'}
        </h2>
        {props.mode === 'create' && (
          <p style={s.slug}>/{props.slug}</p>
        )}
        <form onSubmit={handleSubmit} style={s.form}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            disabled={loading}
            style={s.input}
          />
          {props.mode === 'create' && (
            <>
              <input
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                disabled={loading}
                style={s.input}
              />
              <p style={s.warning}>
                If you forget this password, the document cannot be recovered.
              </p>
            </>
          )}
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading} style={s.button}>
            {loading
              ? (props.mode === 'create' ? 'Creating…' : 'Unlocking…')
              : (props.mode === 'create' ? 'Create document' : 'Unlock')}
          </button>
        </form>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#fafafa',
    fontFamily: 'sans-serif',
  },
  card: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    padding: '32px 40px',
    minWidth: 320,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  title: { margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a1a1a' },
  slug: { margin: '0 0 20px', fontSize: 13, color: '#888', fontFamily: 'monospace' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: {
    padding: '8px 12px',
    border: '1px solid #d0d0d0',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
  },
  warning: { margin: 0, fontSize: 12, color: '#c9372c' },
  error: { margin: 0, fontSize: 13, color: '#c9372c', fontWeight: 500 },
  button: {
    padding: '8px 16px',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: 14,
    cursor: 'pointer',
    fontWeight: 600,
  },
}
