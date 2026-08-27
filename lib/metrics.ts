/**
 * 指标计算：全部基于 Execution 级别聚合。
 * 这一层逻辑与 UI 无关，未来可直接移植到后端。
 */

import { hasPositionFill, isEntryExecution } from './executions'
import type { Execution, Trade, TradeMetrics, EquityPoint, StatsSummary } from './types'

const EPS = 1e-9

const STOP_ACTIONS = ['stop', 'stop-set', 'stop-moved'] as const

function byTime(a: Pick<Execution, 'time' | 'id'>, b: Pick<Execution, 'time' | 'id'>) {
  return a.time - b.time || a.id.localeCompare(b.id)
}

/** 止损动作序列（带价格），按时间排序 */
function stopActions(trade: Trade): Array<Execution & { price: number }> {
  return trade.executions
    .filter((execution): execution is Execution & { price: number } =>
      (STOP_ACTIONS as readonly string[]).includes(execution.action) && execution.price != null)
    .sort(byTime)
}

/**
 * 分段风险：每笔入场 fill 按其成交时点生效的止损计风险（该时点前最后一次止损动作；
 * 从未动过则初始止损）。加仓前的止损放宽/收紧因此体现在后段风险里。
 */
function segmentActualRisk(trade: Trade, entries: Array<Execution & { price: number; quantity: number }>): number | null {
  if (trade.initialStopLoss == null) return null
  const stops = stopActions(trade)
  let risk = 0
  for (const fill of entries) {
    let stop = trade.initialStopLoss
    for (const action of stops) {
      if (action.time < fill.time) stop = action.price
      else break
    }
    risk += Math.abs(fill.price - stop) * fill.quantity
  }
  return risk > EPS ? risk : null
}

/** 计算单个 Trade 的派生指标（基于其全部 Execution） */
export function computeTradeMetrics(trade: Trade): TradeMetrics {
  const execs = [...trade.executions].filter(hasPositionFill).sort(byTime)
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

  const entries = execs.filter(isEntryExecution)
  const firstEntry = entries[0]
  const firstEntryPrice = firstEntry?.price ?? 0

  // 初始风险锚定首笔入场（决策时的计划风险）；R 不因加仓摊薄
  let initialRisk: number | null = null
  if (trade.initialStopLoss != null && firstEntry) {
    const perUnit = Math.abs(firstEntry.price - trade.initialStopLoss)
    if (perUnit > EPS) initialRisk = perUnit * firstEntry.quantity
  }

  const actualRisk = segmentActualRisk(trade, entries)

  let rMultiple: number | null = null
  if (initialRisk != null && initialRisk > EPS) rMultiple = pnl / initialRisk
  let rActual: number | null = null
  if (actualRisk != null && actualRisk > EPS) rActual = pnl / actualRisk

  const stops = stopActions(trade)
  const lastFill = execs[execs.length - 1]
  let finalStop: number | null = null
  if (trade.initialStopLoss != null || stops.length > 0) {
    finalStop = trade.initialStopLoss ?? null
    for (const action of stops) {
      if (lastFill == null || action.time <= lastFill.time) finalStop = action.price
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
    rActual,
    initialRisk,
    actualRisk,
    firstEntryPrice,
    finalStop,
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
