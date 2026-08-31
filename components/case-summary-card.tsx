'use client'

import { useEffect, useMemo, useRef } from 'react'
import { NotebookPen, RefreshCw, Sparkles } from 'lucide-react'

import { AiRetryLink } from '@/components/ai-retry-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoHint } from '@/components/info-hint'
import { RelativeTime } from '@/components/relative-time'
import { parseSummaryMarkup, stripSummaryMarkup, type SummaryMarkupKind } from '@/lib/summary-markup'
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

/** 流式生成中的原始输出直出（总结输出是 JSON，提示词不动）；自动滚到底，完成/失败后由父级替换。 */
function SummaryStreamPreview({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      aria-live="polite"
      className="max-h-48 overflow-y-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-muted-foreground"
    >
      {text}
    </div>
  )
}

/** 受限标注渲染（0.3.4）：加粗 = 关键事实；红/绿下划线 = 问题偏差 / 执行到位，
 *  着色样式与卡片标签的下划线同款。历史总结（无标注）原样通过。 */
function SummaryMarkedText({ kind, text }: { kind: SummaryMarkupKind; text: string }) {
  if (kind === 'bold') return <strong className="font-semibold text-foreground">{text}</strong>
  const color = kind === 'red' ? '#f87171' : '#4ade80'
  return (
    <span
      style={{
        textDecoration: 'underline',
        textDecorationColor: color,
        textDecorationThickness: '2px',
        textUnderlineOffset: '3px',
      }}
    >
      {text}
    </span>
  )
}

function SummaryRichText({ text }: { text: string }) {
  const segments = useMemo(() => parseSummaryMarkup(text), [text])
  if (segments.length === 1 && segments[0].kind === 'plain') return <>{text}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'plain'
          ? <span key={index}>{segment.text}</span>
          : <SummaryMarkedText key={index} kind={segment.kind} text={segment.text} />,
      )}
    </>
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
  const { summarizeCase, updateTrade, aiTasks, aiTaskList } = useCairn()
  // busy/error 是 store 级状态：AI 调用长达几十秒，切页回来仍能看到「生成中」或失败原因
  const busy = aiTasks.summarizingCaseIds.includes(caseRecord.id)
  const error = aiTasks.summaryErrorByCase[caseRecord.id] ?? ''
  const runningTask = aiTaskList.find(
    (task) => task.kind === 'summary' && task.status === 'running' && task.targetId === caseRecord.id,
  )
  const streamText = runningTask?.streamText ?? ''
  const thinkingSeconds = ((runningTask?.thinkingMs ?? 0) / 1000).toFixed(1)
  const progressLine = runningTask?.phase === 'thinking'
    ? `思考中 · ${thinkingSeconds}s`
    : (runningTask?.thinkingMs ?? 0) > 0 || (runningTask?.outputChars ?? 0) > 0
      ? `${(runningTask?.thinkingMs ?? 0) > 0 ? `思考 ${thinkingSeconds}s · ` : ''}已输出 ${runningTask?.outputTokens != null ? `${runningTask.outputTokens} tokens` : `${runningTask?.outputChars ?? 0} 字`}`
      : ''
  const summary = caseRecord.aiSummary
  const stale = isCaseSummaryStale(caseRecord, cards)
  const caseCards = cards.filter((card) => card.caseId === caseRecord.id)

  async function run(instruction?: string) {
    // 失败不抛出：store 已记录原因，本组件从 aiTasks 读取显示
    await summarizeCase(caseRecord.id, instruction)
  }

  function fillNote() {
    if (!trade) return
    if (trade.note && !window.confirm('重新填入会整体替换当前复盘备注，继续？')) return
    // 复盘备注是纯文本渲染：标注记号剥掉，只留文字
    const draft = [
      `【AI 总结草稿】${summary?.overview ?? ''}`,
      '',
      stripSummaryMarkup(summary?.narrative ?? ''),
      summary && summary.highlights.length > 0 ? `\n要点：\n${summary.highlights.map((item) => `- ${item}`).join('\n')}` : '',
    ].join('\n').trim() + '\n'
    updateTrade(trade.id, { note: draft })
  }

  if (!summary) {
    if (caseCards.length === 0) return null
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              把卡片记录和实际成交对照，生成一段整单复盘（只摆事实，不打分）。
            </p>
            <Button size="sm" disabled={busy} onClick={() => void run()}>
              <Sparkles className={cn('size-4', busy && 'animate-pulse')} data-icon="inline-start" />
              {busy ? '生成中…' : '生成总结'}
            </Button>
          </div>
          {busy && progressLine && <p className="text-xs text-muted-foreground">{progressLine}</p>}
          {busy && streamText && <SummaryStreamPreview text={streamText} />}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</p>}
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
            {trade && (
              <Button size="sm" variant="outline" disabled={busy} onClick={fillNote}>
                <NotebookPen data-icon="inline-start" />{trade.note ? '重新填入' : '填入复盘备注'}
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
        {busy && progressLine && <p className="text-xs text-muted-foreground">{progressLine}</p>}
        {busy && streamText && <SummaryStreamPreview text={streamText} />}
        {variant === 'compact' ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6"><SummaryRichText text={firstParagraph} /></p>
            {summary.highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.highlights.map((item, index) => <Badge key={index} variant="secondary" className="max-w-full font-normal">{item}</Badge>)}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6"><SummaryRichText text={summary.narrative} /></p>
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
          <InfoHint>只摆事实与偏差，不打分——过程评价永远是你自己的。觉得总结偏了？点右侧链接，带着要求重试。</InfoHint>
          <AiRetryLink onRetry={(instruction) => void run(instruction)} busy={busy} />
        </div>
      </CardContent>
    </Card>
  )
}
