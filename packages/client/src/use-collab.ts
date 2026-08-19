import { useEffect, useRef, useState, useCallback } from 'react'
import { fromWire, fromWireDoc, type WireOperation, type CursorState } from '@collab/crdt'
import { WS_URL } from './config.js'
import { CRDTManager } from './crdt-manager.js'

type Status = 'connecting' | 'reconnecting' | 'connected' | 'offline'

const BACKOFF = [1000, 2000, 4000, 8000, 16000]

function getClientId(): string {
  const stored = localStorage.getItem('collab-client-id')
  if (stored) return stored
  const id = crypto.randomUUID()
  localStorage.setItem('collab-client-id', id)
  return id
}

export function useCollab(
  docId: string,
  opKey: CryptoKey | null = null,
): {
  manager: CRDTManager
  cursors: Record<string, CursorState>
  status: Status
} {
  const clientId = useRef(getClientId())
  const managerRef = useRef<CRDTManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = new CRDTManager(clientId.current, docId)
  }
  const manager = managerRef.current

  // Propagate opKey changes into the manager
  const prevOpKeyRef = useRef<CryptoKey | null>(null)
  if (opKey !== prevOpKeyRef.current) {
    prevOpKeyRef.current = opKey
    manager.setOpKey(opKey)
  }

  const [, forceRender] = useState(0)
  const [status, setStatus] = useState<Status>('connecting')
  const [cursors, setCursors] = useState<Record<string, CursorState>>({})

  const retryCount = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const unmounted = useRef(false)

  // Op batching — accumulate for 100ms then send as OP_BATCH
  const batchRef = useRef<WireOperation[]>([])
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    manager.setSendFn((wireOp: WireOperation) => {
      batchRef.current.push(wireOp)
      if (!batchTimerRef.current) {
        batchTimerRef.current = setTimeout(() => {
          const ops = batchRef.current.splice(0)
          batchTimerRef.current = null
          const ws = wsRef.current
          if (ops.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'OP_BATCH', ops }))
          }
        }, 100)
      }
    })
    return () => {
      manager.setSendFn(null)
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
      }
    }
  }, [manager])

  const connect = useCallback(() => {
    if (unmounted.current) return

    const url = `${WS_URL}/doc/${docId}?clientId=${clientId.current}`
    const ws = new WebSocket(url)
    wsRef.current = ws
    manager.setWs(ws)

    ws.onopen = () => {
      if (unmounted.current) return
      retryCount.current = 0
      setStatus('connected')
      ws.send(JSON.stringify({ type: 'SYNC', vectorClock: manager.getVectorClock() }))
    }

    ws.onmessage = (event: MessageEvent) => {
      if (unmounted.current) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.data as string) as Record<string, unknown>
      } catch {
        return
      }

      switch (msg.type) {
        case 'INIT': {
          const wireSnapshot = msg.snapshot as Parameters<typeof fromWireDoc>[0] | null
          const wireOps = (msg.ops as Parameters<typeof fromWire>[0][]) ?? []
          const encVer = msg.encryptionVersion as number | undefined
          if (encVer === 1 && !opKey) {
            console.warn('[useCollab] INIT has encryptionVersion=1 but opKey not set yet')
          }
          manager.initFromSnapshot(
            wireSnapshot ? fromWireDoc(wireSnapshot) : null,
            wireOps.map(fromWire),
          )
          break
        }
        case 'SYNC_RESPONSE': {
          const wireOps = (msg.ops as Parameters<typeof fromWire>[0][]) ?? []
          wireOps.forEach(o => manager.applyRemoteOp(fromWire(o)))
          break
        }
        case 'OP': {
          manager.applyRemoteOp(fromWire(msg.op as Parameters<typeof fromWire>[0]))
          break
        }
        case 'PRESENCE': {
          const cid = msg.clientId as string | undefined
          if (!cid) break
          const charId = (msg.charId as string | null) ?? null
          const color = (msg.color as string) ?? '#888888'
          const name = (msg.name as string) ?? ''
          setCursors(prev => {
            if (charId === null) {
              const next = { ...prev }
              delete next[cid]
              return next
            }
            return { ...prev, [cid]: { charId, color, name } }
          })
          break
        }
        case 'ACK':
          break
      }
    }

    ws.onclose = () => {
      if (unmounted.current) return
      manager.setWs(null)
      const attempt = retryCount.current
      if (attempt < BACKOFF.length) {
        setStatus('reconnecting')
        retryCount.current++
        const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]
        setTimeout(connect, delay)
      } else {
        setStatus('offline')
      }
    }
  }, [docId, manager, opKey])

  useEffect(() => {
    unmounted.current = false
    setStatus('connecting')
    connect()

    const unsub = manager.subscribe(() => forceRender(n => n + 1))

    return () => {
      unmounted.current = true
      unsub()
      wsRef.current?.close()
      manager.setWs(null)
    }
  }, [connect, manager])

  return { manager, cursors, status }
}
