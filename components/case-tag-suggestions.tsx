'use client'

import { Check, ListChecks, Sparkles, X } from 'lucide-react'

import { TagBadge } from '@/components/tag-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoHint } from '@/components/info-hint'
import { useCairn } from '@/lib/store'
import type { CaseTagSuggestion, Trade, TradeCase } from '@/lib/types'

/**
 * AI 交易标签建议审阅区（Trade 页案例 Tab，AI 补录建议正下方）。
 * 与补录建议同一轮 AI 调用产出（一次检查、两份候选）；标签词表是用户自己的
 * tagDefs，Rust 侧已做词表命中 + 原话逐字校验。建议永远是候选：应用到 Trade
 * 由用户逐条确认（或「全部应用」），忽略即出候选池。全部处理完折叠成一小条。
 */
export function CaseTagSuggestions({
  trade,
  caseRecord,
  onJumpCard,
}: {
  trade: Trade
  caseRecord: TradeCase
  /** 点击证据跳到对应卡片（案例 Tab 内定位） */
  onJumpCard: (cardId: string) => void
}) {
  const { getTagDef, createTag, updateTrade, setCaseTagSuggestionStatus } = useCairn()
  const blob = caseRecord.aiTagSuggestions
  const suggestions = blob?.suggestions ?? []
  // 展示层去重：Trade 已带的标签不再出现在待确认列表
  const pending = suggestions.filter(
    (item) => item.status === 'pending' && !trade.tags.some((name) => name.toLowerCase() === item.name.toLowerCase()),
  )
  const accepted = suggestions.filter((item) => item.status === 'accepted').length
  const dismissed = suggestions.filter((item) => item.status === 'dismissed').length

  function apply(suggestion: CaseTagSuggestion) {
    if (trade.tags.some((name) => name.toLowerCase() === suggestion.name.toLowerCase())) {
      setCaseTagSuggestionStatus(caseRecord.id, suggestion.name, { status: 'accepted' })
      return
    }
    // 防御：词表理论上是现有标签，若定义被删则补建（颜色默认蓝，可在标签管理里改）
    if (!getTagDef(suggestion.name)) createTag(suggestion.name, 'blue')
    updateTrade(trade.id, { tags: [...trade.tags, suggestion.name] })
    setCaseTagSuggestionStatus(caseRecord.id, suggestion.name, { status: 'accepted' })
  }

  function applyAll() {
    for (const suggestion of pending) apply(suggestion)
  }

  // 从未跑过检查（blob 不存在）或没有任何已处理痕迹且无待确认：不渲染（检查入口在补录建议面板上）
  if (!blob || (pending.length === 0 && accepted + dismissed === 0)) {
    return null
  }

  // 全部处理完：折叠成一小条
  if (pending.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-4 py-2 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">
          AI 标签建议：都已处理{accepted + dismissed > 0 ? `（${accepted} 已应用 · ${dismissed} 已忽略）` : ''}。
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-amber-500" />AI 标签建议
              <InfoHint>根据卡片原话从你的标签词表里挑的候选（每条都有原话证据）；应用到这笔 Trade 由你确认，重跑入口在上方「重新检查」。</InfoHint>
              <Badge variant="secondary">{pending.length} 条待确认</Badge>
            </CardTitle>
            {accepted + dismissed > 0 && (
              <CardDescription>已处理 {accepted + dismissed} 条（{accepted} 已应用 · {dismissed} 已忽略）。</CardDescription>
            )}
          </div>
          {pending.length > 1 && (
            <Button variant="outline" size="sm" onClick={applyAll}>
              <ListChecks data-icon="inline-start" />全部应用
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {pending.map((suggestion) => (
          <div key={suggestion.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
            <TagBadge name={suggestion.name} className="shrink-0" />
            {suggestion.signal && <span className="text-xs text-muted-foreground">{suggestion.signal}</span>}
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              title={suggestion.quote}
              onClick={() => onJumpCard(suggestion.cardId)}
            >
              证据：「{suggestion.quote}」
            </button>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" className="h-7 px-2.5" onClick={() => apply(suggestion)}>
                <Check data-icon="inline-start" />应用
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-muted-foreground"
                onClick={() => setCaseTagSuggestionStatus(caseRecord.id, suggestion.name, { status: 'dismissed' })}
              >
                <X data-icon="inline-start" />忽略
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
