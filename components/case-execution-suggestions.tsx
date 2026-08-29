'use client'

import { useState } from 'react'
import { Check, Pencil, RefreshCw, Sparkles, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtUtcDateTime } from '@/lib/format'
import { useCairn } from '@/lib/store'
import type { CaseExecutionSuggestion, Execution, Trade, TradeCase } from '@/lib/types'
import { cn } from '@/lib/utils'

const SUGGESTION_ACTION_LABEL: Record<CaseExecutionSuggestion['action'], string> = {
  stop: '移动止损',
  'target-moved': '移动止盈',
  'order-edit': '修改订单',
}

function makeExecutionId() {
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function suggestionToExecution(suggestion: CaseExecutionSuggestion, trade: Trade, time: number | null): Execution {
  return {
    id: makeExecutionId(),
    tradeId: trade.id,
    action: suggestion.action,
    orderType: suggestion.orderType,
    time: time ?? Date.now(),
    price: suggestion.price,
    signal: suggestion.signal,
    note: `来自 Case 卡片：「${suggestion.quote}」`,
  }
}

/**
 * AI 持仓管理补录建议审阅区（Trade 页 Case Tab）。
 * 建议永远是候选：直接添加 / 修改后添加（打开编辑对话框预填草稿）/ 忽略。
 * 时间由 barRef 机械换算（resolveCaseCardTimesForTrade），AI 不算时间。
 */
export function CaseExecutionSuggestions({
  trade,
  caseRecord,
  cardTimes,
  onJumpCard,
  onEditPrefill,
}: {
  trade: Trade
  caseRecord: TradeCase
  /** 卡片 → 换算时间（Trade 页的 resolveCaseCardTimesForTrade 结果） */
  cardTimes: Map<string, { time: number; invalid: boolean }>
  /** 点击证据跳到对应卡片（Case Tab 内定位） */
  onJumpCard: (cardId: string) => void
  /** 「修改后添加」：由页面构造草稿并打开 EditTradeDialog 预填 */
  onEditPrefill: (suggestion: CaseExecutionSuggestion, draft: Execution) => void
}) {
  const { updateTrade, refreshCaseExecutionSuggestions, setCaseExecutionSuggestionStatus } = useCairn()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blob = caseRecord.aiExecutionSuggestions
  const suggestions = blob?.suggestions ?? []
  const pending = suggestions.filter((item) => item.status === 'pending')
  const accepted = suggestions.filter((item) => item.status === 'accepted').length
  const dismissed = suggestions.filter((item) => item.status === 'dismissed').length

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      await refreshCaseExecutionSuggestions(caseRecord.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function resolvedTime(suggestion: CaseExecutionSuggestion): number | null {
    return cardTimes.get(suggestion.cardId)?.time ?? null
  }

  function accept(suggestion: CaseExecutionSuggestion) {
    const execution = suggestionToExecution(suggestion, trade, resolvedTime(suggestion))
    updateTrade(trade.id, {
      executions: [...trade.executions, execution].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
    })
    setCaseExecutionSuggestionStatus(caseRecord.id, suggestion.id, {
      status: 'accepted',
      acceptedExecutionId: execution.id,
    })
  }

  function editThenAccept(suggestion: CaseExecutionSuggestion) {
    onEditPrefill(suggestion, suggestionToExecution(suggestion, trade, resolvedTime(suggestion)))
  }

  // 从未跑过检查：一行提示 + 手动按钮（绑定建立时通常已自动跑过）
  if (!blob) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-sm text-muted-foreground">AI 可以对照卡片原话检查没落库的止盈止损动作。</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
            <Sparkles data-icon="inline-start" />AI 检查持仓动作
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-amber-500" />AI 检查
              {pending.length > 0 && <Badge variant="secondary">{pending.length} 条待确认</Badge>}
            </CardTitle>
            <CardDescription>
              卡片里说过、但成交记录里没有的管理动作（止盈/止损/改单）；开平仓以导入成交为准。
              {accepted + dismissed > 0 && ` 已处理 ${accepted + dismissed} 条（${accepted} 已添加 · ${dismissed} 已忽略）。`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} data-icon="inline-start" />
            重新检查
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</p>}
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            没有待确认的建议{accepted + dismissed === 0 ? '——卡片提到的管理动作都已落库' : ''}。
          </p>
        ) : pending.map((suggestion) => {
          const time = resolvedTime(suggestion)
          return (
            <div key={suggestion.id} className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{SUGGESTION_ACTION_LABEL[suggestion.action]}</Badge>
                {suggestion.price != null && <span className="font-mono text-sm font-medium">{suggestion.price}</span>}
                {suggestion.anchorText && <span className="text-sm text-muted-foreground">{suggestion.anchorText}</span>}
                {suggestion.signal && <span className="text-xs text-muted-foreground">· {suggestion.signal}</span>}
                {suggestion.barRef != null && <Badge variant="secondary">BAR {suggestion.barRef}</Badge>}
                {time != null && <span className="font-mono text-xs text-muted-foreground">{fmtUtcDateTime(time, false)}</span>}
              </div>
              <button
                type="button"
                className="max-w-3xl truncate text-left text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                title={suggestion.quote}
                onClick={() => onJumpCard(suggestion.cardId)}
              >
                证据：「{suggestion.quote}」
              </button>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="h-8" onClick={() => accept(suggestion)}>
                  <Check data-icon="inline-start" />直接添加
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => editThenAccept(suggestion)}>
                  <Pencil data-icon="inline-start" />修改后添加
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  onClick={() => setCaseExecutionSuggestionStatus(caseRecord.id, suggestion.id, { status: 'dismissed' })}
                >
                  <X data-icon="inline-start" />忽略
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
