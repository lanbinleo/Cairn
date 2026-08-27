'use client'

import type { ReactNode } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CASE_CARD_LABEL_META, CASE_MEMO_FIELD_LABEL } from '@/lib/cases'
import type { CaseCard, CaseCardLabel } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 用分析标签给原文着色：quote 逐字命中即着色，重叠与未命中的自动跳过。 */
export function HighlightedCaseCardText({ text, labels }: { text: string; labels: CaseCardLabel[] }) {
  const spans: Array<{ start: number; end: number; label: CaseCardLabel }> = []
  const taken: Array<[number, number]> = []
  for (const label of labels) {
    if (!label.quote) continue
    let from = 0
    for (;;) {
      const index = text.indexOf(label.quote, from)
      if (index === -1) break
      const end = index + label.quote.length
      if (!taken.some(([start, stop]) => index < stop && end > start)) {
        taken.push([index, end])
        spans.push({ start: index, end, label })
        break
      }
      from = index + 1
    }
  }
  spans.sort((a, b) => a.start - b.start)

  const nodes: ReactNode[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    if (span.start > cursor) nodes.push(<span key={`p${index}`}>{text.slice(cursor, span.start)}</span>)
    const meta = CASE_CARD_LABEL_META[span.label.type]
    nodes.push(
      <mark
        key={`l${index}`}
        title={meta ? `${meta.label}` : span.label.type}
        style={{
          background: 'transparent',
          color: 'inherit',
          textDecoration: 'underline',
          textDecorationColor: meta?.color,
          textDecorationThickness: '2px',
          textUnderlineOffset: '3px',
        }}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    )
    cursor = span.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)
  return <p className="whitespace-pre-wrap text-sm leading-6">{nodes}</p>
}

function fmtShortUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + ' UTC'
}

/**
 * 分析落库后的紧凑落款行：图例 · 缺失字段 · 模型与时间。
 * 结构化详情（memo 网格与原文引用）收进 Popover，不占卡片正文。
 */
export function CaseCardAnalysisView({ card }: { card: CaseCard }) {
  const analysis = card.aiAnalysis
  if (!analysis) return null
  const stale = card.rawTextEditedAt != null && analysis.analyzedAt < card.rawTextEditedAt
  const memo = analysis.memo ?? {}
  const hasMemo = Object.keys(memo).length > 0
  const usedTypes = [...new Set(analysis.labels.map((label) => label.type))]
  const fullTime = new Date(analysis.analyzedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
      {usedTypes.map((type) => {
        const meta = CASE_CARD_LABEL_META[type]
        return (
          <span key={type} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ background: meta?.color }} />
            {meta?.label ?? type}
          </span>
        )
      })}
      {analysis.missingFields.length > 0 && (
        <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
          缺：{analysis.missingFields.map((key) => CASE_MEMO_FIELD_LABEL[key] ?? key).join('、')}
        </span>
      )}
      {stale && (
        <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400" title="原文在整理后修改过，建议重新识别">
          已过期
        </span>
      )}
      <span className="font-mono" title={fullTime}>{analysis.model} · {fmtShortUtc(analysis.analyzedAt)}</span>
      {hasMemo && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="rounded-sm px-1 py-0.5 underline decoration-dotted underline-offset-2 hover:text-foreground"
              />
            }
          >
            详情
          </PopoverTrigger>
          <PopoverContent className="w-96">
            <div className="grid grid-cols-2 gap-2">
              {['direction', 'stopLoss', 'target', 'confidence', 'invalidation', 'rejectedAlternatives', 'emotion'].map((key) => {
                const field = (memo as Record<string, { value: string | number; quote?: string } | undefined>)[key]
                const missing = analysis.missingFields.includes(key)
                if (!field && !missing) return null
                return (
                  <div
                    key={key}
                    className={cn('rounded-md border px-2.5 py-1.5', missing ? 'border-dashed border-amber-500/40' : 'border-border')}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{CASE_MEMO_FIELD_LABEL[key] ?? key}</span>
                      <span className={cn('text-sm', missing && 'text-amber-600 dark:text-amber-400')}>
                        {field ? field.value : '未提到'}
                      </span>
                    </div>
                    {field?.quote && <p className="mt-0.5 text-xs italic text-muted-foreground">「{field.quote}」</p>}
                  </div>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
