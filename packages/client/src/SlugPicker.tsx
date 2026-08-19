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
    <div style={s.container}>
      <div style={s.card}>
        <h2 style={s.title}>NotGoogleDocs</h2>
        <p style={s.subtitle}>Enter a document name to create or open it.</p>
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
    minWidth: 340,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  title: { margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a1a1a' },
  subtitle: { margin: '0 0 20px', fontSize: 13, color: '#888' },
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
}
