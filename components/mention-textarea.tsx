'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { AttachmentImage } from '@/components/attachment-image'
import { Textarea } from '@/components/ui/textarea'
import { insertAtCursor, readPastedImage } from '@/lib/clipboard-images'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

type Suggestion =
  | { kind: 'trade'; label: string; detail: string; token: string }
  | { kind: 'image'; label: string; detail: string; token: string; imageRef: string; tradeId: string; imageIndex: number }

interface MentionTextareaProps {
  id?: string
  rows?: number
  value: string
  onChange: (value: string) => void
  noteId?: string
}

function mentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret)
  const match = before.match(/@([A-Za-z0-9_-]*)$/)
  if (!match || match.index == null) return null
  return { query: match[1] ?? '', start: match.index, end: caret }
}

function compactSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isDataUrl(value: string) {
  return value.startsWith('data:')
}

export function MentionTextarea({ id, rows, value, onChange, noteId }: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { trades, symbols, attachments, symbolLabel, createImageAttachment, updateTrade } = useCairn()
  const [activeQuery, setActiveQuery] = useState<{ query: string; start: number; end: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [popupRect, setPopupRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!activeQuery) return []
    const query = activeQuery.query.toLowerCase()
    const wantsImage = query.startsWith('img')

    const tradeSuggestions: Suggestion[] = wantsImage
      ? []
      : trades.map((trade) => {
          const symbol = symbols.find((item) => item.id === trade.symbolId)
          return {
            kind: 'trade',
            label: `Trade #${String(trade.seq).padStart(3, '0')}`,
            detail: `${symbol ? `${symbol.exchange}:${symbol.code}` : symbolLabel(trade.symbolId)} · ${trade.direction} · ${trade.status}`,
            token: `[[trade:${trade.id}]]`,
          }
        })

    const imageSuggestions: Suggestion[] = trades.flatMap((trade) =>
      trade.referenceImages.map((src, index) => {
        const attachment = attachments.find((item) => item.id === src || (item.ownerType === 'trade' && item.ownerId === trade.id && item.relativePath === src))
        const imageRef = attachment?.id ?? src
        return {
          kind: 'image',
          label: `IMG · Trade #${String(trade.seq).padStart(3, '0')} · ${index + 1}`,
          detail: symbolLabel(trade.symbolId),
          token: `[[image:${imageRef}]]`,
          imageRef,
          tradeId: trade.id,
          imageIndex: index,
        }
      }),
    )

    const all = wantsImage ? imageSuggestions : [...tradeSuggestions, ...imageSuggestions]
    if (!query || query === 'img') return all.slice(0, 8)
    const compactQuery = compactSearchText(query)
    return all
      .filter((item) => {
        const text = `${item.label} ${item.detail}`.toLowerCase()
        return text.includes(query) || compactSearchText(text).includes(compactQuery)
      })
      .slice(0, 8)
  }, [activeQuery, trades, symbols, attachments, symbolLabel])

  function refreshQuery(caret: number, nextValue = value) {
    const next = mentionQuery(nextValue, caret)
    setActiveQuery(next)
    setActiveIndex(0)
  }

  async function insertSuggestion(item: Suggestion) {
    if (!activeQuery) return
    let token = item.token
    if (item.kind === 'image' && isDataUrl(item.imageRef)) {
      const trade = trades.find((candidate) => candidate.id === item.tradeId)
      if (trade) {
        const attachment = await createImageAttachment({
          ownerType: 'trade',
          ownerId: trade.id,
          kind: 'reference-image',
          fileName: `trade-${String(trade.seq).padStart(3, '0')}-image-${item.imageIndex + 1}.png`,
          contentDataUrl: item.imageRef,
        })
        const nextImages = [...trade.referenceImages]
        nextImages[item.imageIndex] = attachment.id
        updateTrade(trade.id, { referenceImages: nextImages })
        token = `[[image:${attachment.id}]]`
      }
    }
    const next = `${value.slice(0, activeQuery.start)}${token}${value.slice(activeQuery.end)}`
    onChange(next)
    setActiveQuery(null)
    requestAnimationFrame(() => {
      const caret = activeQuery.start + token.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  useLayoutEffect(() => {
    if (!activeQuery || suggestions.length === 0) {
      setPopupRect(null)
      return
    }

    function updatePopupRect() {
      const el = textareaRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = Math.min(rect.width, window.innerWidth - 32)
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16)
      const belowTop = rect.bottom + 8
      const belowHeight = window.innerHeight - belowTop - 16
      const aboveHeight = rect.top - 16
      if (belowHeight >= 160 || belowHeight >= aboveHeight) {
        setPopupRect({ top: belowTop, left, width, maxHeight: Math.max(120, Math.min(288, belowHeight)) })
        return
      }
      const maxHeight = Math.max(120, Math.min(288, aboveHeight))
      setPopupRect({ top: Math.max(16, rect.top - maxHeight - 8), left, width, maxHeight })
    }

    updatePopupRect()
    window.addEventListener('resize', updatePopupRect)
    window.addEventListener('scroll', updatePopupRect, true)
    return () => {
      window.removeEventListener('resize', updatePopupRect)
      window.removeEventListener('scroll', updatePopupRect, true)
    }
  }, [activeQuery, suggestions.length])

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          refreshQuery(event.target.selectionStart, event.target.value)
        }}
        onClick={(event) => refreshQuery(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (activeQuery && suggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => (index + 1) % suggestions.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              void insertSuggestion(suggestions[activeIndex])
              return
            }
            if (event.key === 'Escape') {
              setActiveQuery(null)
              return
            }
          }
        }}
        onPaste={(event) => {
          const start = event.currentTarget.selectionStart
          const end = event.currentTarget.selectionEnd
          void readPastedImage(event).then((dataUrl) => {
            if (!dataUrl || !noteId) return
            void createImageAttachment({
              ownerType: 'note',
              ownerId: noteId,
              kind: 'note-image',
              fileName: `note-${noteId}-image.png`,
              contentDataUrl: dataUrl,
            }).then((attachment) => {
              onChange(insertAtCursor(value, `[[image:${attachment.id}]]`, start, end))
            })
          })
        }}
      />
      {activeQuery &&
        suggestions.length > 0 &&
        popupRect &&
        createPortal(
          <div
            className="fixed z-[100] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            style={{
              top: popupRect.top,
              left: popupRect.left,
              width: popupRect.width,
              maxHeight: popupRect.maxHeight,
            }}
          >
            {suggestions.map((item, index) => (
              <button
                key={`${item.kind}-${item.token.slice(0, 80)}-${index}`}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm',
                  index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
                )}
                onMouseDown={(event) => {
                  event.preventDefault()
                  void insertSuggestion(item)
                }}
              >
                {item.kind === 'image' && <AttachmentImage imageRef={item.imageRef} alt="" className="size-10 rounded border object-cover" />}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
