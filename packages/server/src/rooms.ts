import type { CursorState } from '@collab/crdt'

interface WebSocketLike {
  send(data: string | ArrayBuffer | Uint8Array): void
}

interface RoomEntry {
  ws: WebSocketLike
  clientId: string
  color: string
  name: string
  cursor: string | null
}

const COLORS = ['#F87171', '#FB923C', '#FBBF24', '#4ADE80', '#60A5FA', '#C084FC']

function hashColor(clientId: string): string {
  let h = 5381
  for (let i = 0; i < clientId.length; i++) {
    h = ((h << 5) + h) ^ clientId.charCodeAt(i)
    h = h | 0
  }
  return COLORS[Math.abs(h) % COLORS.length]
}

// Rooms are keyed by connId (one per WebSocket connection), not clientId —
// clientId comes from localStorage and is shared by every tab in a browser
// profile, so keying by it collapses multiple tabs into one broadcast slot.
export class Rooms {
  private rooms = new Map<string, Map<string, RoomEntry>>()

  join(docId: string, connId: string, clientId: string, ws: WebSocketLike): void {
    if (!this.rooms.has(docId)) this.rooms.set(docId, new Map())
    this.rooms.get(docId)!.set(connId, {
      ws,
      clientId,
      color: hashColor(clientId),
      name: '',
      cursor: null,
    })
  }

  leave(docId: string, connId: string): void {
    const room = this.rooms.get(docId)
    if (!room) return
    room.delete(connId)
    if (room.size === 0) this.rooms.delete(docId)
  }

  broadcast(docId: string, excludeConnId: string, message: string): void {
    const room = this.rooms.get(docId)
    if (!room) return
    for (const [connId, entry] of room) {
      if (connId !== excludeConnId) entry.ws.send(message)
    }
  }

  getColor(docId: string, connId: string): string {
    return this.rooms.get(docId)?.get(connId)?.color ?? '#999999'
  }

  updatePresence(docId: string, connId: string, cursor: string | null, name: string): void {
    const entry = this.rooms.get(docId)?.get(connId)
    if (entry) {
      entry.cursor = cursor
      entry.name = name
    }
  }

  getCursors(docId: string): Record<string, CursorState> {
    const room = this.rooms.get(docId)
    if (!room) return {}
    const result: Record<string, CursorState> = {}
    for (const entry of room.values()) {
      result[entry.clientId] = { charId: entry.cursor, color: entry.color, name: entry.name }
    }
    return result
  }
}
