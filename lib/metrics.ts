/**
 * 指标计算：全部基于 Execution 级别聚合。
 * 这一层逻辑与 UI 无关，未来可直接移植到后端。
 */

import { hasPositionFill, isEntryExecution } from './executions'
import type { Trade, TradeMetrics, EquityPoint, StatsSummary } from './types'

const EPS = 1e-9

/** 计算单个 Trade 的派生指标（基于其全部 Execution） */
export function computeTradeMetrics(trade: Trade): TradeMetrics {
  const execs = [...trade.executions].filter(hasPositionFill).sort((a, b) => a.time - b.time)
  const sign = trade.direction === 'long' ? 1 : -1

  let entryQty = 0
  let entryCost = 0
  let exitQty = 0
  let exitProceeds = 0

  for (const e of execs) {
    const quantity = e.quantity ?? 0
    const price = e.price ?? 0
    if (isEntryExecution(e)) {
      entryQty += quantity
      entryCost += quantity * price
    } else {
      exitQty += quantity
      exitProceeds += quantity * price
    }
  }

  const avgEntry = entryQty > EPS ? entryCost / entryQty : 0
  const avgExit = exitQty > EPS ? exitProceeds / exitQty : 0
  // 已实现盈亏：只对已平掉的数量计算
  const closedQty = Math.min(entryQty, exitQty)
  const pnl = sign * closedQty * (avgExit - avgEntry)

  let rMultiple: number | null = null
  if (trade.initialStopLoss != null && avgEntry > 0) {
    const riskPerUnit = Math.abs(avgEntry - trade.initialStopLoss)
    if (riskPerUnit > EPS && entryQty > EPS) {
      rMultiple = pnl / (riskPerUnit * entryQty)
    }
  }

  const entryTime = execs[0]?.time ?? trade.createdAt
  const exitTime = execs[execs.length - 1]?.time ?? trade.createdAt

  return {
    pnl,
    avgEntry,
    avgExit,
    totalQuantity: entryQty,
    rMultiple,
    durationMs: exitTime - entryTime,
    entryTime,
    exitTime,
  }
}

/** 按平仓时间排序生成资金曲线（初始资金 + 逐笔累计已实现 PnL） */
export function computeEquityCurve(trades: Trade[], initialBalance: number): EquityPoint[] {
  const closed = trades
    .filter((t) => t.status === 'closed')
    .map((t) => ({ trade: t, m: computeTradeMetrics(t) }))
    .sort((a, b) => a.m.exitTime - b.m.exitTime)

  const points: EquityPoint[] = []
  let equity = initialBalance
  if (closed.length > 0) {
    points.push({ time: closed[0].m.entryTime, equity: initialBalance })
  }
  for (const { m } of closed) {
    equity += m.pnl
    points.push({ time: m.exitTime, equity })
  }
  return points
}

/** 最大回撤（绝对值与百分比） */
export function computeMaxDrawdown(curve: EquityPoint[]): { maxDrawdown: number; maxDrawdownPct: number } {
  let peak = Number.NEGATIVE_INFINITY
  let maxDd = 0
  let maxDdPct = 0
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity
    const dd = peak - p.equity
    if (dd > maxDd) {
      maxDd = dd
      maxDdPct = peak > EPS ? dd / peak : 0
    }
  }
  return { maxDrawdown: maxDd, maxDrawdownPct: maxDdPct }
}

/** 一批 trades 的统计汇总 */
export function computeStats(trades: Trade[], initialBalance: number): StatsSummary {
  const closed = trades.filter((t) => t.status === 'closed')
  const metrics = closed.map(computeTradeMetrics)

  const wins = metrics.filter((m) => m.pnl > EPS)
  const losses = metrics.filter((m) => m.pnl < -EPS)
  const breakeven = metrics.length - wins.length - losses.length

  const totalPnl = metrics.reduce((s, m) => s + m.pnl, 0)
  const grossProfit = wins.reduce((s, m) => s + m.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, m) => s + m.pnl, 0))

  const rValues = metrics.map((m) => m.rMultiple).filter((r): r is number => r != null)

  const curve = computeEquityCurve(closed, initialBalance)
  const { maxDrawdown, maxDrawdownPct } = computeMaxDrawdown(curve)

  return {
    tradeCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: metrics.length > 0 ? wins.length / metrics.length : 0,
    totalPnl,
    profitFactor: grossLoss > EPS ? grossProfit / grossLoss : null,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    expectancy: metrics.length > 0 ? totalPnl / metrics.length : 0,
    avgR: rValues.length > 0 ? rValues.reduce((s, r) => s + r, 0) / rValues.length : null,
    maxDrawdown,
    maxDrawdownPct,
  }
}
