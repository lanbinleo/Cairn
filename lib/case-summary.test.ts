import { describe, expect, it } from 'vitest'

import { buildCaseSummaryContext } from './case-summary'
import type { CaseCard, Trade, TradeCase } from './types'

const caseRecord: TradeCase = {
  id: 'case-1',
  accountId: 'acc-1',
  periodId: 'per-1',
  title: 'BTC 区间突破追多',
  status: 'closed',
  provenance: 'forward',
  tagIds: [],
  createdAt: 1,
  updatedAt: 2,
}

const cards: CaseCard[] = [
  {
    id: 'card-1',
    caseId: 'case-1',
    phase: 'intermediate',
    rawText: '我决定现在把我的止损价格移动到 90820.36 这个位置',
    barRef: 152,
    createdAt: 100,
    aiAnalysis: {
      schemaVersion: '0.3.0-schema-3',
      promptVersion: '0.3.0-prompt-3',
      model: 'm',
      providerId: 'p',
      analyzedAt: 100,
      digest: '止损上移到 90820.36',
      barRef: null,
      labels: [],
      memo: null,
      missingFields: [],
    },
  },
]

const trade: Trade = {
  id: 'trade-1',
  seq: 19,
  accountId: 'acc-1',
  periodId: 'per-1',
  symbolId: 'sym-1',
  direction: 'long',
  status: 'closed',
  initialStopLoss: 90364,
  initialEntryPrice: 90800,
  initialTakeProfit: 91000,
  executions: [
    { id: 'e1', tradeId: 'trade-1', action: 'entry', orderType: 'stop', time: 1000, price: 90873.76, quantity: 2.9 },
    { id: 'e2', tradeId: 'trade-1', action: 'exit', orderType: 'take-profit', time: 5000, price: 91046.87, quantity: 2.9 },
  ],
  events: [],
  referenceImages: [],
  tags: [],
  createdAt: 900,
}

describe('buildCaseSummaryContext', () => {
  it('未绑定时标注纯观察记录且不含成交', () => {
    const context = buildCaseSummaryContext({ caseRecord, cards, trade: null })
    expect(context).toContain('未绑定 Trade（纯观察记录，无成交数据）')
    expect(context).toContain('[过程] BAR152')
    expect(context).toContain('我决定现在把我的止损价格移动到 90820.36')
    expect(context).toContain('提要：止损上移到 90820.36')
    expect(context).not.toContain('执行动作时间线')
  })

  it('绑定时包含指标、计划与执行时间线', () => {
    const context = buildCaseSummaryContext({ caseRecord, cards, trade })
    expect(context).toContain('Trade #19 做多 已平仓')
    expect(context).toContain('初始计划：入场 90800 · 止损 90364 · 止盈 91000')
    expect(context).toContain('执行动作时间线')
    expect(context).toContain('- 开仓 90873.76 ×2.9')
    expect(context).toContain('- 平仓 91046.87 ×2.9')
  })
})
