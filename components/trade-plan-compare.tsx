'use client'

import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { memoDirectionLabel } from '@/lib/cases'
import { fmtPrice } from '@/lib/format'
import { firstPlausibleNumberIn } from '@/lib/process-score'
import type { CaseCardMemo, Trade, TradeMetrics } from '@/lib/types'
import { cn } from '@/lib/utils'

function DirectionText({ label }: { label: '做多' | '做空' | null }) {
  if (!label) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('font-medium', label === '做多' ? 'text-profit' : 'text-loss')}>
      {label === '做多' ? '做多 ↑' : '做空 ↓'}
    </span>
  )
}

function Cell({ value, suffix }: { value: string | null; suffix?: ReactNode }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="font-mono text-sm tabular-nums">
      {value}
      {suffix}
    </span>
  )
}

/**
 * 计划 vs 实际对照：计划来自绑定 Case 的 Entry 卡 memo（Trade 的补录价优先，
 * 标记「录」；来自 memo 的标记「卡」），实际来自 Execution 推导。只并列事实，不做判断。
 */
export function TradePlanCompareCard({ trade, m, entryMemo, pricePrecision }: {
  trade: Trade
  m: TradeMetrics
  entryMemo?: CaseCardMemo | null
  pricePrecision?: number
}) {
  const planDirection = memoDirectionLabel(entryMemo?.direction?.value)
  // memo 值里挑价格时以实际均价为数量级参照，过滤 K 线号/倍数被误读成价格的情况
  const reference = m.avgEntry > 0 ? m.avgEntry : null
  const planEntryFromTrade = trade.initialEntryPrice ?? null
  const planEntry = planEntryFromTrade ?? (entryMemo?.entryPrice ? firstPlausibleNumberIn(entryMemo.entryPrice.value, reference) : null)
  const planStopFromTrade = trade.initialStopLoss ?? null
  const planStop = planStopFromTrade ?? (entryMemo?.stopLoss ? firstPlausibleNumberIn(entryMemo.stopLoss.value, reference) : null)
  const planTargetFromTrade = trade.initialTakeProfit ?? null
  const planTarget = planTargetFromTrade ?? (entryMemo?.target ? firstPlausibleNumberIn(entryMemo.target.value, reference) : null)
  const hasPlan = planDirection != null || planEntry != null || planStop != null || planTarget != null

  function SourceTag({ fromTrade }: { fromTrade: boolean }) {
    return <span className="ml-1 text-[10px] text-muted-foreground" title={fromTrade ? 'Trade 补录价' : 'Entry 卡 memo'}>{fromTrade ? '录' : '卡'}</span>
  }

  const rows: Array<{ label: string; plan: ReactNode; actual: ReactNode }> = [
    { label: '方向', plan: <DirectionText label={planDirection} />, actual: <DirectionText label={trade.direction === 'long' ? '做多' : '做空'} /> },
    {
      label: '入场价',
      plan: <Cell value={planEntry == null ? null : fmtPrice(planEntry, pricePrecision)} suffix={planEntry != null ? <SourceTag fromTrade={planEntryFromTrade != null} /> : null} />,
      actual: <Cell value={m.avgEntry > 0 ? fmtPrice(m.avgEntry, pricePrecision) : null} />,
    },
    {
      label: '止损',
      plan: <Cell value={planStop == null ? null : fmtPrice(planStop, pricePrecision)} suffix={planStop != null ? <SourceTag fromTrade={planStopFromTrade != null} /> : null} />,
      actual: <Cell value={m.finalStop == null ? null : fmtPrice(m.finalStop, pricePrecision)} />,
    },
    {
      label: '目标 / 离场',
      plan: <Cell value={planTarget == null ? null : fmtPrice(planTarget, pricePrecision)} suffix={planTarget != null ? <SourceTag fromTrade={planTargetFromTrade != null} /> : null} />,
      actual: <Cell value={m.avgExit > 0 ? fmtPrice(m.avgExit, pricePrecision) : null} />,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">计划 vs 实际</CardTitle>
        <CardDescription>
          {hasPlan ? '计划列：录 = Trade 补录价，卡 = Entry 卡 memo（补录优先）；实际列来自成交推导。' : '未找到计划数据（未绑定 Case 或入场卡未整理），先列实际情况。'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
          <span />
          <span className="text-xs font-medium text-muted-foreground">计划</span>
          <span className="text-xs font-medium text-muted-foreground">实际</span>
          {rows.map((row) => (
            <div key={row.label} className="col-span-3 grid grid-cols-subgrid items-center border-t py-1.5">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="min-w-0">{row.plan}</span>
              <span className="min-w-0">{row.actual}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
