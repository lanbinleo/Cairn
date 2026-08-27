'use client'

import type { ReactNode } from 'react'

import { AiRetryButton } from '@/components/ai-retry-button'
import { CASE_CARD_LABEL_META, CASE_MEMO_FIELD_LABEL } from '@/lib/cases'
import { fmtUtcDateTime } from '@/lib/format'
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

interface CaseCardAnalysisViewProps {
  card: CaseCard
  busy: boolean
  onRetry: (instruction?: string) => void
}

/** 卡片的 AI 整理结果：memo 网格、缺失字段、标签图例、溯源与重试。 */
export function CaseCardAnalysisView({ card, busy, onRetry }: CaseCardAnalysisViewProps) {
  const analysis = card.aiAnalysis
  if (!analysis) return null
  const stale = card.rawTextEditedAt != null && analysis.analyzedAt < card.rawTextEditedAt
  const memo = analysis.memo ?? {}
  const usedTypes = [...new Set(analysis.labels.map((label) => label.type))]

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-background/70 p-3">
      {stale && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          原文在整理后修改过，结果可能已过期，建议重新识别。
        </p>
      )}

      {Object.keys(memo).length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {['direction', 'stopLoss', 'target', 'confidence', 'invalidation', 'rejectedAlternatives', 'emotion'].map((key) => {
            const field = (memo as Record<string, { value: string | number; quote?: string } | undefined>)[key]
            const missing = analysis.missingFields.includes(key)
            return (
              <div
                key={key}
                className={cn('rounded-md border px-2.5 py-1.5', missing ? 'border-dashed border-amber-500/40' : 'border-border')}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{CASE_MEMO_FIELD_LABEL[key] ?? key}</span>
                  <span className={cn('text-sm', missing && 'text-amber-600 dark:text-amber-400')}>
                    {field ? field.value : missing ? '未提到' : '—'}
                  </span>
                </div>
                {field?.quote && <p className="mt-0.5 text-xs italic text-muted-foreground">「{field.quote}」</p>}
              </div>
            )
          })}
        </div>
      )}

      {analysis.labels.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {usedTypes.map((type) => {
            const meta = CASE_CARD_LABEL_META[type]
            return (
              <span key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: meta?.color }} />
                {meta?.label ?? type}
              </span>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {analysis.model} · {fmtUtcDateTime(analysis.analyzedAt)}
        </span>
        <AiRetryButton busy={busy} onRetry={onRetry} />
      </div>
    </div>
  )
}
