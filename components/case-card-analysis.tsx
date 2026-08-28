'use client'

import { useState, type ReactNode } from 'react'

import { AiRetryLink } from '@/components/ai-retry-button'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_CARD_LABEL_META, CASE_MEMO_FIELD_LABEL, deriveMissingFields, memoDirectionLabel } from '@/lib/cases'
import type { CaseCard, CaseCardAnalysis, CaseCardLabel, CaseCardMemo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** label quote → 原文着色区间；重叠与未命中的自动跳过。 */
function buildLabelSpans(text: string, labels: CaseCardLabel[]) {
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
  return spans.sort((a, b) => a.start - b.start)
}

/** 用分析标签给原文着色：quote 逐字命中即着色。 */
export function HighlightedCaseCardText({ text, labels }: { text: string; labels: CaseCardLabel[] }) {
  const spans = buildLabelSpans(text, labels)

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

const LABEL_SELECT_ITEMS = Object.entries(CASE_CARD_LABEL_META).map(([value, meta]) => ({ value, label: meta.label }))

/**
 * 标签整理模式：点击原文中的彩色下划线可改标签/删除；选中一段原文后可打标签。
 * 标签是 aiAnalysis 的派生数据（quote+type），原文永不改写。
 */
export function EditableHighlightedCaseCardText({ text, labels, onLabelsChange }: {
  text: string
  labels: CaseCardLabel[]
  onLabelsChange: (labels: CaseCardLabel[]) => void
}) {
  const [pendingQuote, setPendingQuote] = useState<string | null>(null)
  const [pendingType, setPendingType] = useState<string>(LABEL_SELECT_ITEMS[0].value)
  const [editingQuote, setEditingQuote] = useState<string | null>(null)
  const [editingType, setEditingType] = useState<string>('')
  const spans = buildLabelSpans(text, labels)

  function handleMouseUp() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const selected = selection.toString()
    if (!selected.trim()) return
    setEditingQuote(null)
    setPendingQuote(selected)
  }

  const editingLabel = labels.find((label) => label.quote === editingQuote)

  const nodes: ReactNode[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    if (span.start > cursor) nodes.push(<span key={`p${index}`}>{text.slice(cursor, span.start)}</span>)
    const meta = CASE_CARD_LABEL_META[span.label.type]
    nodes.push(
      <mark
        key={`l${index}`}
        role="button"
        tabIndex={0}
        title={`${meta?.label ?? span.label.type} · 点击修改`}
        onClick={() => {
          window.getSelection()?.removeAllRanges()
          setPendingQuote(null)
          setEditingQuote(span.label.quote)
          setEditingType(span.label.type)
        }}
        className="cursor-pointer rounded-sm hover:bg-muted"
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

  return (
    <div className="flex flex-col gap-2">
      {(pendingQuote != null || editingQuote != null) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-2 text-xs">
          {pendingQuote != null ? (
            <>
              <span className="max-w-md truncate text-muted-foreground">“{pendingQuote}”</span>
              <Select items={LABEL_SELECT_ITEMS} value={pendingType} onValueChange={(value) => setPendingType(value ?? pendingType)}>
                <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{LABEL_SELECT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-7"
                onClick={() => {
                  onLabelsChange([...labels.filter((label) => label.quote !== pendingQuote), { type: pendingType, quote: pendingQuote }])
                  window.getSelection()?.removeAllRanges()
                  setPendingQuote(null)
                }}
              >
                打标签
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPendingQuote(null)}>取消</Button>
            </>
          ) : (
            <>
              <span className="max-w-md truncate text-muted-foreground">“{editingQuote}” · 当前 {CASE_CARD_LABEL_META[editingType]?.label ?? editingType}</span>
              <Select items={LABEL_SELECT_ITEMS} value={editingType} onValueChange={(value) => setEditingType(value ?? editingType)}>
                <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{LABEL_SELECT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-7"
                onClick={() => {
                  onLabelsChange(labels.map((label) => (label.quote === editingQuote ? { type: editingType, quote: label.quote } : label)))
                  setEditingQuote(null)
                }}
              >
                改标签
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => {
                  onLabelsChange(labels.filter((label) => label.quote !== editingQuote))
                  setEditingQuote(null)
                }}
              >
                删除标签
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setEditingQuote(null)}>取消</Button>
            </>
          )}
        </div>
      )}
      <p onMouseUp={handleMouseUp} className="whitespace-pre-wrap text-sm leading-6 select-text">{nodes}</p>
      <p className="text-xs text-muted-foreground">点彩色下划线改标签；选中一段原文打新标签。</p>
    </div>
  )
}

/** memo 展示顺序（编辑模式同序）。 */
const MEMO_VIEW_KEYS = ['direction', 'entryPrice', 'stopLoss', 'target', 'confidence', 'invalidation', 'rejectedAlternatives', 'emotion'] as const

function MemoEditor({ memo, onDone, onSave }: {
  memo: Record<string, { value: string | number; quote?: string } | undefined>
  onDone: () => void
  onSave: (memo: CaseCardMemo) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const key of MEMO_VIEW_KEYS) {
      const field = memo[key]
      initial[key] = key === 'direction'
        ? (field ? String(field.value) : '')
        : field == null ? '' : String(field.value)
    }
    return initial
  })

  function save() {
    const next: Record<string, { value: string | number; quote?: string }> = {}
    for (const key of MEMO_VIEW_KEYS) {
      const value = draft[key]?.trim()
      if (!value) continue
      if (key === 'confidence') {
        // 与 Rust normalize_memo_value 同规则：0-100 数字，非法输入按未提到处理
        const parsed = Number(value.trimEnd().endsWith('%') ? value.trimEnd().slice(0, -1) : value)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) continue
        next[key] = { value: Math.round(parsed), quote: memo[key]?.quote }
        continue
      }
      next[key] = { value, quote: memo[key]?.quote }
    }
    onSave(next as unknown as CaseCardMemo)
    onDone()
  }

  return (
    <div className="flex flex-col gap-3">
      {MEMO_VIEW_KEYS.map((key) => (
        <label key={key} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-xs text-muted-foreground">{CASE_MEMO_FIELD_LABEL[key]}</span>
          {key === 'direction' ? (
            <Select
              items={[{ value: 'long', label: '做多' }, { value: 'short', label: '做空' }]}
              value={draft.direction || undefined}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, direction: value ?? '' }))}
            >
              <SelectTrigger className="h-8"><SelectValue placeholder="未填写" /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="long">做多</SelectItem>
                <SelectItem value="short">做空</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          ) : key === 'confidence' ? (
            <Input
              className="h-8"
              inputMode="numeric"
              placeholder="0-100"
              value={draft[key]}
              onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
            />
          ) : (
            <Input
              className="h-8"
              placeholder="未提到"
              value={draft[key]}
              onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>取消</Button>
        <Button size="sm" onClick={save}>保存修正</Button>
      </div>
    </div>
  )
}

