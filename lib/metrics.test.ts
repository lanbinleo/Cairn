import { describe, expect, it } from 'vitest'

import { computeEquityCurve, computeEquityMaByDays, computeEquityMaByTrades, computeStats, computeTradeMetrics, equityBeforeByTrade } from './metrics'
import type { EquityPoint, Execution, Trade } from './types'

const MIN = 60_000
const DAY = 86_400_000

function pt(day: number, minutes: number, equity: number): EquityPoint {
  return { time: day * DAY + minutes * MIN, equity }
}

describe('computeEquityMaByTrades', () => {
  it('窗口未满或 n<2 时不输出', () => {
    const points = [pt(0, 0, 100), pt(0, 5, 110)]
    expect(computeEquityMaByTrades(points, 3)).toEqual([])
    expect(computeEquityMaByTrades(points, 1)).toEqual([])
  })

  it('滚动 n 笔简单均线', () => {
    const points = [pt(0, 0, 100), pt(0, 10, 110), pt(0, 20, 120), pt(0, 30, 140)]
    const ma = computeEquityMaByTrades(points, 2)
    expect(ma).toEqual([
      { time: points[1].time, value: 105 },
      { time: points[2].time, value: 115 },
      { time: points[3].time, value: 130 },
    ])
  })
})

describe('computeEquityMaByDays', () => {
  it('按 UTC 日取末值再滚动，输出点用该日最后一笔平仓时刻', () => {
    const points = [
      pt(0, 1, 100), pt(0, 2, 105), // day0 末值 105
      pt(1, 1, 120), // day1 末值 120
      pt(2, 1, 90), pt(2, 9, 100), // day2 末值 100
    ]
    const ma = computeEquityMaByDays(points, 2)
    expect(ma).toEqual([
      { time: points[2].time, value: (105 + 120) / 2 },
      { time: points[4].time, value: (120 + 100) / 2 },
    ])
  })

  it('不足 n 个有数据的日子不输出', () => {
    const points = [pt(0, 1, 100), pt(1, 1, 110)]
    expect(computeEquityMaByDays(points, 3)).toEqual([])
  })
})

/* ---------- 手续费净额（0.3.7） ---------- */

function ex(partial: Partial<Execution> & { time: number; price: number; quantity: number }): Execution {
  return { id: `ex-${partial.time}`, tradeId: 't1', action: 'entry', orderType: 'market', ...partial }
}

function mkTrade(partial: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    seq: 1,
    accountId: 'a1',
    periodId: 'p1',
    symbolId: 's1',
    direction: 'long',
    status: 'closed',
    executions: [],
    events: [],
    referenceImages: [],
    tags: [],
    createdAt: 0,
    ...partial,
  }
}

const RATES = { takerPct: 0.05, makerPct: 0.02 }

function feeTrade(): Trade {
  return mkTrade({
    initialStopLoss: 99,
    executions: [
      ex({ action: 'entry', orderType: 'market', time: 0, price: 100, quantity: 10 }),
      ex({ action: 'exit', orderType: 'limit', time: 10, price: 110, quantity: 10 }),
    ],
  })
}

