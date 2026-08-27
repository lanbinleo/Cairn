'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

interface AiRetryLinkProps {
  onRetry: (instruction?: string) => void
  busy?: boolean
}

/**
 * AI 识别的「带要求重试」入口：落款行里的小文字链接，
 * 点开弹小窗输入一段补充要求（例如"止损不是 41650，注意口语里的位置词"）再重试。
 * 直接重试走卡片头部的主按钮。
 */
export function AiRetryLink({ onRetry, busy = false }: AiRetryLinkProps) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')

  function run() {
    setOpen(false)
    const trimmed = instruction.trim()
    setInstruction('')
    onRetry(trimmed || undefined)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={busy}
            className="rounded-sm px-1 py-0.5 underline decoration-dotted underline-offset-2 hover:text-foreground disabled:opacity-50"
          />
        }
      >
        带要求重试
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-2">
          <Textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                run()
              }
            }}
            placeholder="这次哪里识别错了、要怎么整理（选填）"
            className="text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setOpen(false)}>取消</Button>
            <Button size="sm" className="h-7" disabled={busy} onClick={run}>重试</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