interface CaseCardAnalysisViewProps {
  card: CaseCard
  busy: boolean
  onRetry: (instruction?: string) => void
  /** 提供时开放人工修正（memo 编辑、标签整理、过期忽略）。 */
  onEditAnalysis?: (updater: (prev: CaseCardAnalysis) => CaseCardAnalysis) => void
}

/**
 * 分析落库后的紧凑落款行：图例 · 缺失字段 · 模型与时间 · 详情/带要求重试。
 * 结构化详情（memo 网格与原文引用）收进 Popover，不占卡片正文。
 */
export function CaseCardAnalysisView({ card, busy, onRetry, onEditAnalysis }: CaseCardAnalysisViewProps) {
  const [editingMemo, setEditingMemo] = useState(false)
  const analysis = card.aiAnalysis
  if (!analysis) return null
  const staleRaw = card.rawTextEditedAt != null && analysis.analyzedAt < card.rawTextEditedAt
  const staleDismissed = (analysis.staleDismissedAt ?? 0) >= (card.rawTextEditedAt ?? 0)
  const stale = staleRaw && !staleDismissed
  const memo = analysis.memo ?? {}
  const hasMemo = Object.keys(memo).length > 0
  const usedTypes = [...new Set(analysis.labels.map((label) => label.type))]

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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                title="原文在整理后修改过；可重新识别或忽略本次过期"
              />
            }
          >
            已过期 ▾
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onRetry()}>重新识别</DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onEditAnalysis?.((prev) => ({ ...prev, staleDismissedAt: card.rawTextEditedAt ?? Date.now() }))}
            >
              忽略本次过期
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <span className="font-mono">{analysis.model} · <RelativeTime ms={analysis.analyzedAt} /></span>
      {analysis.userAdjusted && <span title="人工修正过标签或 memo">已手动修正</span>}
      <AiRetryLink busy={busy} onRetry={onRetry} />
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
          <PopoverContent className="w-96 p-0">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">入场 memo · 原文引用</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{analysis.model}</span>
                {onEditAnalysis && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setEditingMemo((prev) => !prev)}
                  >
                    {editingMemo ? '退出编辑' : '修正'}
                  </Button>
                )}
              </div>
            </div>
            {editingMemo ? (
              <div className="max-h-96 overflow-y-auto p-3">
                <MemoEditor
                  memo={memo as Record<string, { value: string | number; quote?: string } | undefined>}
                  onDone={() => setEditingMemo(false)}
                  onSave={(next) => onEditAnalysis?.((prev) => ({
                    ...prev,
                    memo: next,
                    missingFields: deriveMissingFields(next as unknown as Record<string, { value: string | number } | null | undefined>),
                  }))}
                />
              </div>
            ) : (
              <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
                {MEMO_VIEW_KEYS.map((key) => {
                  const field = (memo as Record<string, { value: string | number; quote?: string } | undefined>)[key]
                  const missing = analysis.missingFields.includes(key)
                  if (!field && !missing) return null
                  return (
                    <div key={key} className="flex gap-3 px-3 py-2">
                      <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">{CASE_MEMO_FIELD_LABEL[key] ?? key}</span>
                      <div className="min-w-0 flex-1">
                        {key === 'direction' && field && memoDirectionLabel(field.value) ? (
                          <p className={cn('text-sm font-medium', memoDirectionLabel(field.value) === '做多' ? 'text-profit' : 'text-loss')}>
                            {memoDirectionLabel(field.value) === '做多' ? '做多 ↑' : '做空 ↓'}
                          </p>
                        ) : (
                          <p className={cn('break-words text-sm', missing && 'text-amber-600 dark:text-amber-400')}>
                            {field ? field.value : '未提到'}
                          </p>
                        )}
                        {field?.quote && (
                          <p className="mt-1 break-words border-l-2 border-border pl-2 text-xs italic leading-5 text-muted-foreground">
                            {field.quote}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
