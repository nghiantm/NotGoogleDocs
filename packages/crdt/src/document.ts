import { charIdToString, stringToCharId } from './utils.js'
import type { Char, SerializedDoc } from './types.js'

export class Document {
  static readonly START_ID = 'START'
  static readonly END_ID = 'END'

  private chars: Map<string, Char> = new Map()
  private order: string[] = [Document.START_ID, Document.END_ID]

  insert(afterId: string, value: string, clientId: string, clock: bigint): Char {
    const afterIndex = this.order.indexOf(afterId)
    const nextKey = this.order[afterIndex + 1]

    const char: Char = {
      id: { clientId, clock },
      value,
      encryptedValue: null,
      leftId: afterId === Document.START_ID ? null : stringToCharId(afterId),
      rightId: nextKey === Document.END_ID ? null : stringToCharId(nextKey),
      isDeleted: false,
    }

    this.integrate(char)
    return char
  }

  delete(charId: string): Char | null {
    const char = this.chars.get(charId)
    if (!char) return null
    char.isDeleted = true
    char.value = null
    return char
  }

  integrate(char: Char): void {
    const charKey = charIdToString(char.id)
    if (this.chars.has(charKey)) return

    const leftKey = char.leftId ? charIdToString(char.leftId) : Document.START_ID
    const rightKey = char.rightId ? charIdToString(char.rightId) : Document.END_ID

    const leftIndex = this.order.indexOf(leftKey)
    let insertPos = leftIndex + 1

    // Scan forward to find correct insertion position
    while (insertPos < this.order.length) {
      const currentKey = this.order[insertPos]

      if (currentKey === rightKey) break

      const currentChar = this.chars.get(currentKey)
      if (!currentChar) break

      const currentLeftKey = currentChar.leftId
        ? charIdToString(currentChar.leftId)
        : Document.START_ID

      const currentLeftIndex = this.order.indexOf(currentLeftKey)

      if (currentLeftIndex < leftIndex) {
        // Current char's left anchor is earlier — it belongs before ours
        break
      }

      if (currentLeftKey === leftKey && currentChar.id.clientId < char.id.clientId) {
        // Same left anchor: we have higher clientId, so we go first (to the left)
        break
      }

      insertPos++
    }

    this.order.splice(insertPos, 0, charKey)
    this.chars.set(charKey, char)
  }

  getText(): string {
    const parts: string[] = []
    for (const key of this.order) {
      if (key === Document.START_ID || key === Document.END_ID) continue
      const char = this.chars.get(key)
      if (char && !char.isDeleted && char.value !== null) {
        parts.push(char.value)
      }
    }
    return parts.join('')
  }

  getCharIdAtIndex(index: number): string {
    if (index < 0) return Document.START_ID

    let liveCount = 0
    let lastLiveKey: string | null = null

    for (const key of this.order) {
      if (key === Document.START_ID || key === Document.END_ID) continue
      const char = this.chars.get(key)
      if (!char || char.isDeleted) continue

      if (liveCount === index) return key
      liveCount++
      lastLiveKey = key
    }

    return lastLiveKey ?? Document.START_ID
  }

  getIndexOfCharId(charId: string): number {
    let index = 0
    for (const key of this.order) {
      if (key === Document.START_ID || key === Document.END_ID) continue
      const char = this.chars.get(key)
      if (!char || char.isDeleted) continue
      if (key === charId) return index
      index++
    }
    return -1
  }

  serialize(): SerializedDoc {
    return {
      chars: [...this.chars.values()],
      order: [...this.order],
    }
  }

  static deserialize(data: SerializedDoc): Document {
    const doc = new Document()
    doc.order = data.order
    for (const char of data.chars) {
      doc.chars.set(charIdToString(char.id), char)
    }
    return doc
  }
}
