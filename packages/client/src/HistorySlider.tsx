import { useEffect, useState } from 'react'
import { Document, charIdToString, fromWire } from '@collab/crdt'
import type { WireOperation, Operation } from '@collab/crdt'
import { HTTP_URL } from './config.js'

interface Props {
  docId: string
  onHistoryChange: (isHistoryView: boolean, previewText?: string, previewTime?: number) => void
}

export default function HistorySlider({ docId, onHistoryChange }: Props) {
  const [ops, setOps] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [pct, setPct] = useState(100)
  const [previewTime, setPreviewTime] = useState<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function fetchOps() {
      const allOps: WireOperation[] = []
      let offset = 0
      while (true) {
        const res = await fetch(`${HTTP_URL}/docs/${docId}/ops?limit=1000&offset=${offset}`)
        const page: WireOperation[] = await res.json()
        allOps.push(...page)
        if (page.length < 1000) break
        offset += 1000
      }
      if (!cancelled) {
        setOps(allOps.map(fromWire))
        setLoading(false)
      }
    }

    fetchOps().catch(err => {
      console.error('Failed to fetch ops:', err)
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [docId])

  function replayOps(newPct: number) {
    setPct(newPct)

    if (newPct === 100 || ops.length === 0) {
      setPreviewTime(undefined)
      onHistoryChange(false)
      return
    }

    const opCount = Math.floor((newPct / 100) * ops.length)
    const doc = new Document()
    for (let i = 0; i < opCount; i++) {
      const op = ops[i]
      if (op.type === 'insert') {
        doc.integrate(op.char)
      } else {
        doc.delete(charIdToString(op.char.id))
      }
    }
    const text = doc.getText()
    const time = opCount > 0 ? ops[opCount - 1].wallClock : undefined
    setPreviewTime(time)
    onHistoryChange(true, text, time)
  }

  function handleReturnToLive() {
    replayOps(100)
  }

  const isHistoryView = pct < 100

  return (
    <div style={{ flexShrink: 0 }}>
      {isHistoryView && (
        <div style={{
          background: '#fffbe6',
          borderTop: '1px solid #ffe58f',
          borderBottom: '1px solid #ffe58f',
          padding: '6px 20px',
          fontSize: 13,
          color: '#6b4800',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span>
            Viewing history at{' '}
            {previewTime !== undefined
              ? new Date(previewTime).toLocaleString()
              : 'beginning'}
          </span>
          <button
            onClick={handleReturnToLive}
            style={{
              background: 'none',
              border: '1px solid #e8a000',
              borderRadius: 4,
              padding: '2px 10px',
              color: '#6b4800',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Return to live
          </button>
        </div>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 20px',
        borderTop: '1px solid #e8e8e8',
        background: '#fff',
      }}>
        <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', minWidth: 120 }}>
          {loading ? 'Loading history…' : `History (${ops.length} ops)`}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          disabled={loading || ops.length === 0}
          onChange={e => replayOps(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', minWidth: 28, textAlign: 'right' }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}
