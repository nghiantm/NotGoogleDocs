import { useEffect, useState } from 'react'
import { HTTP_URL } from './config.js'
import { useCollab } from './use-collab.js'
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

export default function App() {
  const [docId, setDocId] = useState<string | null>(() => {
    const path = window.location.pathname.slice(1)
    return path || null
  })

  useEffect(() => {
    if (docId) return
    fetch(`${HTTP_URL}/docs`, { method: 'POST' })
      .then(r => r.json() as Promise<{ id: string }>)
      .then(data => {
        window.history.replaceState({}, '', `/${data.id}`)
        setDocId(data.id)
      })
      .catch(err => console.error('Failed to create document:', err))
  }, [docId])

  if (!docId) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'sans-serif',
        color: '#888',
        fontSize: 14,
      }}>
        Creating document…
      </div>
    )
  }

  return <EditorApp docId={docId} />
}

function EditorApp({ docId }: { docId: string }) {
  const { manager, cursors, status } = useCollab(docId)
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
          NotGoogleDocs
        </span>
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
