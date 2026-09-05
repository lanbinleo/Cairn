import { describe, expect, it } from 'vitest'

import { buildTradesTableCopy } from './trade-table-copy'
import type { Account, Period, TagDef, Trade, TradingSymbol } from './types'

const account: Account = {
  id: 'a1', name: '加密回测', kind: 'backtest', initialBalance: 100000, currency: 'USD', createdAt: 0,
  takerFeePct: 0.05, makerFeePct: 0.02,
}
const period: Period = {
  id: 'p1', accountId: 'a1', name: '2026年1月', chartStart: 0, chartEnd: 0, symbolIds: [], createdAt: 0,
}
const symbol: TradingSymbol = {
  id: 's1', exchange: 'BINANCE', code: 'BTCUSDT', name: 'BTC', category: 'crypto', pricePrecision: 1,
}
const tagDefs: TagDef[] = [
  { id: 't1', name: '追高', color: 'red', createdAt: 0 },
  { id: 't2', name: '顺势', color: 'orange', createdAt: 0 },
]

function trade(partial: Partial<Trade>): Trade {
  return {
    id: partial.id ?? 'tr-1', seq: partial.seq ?? 1, accountId: 'a1', periodId: 'p1', symbolId: 's1',
    direction: 'long', status: 'closed', executions: [], events: [], referenceImages: [], tags: [], createdAt: 0,
    ...partial,
  }
}

function exec(time: number, price: number, quantity: number) {
  return [
    { id: `e-${time}`, tradeId: 'tr-1', action: 'entry' as const, orderType: 'market' as const, time, price, quantity },
    { id: `x-${time}`, tradeId: 'tr-1', action: 'exit' as const, orderType: 'limit' as const, time: time + 300000, price: price + 10, quantity },
  ]
}

describe('buildTradesTableCopy', () => {
  const base = { accounts: [account], periods: [period], symbols: [symbol], tagDefs }

  it('元数据前言 + 表头 + 行（净额 PnL、PnL% 分母、标签排序）', () => {
    const t1 = trade({ id: 'tr-1', seq: 2, tags: ['顺势', '追高'], executions: exec(1000, 100, 10) })
    const open = trade({ id: 'tr-2', seq: 3, status: 'open', executions: [exec(5000, 100, 10)[0]] })
    const text = buildTradesTableCopy(
      { ...base, trades: [open, t1], equityBefore: new Map([['tr-1', 1000]]) },
      1730000000000,
    )
    const lines = text.split('\n')

    expect(lines[0]).toContain('Cairn 交易记录')
    expect(lines[0]).toContain('UTC')
    expect(lines[1]).toBe('# 2 笔')
    expect(lines[2]).toBe('# 账户：加密回测')
    expect(lines[3]).toContain('# 进场范围')
    // 表头
    expect(lines[4]).toBe(['交易', '品种', '方向', '账户 / Period', '标签', '进场时间（UTC）', '持仓', 'PnL', 'PnL%', 'R', '状态'].join('\t'))
    // 持仓中行（进场更晚，排前面）：PnL / PnL% / R 为空，状态持仓中
    const openRow = lines[5].split('\t')
    expect(openRow[0]).toBe('Trade #003')
    expect(openRow[7]).toBe('')
    expect(openRow[10]).toBe('持仓中')
    // 已平仓行：标签按色序；PnL 净额（费用 0.5+0.22）；PnL% 分母 1000
    const closedRow = lines[6].split('\t')
    expect(closedRow[0]).toBe('Trade #002')
    expect(closedRow[1]).toBe('BINANCE:BTCUSDT')
    expect(closedRow[3]).toBe('加密回测 · 2026年1月')
    expect(closedRow[4]).toBe('追高、顺势')
    expect(Number(closedRow[7])).toBeCloseTo(99.28, 2)
    expect(closedRow[8]).toBe('9.93')
  })

  it('账户 feesDisabled 时 PnL 回毛口径', () => {
    const t1 = trade({ id: 'tr-1', seq: 1, executions: exec(1000, 100, 10) })
    const text = buildTradesTableCopy(
      { ...base, accounts: [{ ...account, feesDisabled: true }], trades: [t1], equityBefore: new Map([['tr-1', 1000]]) },
    )
    const row = text.split('\n')[5].split('\t')
    expect(Number(row[7])).toBeCloseTo(100, 2)
  })

  it('空表格只有前言 + 表头', () => {
    const text = buildTradesTableCopy({ ...base, trades: [], equityBefore: new Map() })
    expect(text.split('\n')).toHaveLength(3) // 2 行元数据 + 表头
    expect(text).not.toContain('# 账户')
  })
})
