import { useState } from 'react'
import { useCollab } from './use-collab.js'
import { CryptoProvider, useCryptoContext } from './crypto-context.js'
import SlugPicker from './SlugPicker.js'
import Editor from './Editor.js'
import HistorySlider from './HistorySlider.js'

type Status = 'connecting' | 'reconnecting' | 'connected' | 'offline'

const STATUS_COLOR: Record<Status, string> = {
  connecting: '#aaaaaa',
  reconnecting: '#e8a000',
  connected: '#22a06b',
  offline: '#c9372c',
}

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  connected: 'Connected',
  offline: 'Offline',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getInitialPhase(): 'slug' | 'editor' {
  const path = window.location.pathname.slice(1)
  if (path && UUID_RE.test(path)) return 'editor'
  return 'slug'
}

export default function App() {
  const [phase, setPhase] = useState<'slug' | 'editor'>(getInitialPhase)
  const [docId, setDocId] = useState<string | null>(() => {
    const path = window.location.pathname.slice(1)
    return path && UUID_RE.test(path) ? path : null
  })
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const initialSlug = window.location.pathname.slice(1)

  if (phase === 'slug') {
    return (
      <SlugPicker
        initialSlug={initialSlug}
        onComplete={(slug, key) => {
          window.history.replaceState({}, '', `/${slug}`)
          setDocId(slug)
          setMasterKey(key)
          setPhase('editor')
        }}
        onLegacy={id => {
          setDocId(id)
          setPhase('editor')
        }}
      />
    )
  }

  return (
    <CryptoProvider masterKey={masterKey}>
      <EditorApp docId={docId!} />
    </CryptoProvider>
  )
}

function EditorApp({ docId }: { docId: string }) {
  const { opKey } = useCryptoContext()
  const { manager, cursors, status } = useCollab(docId, opKey)
  const [isHistoryView, setIsHistoryView] = useState(false)
  const [previewText, setPreviewText] = useState<string | undefined>(undefined)

  function handleHistoryChange(historyActive: boolean, text?: string) {
    setIsHistoryView(historyActive)
    setPreviewText(historyActive ? text : undefined)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        height: 48,
        borderBottom: '1px solid #e8e8e8',
        background: '#fff',
        flexShrink: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.3px', color: '#1a1a1a' }}>
          Safe Text
        </span>
        {opKey && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#22a06b', fontWeight: 600 }}>
            🔒 encrypted
          </span>
        )}
        <span style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: '#555',
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: STATUS_COLOR[status],
            display: 'inline-block',
            transition: 'background-color 0.3s',
          }} />
          {STATUS_LABEL[status]}
        </span>
      </header>
      <main style={{ flex: 1, overflow: 'auto', background: '#fafafa' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', minHeight: '100%', background: '#fff', boxShadow: '0 0 0 1px #e8e8e8' }}>
          <Editor
            manager={manager}
            cursors={isHistoryView ? {} : cursors}
            readOnly={isHistoryView}
            previewText={previewText}
          />
        </div>
      </main>
      <HistorySlider docId={docId} onHistoryChange={handleHistoryChange} />
    </div>
  )
}
