'use client'

import { useMemo, useRef, useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { insertAtCursor, readPastedImage } from '@/lib/clipboard-images'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

type Suggestion =
  | { kind: 'trade'; label: string; detail: string; token: string }
  | { kind: 'image'; label: string; detail: string; token: string; src: string }

interface MentionTextareaProps {
  id?: string
  rows?: number
  value: string
  onChange: (value: string) => void
}

function mentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret)
  const match = before.match(/@([A-Za-z0-9_-]*)$/)
  if (!match || match.index == null) return null
  return { query: match[1] ?? '', start: match.index, end: caret }
}

export function MentionTextarea({ id, rows, value, onChange }: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { trades, symbols, symbolLabel } = useCairn()
  const [activeQuery, setActiveQuery] = useState<{ query: string; start: number; end: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

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
      trade.referenceImages.map((src, index) => ({
        kind: 'image',
        label: `IMG · Trade #${String(trade.seq).padStart(3, '0')} · ${index + 1}`,
        detail: symbolLabel(trade.symbolId),
        token: `[[image:${src}]]`,
        src,
      })),
    )

    const all = wantsImage ? imageSuggestions : [...tradeSuggestions, ...imageSuggestions]
    if (!query || query === 'img') return all.slice(0, 8)
    return all
      .filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [activeQuery, trades, symbols, symbolLabel])

  function refreshQuery(caret: number, nextValue = value) {
    const next = mentionQuery(nextValue, caret)
    setActiveQuery(next)
    setActiveIndex(0)
  }

  function insertSuggestion(item: Suggestion) {
    if (!activeQuery) return
    const next = `${value.slice(0, activeQuery.start)}${item.token}${value.slice(activeQuery.end)}`
    onChange(next)
    setActiveQuery(null)
    requestAnimationFrame(() => {
      const caret = activeQuery.start + item.token.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

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
              insertSuggestion(suggestions[activeIndex])
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
            if (dataUrl) onChange(insertAtCursor(value, `[[image:${dataUrl}]]`, start, end))
          })
        }}
      />
      {activeQuery && suggestions.length > 0 && (
        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
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
                insertSuggestion(item)
              }}
            >
              {item.kind === 'image' && (
                <img src={item.src} alt="" className="size-10 rounded border object-cover" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{item.label}</span>
                <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
