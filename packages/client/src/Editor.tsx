import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CursorState } from '@collab/crdt'
import type { CRDTManager } from './crdt-manager.js'

interface Props {
  manager: CRDTManager
  cursors: Record<string, CursorState>
  readOnly: boolean
  previewText?: string
}

interface CursorPos {
  left: number
  top: number
  height: number
  color: string
  name: string
}

function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const preRange = range.cloneRange()
  preRange.selectNodeContents(el)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString().length
}

function setCaretOffset(el: HTMLElement, offset: number): void {
  if (offset < 0) offset = 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let lastNode: Text | null = null

  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    lastNode = text
    if (remaining <= text.length) {
      const range = document.createRange()
      range.setStart(text, remaining)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
    remaining -= text.length
  }

  // Offset was past end — place cursor at end of last text node
  if (lastNode) {
    const range = document.createRange()
    range.setStart(lastNode, lastNode.length)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
}

function computeCursorPositions(
  wrapper: HTMLElement,
  div: HTMLElement,
  manager: CRDTManager,
  cursors: Record<string, CursorState>,
): Record<string, CursorPos> {
  const wrapperRect = wrapper.getBoundingClientRect()
  const positions: Record<string, CursorPos> = {}

  for (const [clientId, cursor] of Object.entries(cursors)) {
    if (!cursor.charId) continue
    const index = manager.getIndexOfCharId(cursor.charId)
    const targetIndex = index >= 0 ? index : manager.getText().length

    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
    let remaining = targetIndex
    let lastText: Text | null = null
    let placed = false

    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      lastText = text
      if (remaining <= text.length) {
        const range = document.createRange()
        range.setStart(text, remaining)
        range.collapse(true)
        const rect = range.getBoundingClientRect()
        positions[clientId] = {
          left: rect.left - wrapperRect.left,
          top: rect.top - wrapperRect.top,
          height: rect.height || 16,
          color: cursor.color,
          name: cursor.name,
        }
        placed = true
        break
      }
      remaining -= text.length
    }

    if (!placed && lastText) {
      const range = document.createRange()
      range.setStart(lastText, lastText.length)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      positions[clientId] = {
        left: rect.left - wrapperRect.left,
        top: rect.top - wrapperRect.top,
        height: rect.height || 16,
        color: cursor.color,
        name: cursor.name,
      }
    }
  }

  return positions
}

export default function Editor({ manager, cursors, readOnly, previewText }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const divRef = useRef<HTMLDivElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const isComposing = useRef(false)
  const compositionStartOffset = useRef(0)
  const cursorsRef = useRef(cursors)
  const [cursorPositions, setCursorPositions] = useState<Record<string, CursorPos>>({})
  const [tick, setTick] = useState(0)

  // Keep cursorsRef current for use inside the manager subscription closure
  useEffect(() => {
    cursorsRef.current = cursors
  }, [cursors])

  // Imperative DOM update — subscribed to manager, overridden by previewText in history view
  useEffect(() => {
    const div = divRef.current!
    div.textContent = previewText !== undefined ? previewText : manager.getText()

    return manager.subscribe(() => {
      if (previewText !== undefined) return
      const pending = pendingCaretRef.current
      pendingCaretRef.current = null
      const text = manager.getText()
      const hasFocus = document.activeElement === div

      if (pending !== null) {
        div.textContent = text
        if (hasFocus) setCaretOffset(div, pending)
      } else {
        const savedOffset = hasFocus ? getCaretOffset(div) : 0
        div.textContent = text
        if (hasFocus) setCaretOffset(div, Math.min(savedOffset, text.length))
      }

      setTick(t => t + 1)
    })
  }, [manager, previewText])

  // Cursor positions — recomputed after text changes (tick) or cursor data changes
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const div = divRef.current
    if (!wrapper || !div) return
    setCursorPositions(computeCursorPositions(wrapper, div, manager, cursors))
  }, [cursors, manager, tick])

  // beforeInput — all text mutations go through here
  useEffect(() => {
    if (readOnly) return
    const div = divRef.current!

    const handleBeforeInput = (e: Event) => {
      const event = e as InputEvent
      event.preventDefault()
      if (isComposing.current) return

      const offset = getCaretOffset(div)

      switch (event.inputType) {
        case 'insertText': {
          if (!event.data) break
          let pos = offset
          for (const ch of event.data) {
            const afterId = manager.getCharIdAtIndex(pos - 1)
            pendingCaretRef.current = pos + 1
            manager.localInsert(afterId, ch)
            pos++
          }
          break
        }
        case 'deleteContentBackward': {
          if (offset === 0) break
          const charId = manager.getCharIdAtIndex(offset - 1)
          pendingCaretRef.current = offset - 1
          manager.localDelete(charId)
          break
        }
        case 'deleteContentForward': {
          if (offset >= manager.getText().length) break
          const charId = manager.getCharIdAtIndex(offset)
          pendingCaretRef.current = offset
          manager.localDelete(charId)
          break
        }
        case 'insertParagraph':
        case 'insertLineBreak': {
          const afterId = manager.getCharIdAtIndex(offset - 1)
          pendingCaretRef.current = offset + 1
          manager.localInsert(afterId, '\n')
          break
        }
      }
    }

    div.addEventListener('beforeinput', handleBeforeInput)
    return () => div.removeEventListener('beforeinput', handleBeforeInput)
  }, [manager, readOnly])

  // IME composition
  useEffect(() => {
    if (readOnly) return
    const div = divRef.current!

    const handleCompositionStart = () => {
      isComposing.current = true
      compositionStartOffset.current = getCaretOffset(div)
    }

    const handleCompositionEnd = (e: CompositionEvent) => {
      isComposing.current = false
      const composed = e.data
      if (!composed) return
      // Reset browser IME changes; our CRDT is the source of truth
      div.textContent = manager.getText()
      let pos = compositionStartOffset.current
      for (const ch of composed) {
        const afterId = manager.getCharIdAtIndex(pos - 1)
        pendingCaretRef.current = pos + 1
        manager.localInsert(afterId, ch)
        pos++
      }
    }

    div.addEventListener('compositionstart', handleCompositionStart)
    div.addEventListener('compositionend', handleCompositionEnd as EventListener)
    return () => {
      div.removeEventListener('compositionstart', handleCompositionStart)
      div.removeEventListener('compositionend', handleCompositionEnd as EventListener)
    }
  }, [manager, readOnly])

  // Selection change → broadcast cursor position
  useEffect(() => {
    if (readOnly) return

    const handleSelectionChange = () => {
      const div = divRef.current
      if (!div) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      if (!div.contains(sel.anchorNode)) return
      const offset = getCaretOffset(div)
      manager.broadcastCursor(manager.getCharIdAtIndex(offset))
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [manager, readOnly])

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <div
        ref={divRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        style={{
          minHeight: '100%',
          padding: '24px 32px',
          outline: 'none',
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '15px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#1a1a1a',
        }}
      />
      {/* Remote cursor overlays — React-managed, pointer-events disabled */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        {Object.entries(cursorPositions).map(([clientId, pos]) => (
          <div
            key={clientId}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              height: pos.height,
              width: 2,
              backgroundColor: pos.color,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: -18,
                left: 0,
                backgroundColor: pos.color,
                color: '#fff',
                fontSize: 10,
                fontFamily: 'sans-serif',
                padding: '1px 4px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
                lineHeight: '16px',
              }}
            >
              {pos.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
