'use client'

import { useState } from 'react'
import { NotebookPen, RefreshCw, Sparkles } from 'lucide-react'

import { AiRetryLink } from '@/components/ai-retry-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RelativeTime } from '@/components/relative-time'
import { useCairn } from '@/lib/store'
import type { CaseCard, Trade, TradeCase } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 卡片晚于总结生成/修改 → 总结过期（复用分析过期的心智模型）。 */
export function isCaseSummaryStale(caseRecord: TradeCase, cards: CaseCard[]): boolean {
  const summary = caseRecord.aiSummary
  if (!summary) return false
  return cards.some(
    (card) => card.caseId === caseRecord.id && (card.createdAt > summary.analyzedAt || (card.rawTextEditedAt ?? 0) > summary.analyzedAt),
  )
}

/**
 * 整单 AI 总结卡。full = 完整版（Trade 复盘 Tab / 未绑定 Case 页）；
 * compact = Case 页轻量摘要（overview + 首段 + 生成入口）。
 * 总结只摆事实与偏差，不打分——过程评价永远留给交易者。
 */
export function CaseSummaryCard({
  caseRecord,
  cards,
  variant = 'full',
  trade,
}: {
  caseRecord: TradeCase
  cards: CaseCard[]
  variant?: 'full' | 'compact'
  trade?: Trade | null
}) {
  const { summarizeCase, updateTrade } = useCairn()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const summary = caseRecord.aiSummary
  const stale = isCaseSummaryStale(caseRecord, cards)
  const caseCards = cards.filter((card) => card.caseId === caseRecord.id)

  async function run(instruction?: string) {
    setBusy(true)
    setError('')
    try {
      await summarizeCase(caseRecord.id, instruction)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function fillNote() {
    if (!trade || trade.note) return
    const draft = [
      `【AI 总结草稿】${summary?.overview ?? ''}`,
      '',
      summary?.narrative ?? '',
      summary && summary.highlights.length > 0 ? `\n要点：\n${summary.highlights.map((item) => `- ${item}`).join('\n')}` : '',
    ].join('\n').trim() + '\n'
    updateTrade(trade.id, { note: draft })
  }

  if (!summary) {
    if (caseCards.length === 0) return null
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-sm text-muted-foreground">
            AI 可以串联卡片心路{trade ? '、成交与计划偏差' : ''}，生成一版整单复盘总结（只摆事实，不打分）。
          </p>
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            <Sparkles data-icon="inline-start" />生成总结
          </Button>
        </CardContent>
      </Card>
    )
  }

  const firstParagraph = summary.narrative.split('\n\n')[0] ?? ''

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Sparkles className="size-4 shrink-0 text-amber-500" />AI 总结
              {stale && <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">卡片已更新，总结过期</span>}
            </CardTitle>
            <CardDescription className="min-w-0">
              {summary.overview} · 由 {summary.model} 生成 <RelativeTime ms={summary.analyzedAt} />
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {trade && !trade.note && (
              <Button size="sm" variant="outline" disabled={busy} onClick={fillNote}>
                <NotebookPen data-icon="inline-start" />填入复盘备注
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
              <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} data-icon="inline-start" />
              重新总结
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</p>}
        {variant === 'compact' ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6">{firstParagraph}</p>
            {summary.highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.highlights.map((item, index) => <Badge key={index} variant="secondary" className="max-w-full font-normal">{item}</Badge>)}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6">{summary.narrative}</p>
            {summary.highlights.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {summary.highlights.map((item, index) => (
                  <p key={index} className="flex gap-2 text-sm"><span className="text-muted-foreground">·</span>{item}</p>
                ))}
              </div>
            )}
            {summary.missing.length > 0 && (
              <p className="text-xs text-muted-foreground">缺失/对不上：{summary.missing.join('；')}</p>
            )}
          </>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          只摆事实与偏差，不打分——过程评价永远是你自己的
          <AiRetryLink onRetry={(instruction) => void run(instruction)} busy={busy} />
        </div>
      </CardContent>
    </Card>
  )
}
