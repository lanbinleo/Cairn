'use client'

import type { ReactNode } from 'react'

import { InfoHint } from '@/components/info-hint'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { memoDirectionLabel } from '@/lib/cases'
import { fmtPrice } from '@/lib/format'
import { hasPositionFill } from '@/lib/executions'
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

/** 偏差 = 实际 − 计划；只呈现事实，不做评价。 */
function DeltaCell({ actual, plan, precision }: { actual: number | null; plan: number | null; precision?: number }) {
  if (actual == null || plan == null || !Number.isFinite(actual) || !Number.isFinite(plan)) {
    return <span className="text-muted-foreground">—</span>
  }
  const delta = actual - plan
  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {delta > 0 ? '+' : ''}{fmtPrice(delta, precision)}
    </span>
  )
}

/**
 * 计划 vs 实际对照：计划来自绑定 Case 的 Entry 卡 memo（Trade 的补录价优先，
 * 标记「补录」；来自 memo 的标记「来自卡片」），实际来自成交推导。只并列事实，不做判断。
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
  const entryFillCount = trade.executions.filter(
    (execution) => (execution.action === 'entry' || execution.action === 'scale-in') && hasPositionFill(execution),
  ).length

  function SourceTag({ fromTrade }: { fromTrade: boolean }) {
    return (
      <span
        className="ml-1 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
        title={fromTrade ? 'Trade 补录价' : 'Entry 卡 memo'}
      >
        {fromTrade ? '补录' : '来自卡片'}
      </span>
    )
  }

  const rows: Array<{ label: string; plan: ReactNode; actual: ReactNode; delta?: ReactNode }> = [
    { label: '方向', plan: <DirectionText label={planDirection} />, actual: <DirectionText label={trade.direction === 'long' ? '做多' : '做空'} /> },
    {
      label: '入场价',
      plan: <Cell value={planEntry == null ? null : fmtPrice(planEntry, pricePrecision)} suffix={planEntry != null ? <SourceTag fromTrade={planEntryFromTrade != null} /> : null} />,
      actual: (
        <span className="flex flex-wrap items-center">
          <Cell value={m.avgEntry > 0 ? fmtPrice(m.avgEntry, pricePrecision) : null} />
          {entryFillCount > 1 && <span className="ml-1.5 text-[10px] text-muted-foreground">含加仓</span>}
        </span>
      ),
      delta: <DeltaCell actual={m.avgEntry > 0 ? m.avgEntry : null} plan={planEntry} precision={pricePrecision} />,
    },
    {
      label: '止损',
      plan: <Cell value={planStop == null ? null : fmtPrice(planStop, pricePrecision)} suffix={planStop != null ? <SourceTag fromTrade={planStopFromTrade != null} /> : null} />,
      actual: <Cell value={m.finalStop == null ? null : fmtPrice(m.finalStop, pricePrecision)} />,
      delta: <DeltaCell actual={m.finalStop} plan={planStop} precision={pricePrecision} />,
    },
    {
      label: '目标 / 离场',
      plan: <Cell value={planTarget == null ? null : fmtPrice(planTarget, pricePrecision)} suffix={planTarget != null ? <SourceTag fromTrade={planTargetFromTrade != null} /> : null} />,
      actual: <Cell value={m.avgExit > 0 ? fmtPrice(m.avgExit, pricePrecision) : null} />,
      delta: <DeltaCell actual={m.avgExit > 0 ? m.avgExit : null} plan={planTarget} precision={pricePrecision} />,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          计划 vs 实际
          <InfoHint>
            {hasPlan
              ? '计划列：补录 = Trade 补录价，来自卡片 = Entry 卡 memo（补录优先）。实际列：入场 = 全部入场成交加权均价；止损 = 最终生效止损（含移动，非成交价）；离场 = 全部离场成交加权均价。偏差 = 实际 − 计划。'
              : '未找到计划数据（未绑定 Case 或入场卡未识别），先列实际情况。'}
          </InfoHint>
        </CardTitle>
        {!hasPlan && <p className="text-sm text-muted-foreground">未绑定 Case 或入场卡未识别，先列实际情况。</p>}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem] gap-x-4 gap-y-2">
          <span />
          <span className="text-xs font-medium text-muted-foreground">计划</span>
          <span className="text-xs font-medium text-muted-foreground">实际</span>
          <span className="text-right text-xs font-medium text-muted-foreground">偏差</span>
          {rows.map((row) => (
            <div key={row.label} className="col-span-4 grid grid-cols-subgrid items-center border-t py-1.5">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="min-w-0">{row.plan}</span>
              <span className="min-w-0">{row.actual}</span>
              <span className="min-w-0 text-right">{row.delta ?? <span className="text-muted-foreground">—</span>}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