describe('computeTradeMetrics 手续费净额', () => {
  it('不传 rates 向后兼容：fees 0，pnl === grossPnl', () => {
    const m = computeTradeMetrics(feeTrade())
    expect(m.fees).toBe(0)
    expect(m.pnl).toBe(m.grossPnl)
    expect(m.pnl).toBe(100)
  })

  it('taker/maker 逐腿计提，pnl 为净额', () => {
    const m = computeTradeMetrics(feeTrade(), RATES)
    // entry market: 100×10×0.05% = 0.5；exit limit: 110×10×0.02% = 0.22
    expect(m.fees).toBeCloseTo(0.72, 10)
    expect(m.grossPnl).toBe(100)
    expect(m.pnl).toBeCloseTo(99.28, 10)
  })

  it('R 分子净额化，分母仍是纯价格风险', () => {
    const m = computeTradeMetrics(feeTrade(), RATES)
    expect(m.initialRisk).toBe(10)
    expect(m.rMultiple).toBeCloseTo(99.28 / 10, 10)
  })

  it('feeOverride 直接采用（只盖单腿，另一腿仍按费率）', () => {
    const trade = mkTrade({
      initialStopLoss: 99,
      executions: [
        ex({ action: 'entry', orderType: 'market', time: 0, price: 100, quantity: 10, feeOverride: -3 }),
        ex({ action: 'exit', orderType: 'limit', time: 10, price: 110, quantity: 10 }),
      ],
    })
    const m = computeTradeMetrics(trade, RATES)
    expect(m.fees).toBeCloseTo(3.22, 10)
    expect(m.pnl).toBeCloseTo(96.78, 10)
  })

  it('未平仓 trade：入场腿费用也计入', () => {
    const trade = mkTrade({
      status: 'open',
      executions: [ex({ action: 'entry', orderType: 'market', time: 0, price: 100, quantity: 10 })],
    })
    const m = computeTradeMetrics(trade, RATES)
    expect(m.grossPnl).toBeCloseTo(0, 10)
    expect(m.fees).toBeCloseTo(0.5, 10)
    expect(m.pnl).toBeCloseTo(-0.5, 10)
  })
})

describe('computeStats / 曲线净额与费率追溯', () => {
  function twoTrades(): Trade[] {
    return [
      mkTrade({ id: 't1', initialStopLoss: 99, executions: [
        ex({ action: 'entry', orderType: 'market', time: 0, price: 100, quantity: 10 }),
        ex({ action: 'exit', orderType: 'limit', time: 10, price: 110, quantity: 10 }),
      ] }),
      mkTrade({ id: 't2', initialStopLoss: 99, executions: [
        ex({ action: 'entry', orderType: 'market', time: 20, price: 100, quantity: 10 }),
        ex({ action: 'exit', orderType: 'market', time: 30, price: 90, quantity: 10 }),
      ] }),
    ]
  }

  it('统计与权益按净额；费率改动即追溯重算', () => {
    const gross = computeStats(twoTrades(), 1000)
    expect(gross.totalPnl).toBe(0)

    const net = computeStats(twoTrades(), 1000, () => RATES)
    // 费用：t1 = 0.5+0.22；t2 = 0.5+0.45 = 0.95；合计 1.67
    expect(net.totalPnl).toBeCloseTo(-1.67, 10)

    const higher = computeStats(twoTrades(), 1000, () => ({ takerPct: 0.1, makerPct: 0.04 }))
    expect(higher.totalPnl).toBeCloseTo(-3.34, 10)

    const curve = computeEquityCurve(twoTrades(), 1000, () => RATES)
    expect(curve[curve.length - 1].equity).toBeCloseTo(1000 - 1.67, 10)
    expect(equityBeforeByTrade(twoTrades(), 1000, () => RATES).get('t2')).toBeCloseTo(1000 + 99.28, 10)
  })

  it('费用可把毛盈利翻成净亏损（胜率随净额）', () => {
    const trade = mkTrade({
      id: 'w', accountId: 'a1', initialStopLoss: 99.9,
      executions: [
        ex({ action: 'entry', orderType: 'market', time: 0, price: 100, quantity: 1000 }),
        ex({ action: 'exit', orderType: 'market', time: 10, price: 100.05, quantity: 1000 }),
      ],
    })
    const gross = computeStats([trade], 1000)
    expect(gross.winRate).toBe(1)
    // 费用 = 100×1000×0.05% × 2 = 100 > 毛利 50
    const net = computeStats([trade], 1000, () => RATES)
    expect(net.winRate).toBe(0)
    // 费用 = 100×1000×0.05% + 100.05×1000×0.05% = 100.025 > 毛利 50
    expect(net.totalPnl).toBeCloseTo(-50.025, 8)
  })
})
