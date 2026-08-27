'use client'

import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { memoDirectionLabel } from '@/lib/cases'
import { fmtPrice } from '@/lib/format'
import { firstNumberIn } from '@/lib/process-score'
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

function Cell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return <span className="font-mono text-sm tabular-nums">{value}</span>
}

/**
 * 计划 vs 实际对照：计划来自绑定 Case 的 Entry 卡 memo（Trade 的
 * initialStopLoss/initialTakeProfit 优先），实际来自 Execution 推导。
 * 只并列事实，不做判断。
 */
export function TradePlanCompareCard({ trade, m, entryMemo, pricePrecision }: {
  trade: Trade
  m: TradeMetrics
  entryMemo?: CaseCardMemo | null
  pricePrecision?: number
}) {
  const planDirection = memoDirectionLabel(entryMemo?.direction?.value)
  const planStop = trade.initialStopLoss ?? (entryMemo?.stopLoss ? firstNumberIn(entryMemo.stopLoss.value) : null)
  const planTarget = trade.initialTakeProfit ?? (entryMemo?.target ? firstNumberIn(entryMemo.target.value) : null)
  const hasPlan = planDirection != null || planStop != null || planTarget != null

  const rows: Array<{ label: string; plan: ReactNode; actual: ReactNode }> = [
    { label: '方向', plan: <DirectionText label={planDirection} />, actual: <DirectionText label={trade.direction === 'long' ? '做多' : '做空'} /> },
    { label: '止损', plan: <Cell value={planStop == null ? null : fmtPrice(planStop, pricePrecision)} />, actual: <Cell value={m.finalStop == null ? null : fmtPrice(m.finalStop, pricePrecision)} /> },
    { label: '目标 / 离场', plan: <Cell value={planTarget == null ? null : fmtPrice(planTarget, pricePrecision)} />, actual: <Cell value={m.avgExit > 0 ? fmtPrice(m.avgExit, pricePrecision) : null} /> },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">计划 vs 实际</CardTitle>
        <CardDescription>
          {hasPlan ? '计划取 Entry 卡 memo（Trade 补录价优先）；止损实际列为最终生效价。' : '未找到计划数据（未绑定 Case 或入场卡未整理），先列实际情况。'}
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
