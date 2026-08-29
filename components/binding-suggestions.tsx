'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { bindingContextForCase, bindingContextForTrade, zipBindingSuggestions, type BindingSuggestion } from '@/lib/binding-suggestions'
import { suggestBindings } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import type { CaseTradeBinding, Trade, TradeCase } from '@/lib/types'
import { cn } from '@/lib/utils'

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

function SuggestionRows<T extends { id: string }>({
  suggestions,
  label,
  onBind,
  binding,
}: {
  suggestions: BindingSuggestion<T>[]
  label: (candidate: T) => string
  onBind: (candidate: T) => void
  binding: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {suggestions.map((item) => (
        <div key={item.candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{label(item.candidate)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.reason}</p>
          </div>
          <Badge variant="secondary" className="shrink-0">匹配 {CONFIDENCE_LABEL[item.confidence] ?? item.confidence}</Badge>
          <Button size="sm" className="h-7 shrink-0" disabled={binding} onClick={() => onBind(item.candidate)}>关联</Button>
        </div>
      ))}
    </div>
  )
}

/**
 * AI 找 Case（给一笔 Trade 推荐未绑定 Case）：候选机械预筛（同账户/未绑定/时间距离），
 * AI 排序给理由，点「关联」才建立绑定。用在 Trade 页 Case Tab 与导入第三步。
 * onBound 回传新建立的 binding（导入页据此更新行状态，避免读 stale 闭包）。
 */
export function BindingSuggestForTrade({ trade, onBound }: { trade: Trade; onBound?: (binding: CaseTradeBinding) => void }) {
  const { cases, caseCards, caseBindings, createCaseBinding } = useCairn()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [binding, setBinding] = useState(false)
  const [suggestions, setSuggestions] = useState<BindingSuggestion<TradeCase>[]>([])
  const [error, setError] = useState('')

  async function run() {
    setOpen(true)
    setBusy(true)
    setError('')
    try {
      const { context, cases: candidates } = bindingContextForTrade(trade, cases, caseCards, caseBindings)
      if (candidates.length === 0) {
        setSuggestions([])
        return
      }
      const { matches } = await suggestBindings(context, candidates.length)
      setSuggestions(zipBindingSuggestions(candidates, matches))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function bind(caseRecord: TradeCase) {
    setBinding(true)
    try {
      const created = await createCaseBinding(caseRecord.id, trade.id)
      setOpen(false)
      onBound?.(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBinding(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
        <Sparkles className={cn('size-3.5', busy && 'animate-pulse')} data-icon="inline-start" />
        {busy ? 'AI 找 Case…' : 'AI 找 Case'}
      </Button>
      {open && !busy && (
        error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">没有找到合适的 Case，可在上方手动选择。</p>
        ) : (
          <SuggestionRows
            suggestions={suggestions}
            label={(caseRecord) => caseRecord.title}
            onBind={(caseRecord) => void bind(caseRecord)}
            binding={binding}
          />
        )
      )}
    </div>
  )
}

/** AI 找 Trade（给一个 Case 推荐未绑定 Trade），用在 Case 页 Trade Binding 卡。 */
export function BindingSuggestForCase({ caseRecord, onBound }: { caseRecord: TradeCase; onBound?: (binding: CaseTradeBinding) => void }) {
  const { trades, caseCards, caseBindings, createCaseBinding } = useCairn()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [binding, setBinding] = useState(false)
  const [suggestions, setSuggestions] = useState<BindingSuggestion<Trade>[]>([])
  const [error, setError] = useState('')

  async function run() {
    setOpen(true)
    setBusy(true)
    setError('')
    try {
      const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
      const { context, candidates } = bindingContextForCase(caseRecord, cards, trades, caseBindings)
      if (candidates.length === 0) {
        setSuggestions([])
        return
      }
      const { matches } = await suggestBindings(context, candidates.length)
      setSuggestions(zipBindingSuggestions(candidates, matches))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function bind(trade: Trade) {
    setBinding(true)
    try {
      const created = await createCaseBinding(caseRecord.id, trade.id)
      setOpen(false)
      onBound?.(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBinding(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
        <Sparkles className={cn('size-3.5', busy && 'animate-pulse')} data-icon="inline-start" />
        {busy ? 'AI 找 Trade…' : 'AI 找 Trade'}
      </Button>
      {open && !busy && (
        error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">没有找到合适的 Trade，可到 Trade 详情页手动关联本 Case。</p>
        ) : (
          <SuggestionRows
            suggestions={suggestions}
            label={(trade) => `Trade #${String(trade.seq).padStart(3, '0')}`}
            onBind={(trade) => void bind(trade)}
            binding={binding}
          />
        )
      )}
    </div>
  )
}
