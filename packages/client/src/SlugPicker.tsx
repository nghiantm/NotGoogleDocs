import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DocumentMetadata } from '@collab/crdt'
import { HTTP_URL } from './config.js'
import PasswordPrompt from './PasswordPrompt.js'

interface Props {
  initialSlug: string
  onComplete: (slug: string, masterKey: CryptoKey) => void
  onLegacy: (docId: string) => void
}

type Phase = 'pick' | 'create' | 'unlock'

export default function SlugPicker({ initialSlug, onComplete, onLegacy }: Props) {
  const [slug, setSlug] = useState(initialSlug)
  const [phase, setPhase] = useState<Phase>('pick')
  const [meta, setMeta] = useState<DocumentMetadata | null>(null)
  const [resolvedSlug, setResolvedSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const autoChecked = useRef(false)

  async function checkSlug(target: string) {
    const trimmed = target.trim()
    if (!trimmed) {
      setError('Please enter a document name.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${HTTP_URL}/docs/${encodeURIComponent(trimmed)}/meta`)
      if (res.status === 400) {
        setError('Invalid name. Use only letters, numbers, and hyphens (1–64 chars).')
        return
      }
      if (!res.ok) {
        setError('Server error. Try again.')
        return
      }
      const data = await res.json() as { exists: boolean } & Partial<DocumentMetadata>
      if (!data.exists) {
        setResolvedSlug(trimmed)
        setPhase('create')
      } else if (data.encryptionVersion === 0) {
        onLegacy(trimmed)
      } else {
        setMeta(data as DocumentMetadata)
        setResolvedSlug(trimmed)
        setPhase('unlock')
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-check when arriving directly at a URL like /my-notes
  useEffect(() => {
    if (initialSlug && !autoChecked.current) {
      autoChecked.current = true
      void checkSlug(initialSlug)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void checkSlug(slug)
  }

  if (phase === 'create') {
    return (
      <PasswordPrompt
        mode="create"
        slug={resolvedSlug}
        onSuccess={masterKey => onComplete(resolvedSlug, masterKey)}
        onSlugTaken={() => {
          setPhase('pick')
          setError('That name was just taken. Choose another.')
        }}
      />
    )
  }

  if (phase === 'unlock' && meta) {
    return (
      <PasswordPrompt
        mode="unlock"
        meta={meta}
        onSuccess={masterKey => onComplete(resolvedSlug, masterKey)}
      />
    )
  }

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <h1 style={s.title}>Safe Text</h1>
        <p style={s.tagline}>Your text. Protected.</p>
        <ul style={s.features}>
          <li>Type any name — find it again anytime, it's yours.</li>
          <li>Set a password to encrypt it. Access from anywhere.</li>
          <li>Real-time collaborative editing, multiple people at once.</li>
          <li>Simple. Fast. Free. No ads.</li>
        </ul>
      </div>

      <div style={s.card}>
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.inputRow}>
            <span style={s.slash}>/</span>
            <input
              type="text"
              placeholder="my-document"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              autoFocus
              disabled={loading}
              style={s.input}
              spellCheck={false}
            />
          </div>
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading || !slug.trim()} style={s.button}>
            {loading ? 'Checking…' : 'Open →'}
          </button>
        </form>
      </div>

      <div style={s.safety}>
        <h2 style={s.safetyTitle}>Why it's safe</h2>
        <ul style={s.safetyList}>
          <li>
            <strong>Your password never reaches our server.</strong> The encryption key is
            derived entirely in your browser — we only ever see ciphertext, so we
            couldn't decrypt your text even if we wanted to.
          </li>
          <li>
            <strong>Minimum personal information stored.</strong> No email, no username,
            no account. Just a document name, a password verifier, and encrypted content.
          </li>
          <li>
            <strong>No ads, no tracking.</strong> No analytics, no third-party cookies,
            nothing sold.
          </li>
          <li>
            <strong>No login sessions.</strong> Close the tab and you're done — nothing
            lingers.
          </li>
          <li>
            <strong>If you forget the password, it's gone.</strong> That's the tradeoff
            for us never being able to read it either — there's no recovery.
          </li>
        </ul>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#fafafa',
    fontFamily: 'sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '64px 20px 48px',
    gap: 40,
  },
  hero: { maxWidth: 480, textAlign: 'center' },
  title: { margin: '0 0 6px', fontSize: 32, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.5px' },
  tagline: { margin: '0 0 24px', fontSize: 15, fontWeight: 600, color: '#22a06b' },
  features: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontSize: 14,
    color: '#555',
    lineHeight: 1.5,
  },
  card: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    padding: '28px 36px',
    minWidth: 340,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #d0d0d0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  slash: { padding: '8px 2px 8px 12px', fontSize: 14, color: '#888', fontFamily: 'monospace' },
  input: {
    flex: 1,
    padding: '8px 12px 8px 2px',
    border: 'none',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'monospace',
  },
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
  safety: { maxWidth: 560, width: '100%' },
  safetyTitle: {
    margin: '0 0 16px',
    fontSize: 18,
    fontWeight: 700,
    color: '#1a1a1a',
    textAlign: 'center',
  },
  safetyList: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    fontSize: 13,
    lineHeight: 1.6,
    color: '#555',
  },
}
