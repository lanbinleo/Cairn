'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface AiRetryButtonProps {
  onRetry: (instruction?: string) => void
  busy?: boolean
  label?: string
}

/**
 * AI 识别通用重试：主按钮直接重跑；悬浮出现的小按钮打开下拉，
 * 可输入一段补充要求（例如"止损不是 41650，注意口语里的位置词"）再重试。
 */
export function AiRetryButton({ onRetry, busy = false, label = '重新识别' }: AiRetryButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  function runWithInstruction() {
    setMenuOpen(false)
    const trimmed = instruction.trim()
    setInstruction('')
    onRetry(trimmed || undefined)
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-stretch">
      <Button
        variant="outline"
        size="sm"
        className="h-7 rounded-r-none pr-2"
        disabled={busy}
        onClick={() => onRetry()}
      >
        <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} data-icon="inline-start" />
        {label}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 rounded-l-none border-l-0 px-1.5"
        aria-expanded={menuOpen}
        title="带要求重试"
        disabled={busy}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
          <Textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="这次哪里识别错了、要怎么整理（选填）"
            className="text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setMenuOpen(false)}>取消</Button>
            <Button size="sm" className="h-7" disabled={busy} onClick={runWithInstruction}>带要求重试</Button>
          </div>
        </div>
      )}
    </div>
  )
}
