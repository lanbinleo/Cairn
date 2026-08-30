import { describe, expect, it } from 'vitest'

import { analyzeCaseTradeMatch, matchTradesToCases } from './case-import-matching'
import type { CaseCard, CaseCardAnalysis, Trade, TradeCase } from './types'

const DAY = 86_400_000
const MIN = 60_000
/** 回放工作流：图表日 2026-01-11（UTC），录音墙钟 2026-08-28——生产样本的真实形态 */
const CHART_DAY = Date.UTC(2026, 0, 11)
const RECORD_DAY = Date.UTC(2026, 7, 28)

function at(day: number, hour: number, minute: number): number {
  return day + hour * 60 * MIN + minute * MIN
}

function tradeFixture(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'tr-1',
    seq: 1,
    accountId: 'acc-1',
    periodId: 'p-1',
    symbolId: 'sym-1',
    direction: 'short',
    status: 'closed',
    initialStopLoss: 90966.12,
    initialTakeProfit: 90449.67,
    executions: [
      { id: 'e1', tradeId: 'tr-1', action: 'entry', orderType: 'market', time: at(CHART_DAY, 5, 50), price: 90805.54, quantity: 1.65 },
      { id: 'e2', tradeId: 'tr-1', action: 'exit', orderType: 'market', time: at(CHART_DAY, 8, 35), price: 90788.89, quantity: 1.65 },
    ],
    events: [],
    referenceImages: [],
    tags: [],
    createdAt: RECORD_DAY,
    ...overrides,
  }
}

function analysisFixture(memo: CaseCardAnalysis['memo']): CaseCardAnalysis {
  return {
    schemaVersion: 'test',
    promptVersion: 'test',
    model: 'test',
    providerId: 'test',
    analyzedAt: RECORD_DAY,
    digest: null,
    barRef: null,
    labels: [],
    memo,
    missingFields: [],
  }
}

function cardFixture(id: string, phase: CaseCard['phase'], createdAt: number, overrides: Partial<CaseCard> = {}): CaseCard {
  return {
    id,
    caseId: 'case-1',
    phase,
    rawText: `raw ${id}`,
    createdAt,
    ...overrides,
  }
}

function caseFixture(id: string): TradeCase {
  return {
    id,
    accountId: 'acc-1',
    periodId: 'p-1',
    title: `case ${id}`,
    status: 'active',
    provenance: 'forward',
    tagIds: [],
    createdAt: RECORD_DAY,
    updatedAt: RECORD_DAY,
  }
}

/** 生产绑定对 2 的形态：Entry bar 70（5m 图表时间 05:45，成交 05:50）、Closing bar 104（08:35） */
function replayCards(): CaseCard[] {
  return [
    cardFixture('pre', 'pre-entry', at(RECORD_DAY, 6, 6), { barRef: 64 }),
    cardFixture('entry', 'entry', at(RECORD_DAY, 6, 13), {
      barRef: 70,
      aiAnalysis: analysisFixture({
        direction: { value: 'short' },
        stopLoss: { value: '90966.12（震荡区间上沿上方一点点）' },
      }),
    }),
    cardFixture('mid', 'intermediate', at(RECORD_DAY, 6, 22), { barRef: 71 }),
    cardFixture('close', 'closing', at(RECORD_DAY, 6, 33), { barRef: 104 }),
  ]
}

describe('analyzeCaseTradeMatch（回放工作流，图表轴）', () => {
  it('barRef 锚定命中入场与离场时间，价格佐证 → strong', () => {
    const signals = analyzeCaseTradeMatch(tradeFixture(), replayCards())
    expect(signals.entryTimeHit).toBe(true)
    expect(signals.closingTimeHit).toBe(true)
    expect(signals.priceHit).toBe(true)
    expect(signals.directionMismatch).toBe(false)
    expect(signals.strong).toBe(true)
  })

  it('录音墙钟与图表时间相隔数月，图表轴仍给出最小距离', () => {
    const signals = analyzeCaseTradeMatch(tradeFixture(), replayCards())
    // Entry 卡 bar 70 → 图表时间 05:45，成交 05:50，lead = 5 分钟
    expect(signals.chartDistanceMs).toBe(5 * MIN)
  })

  it('方向冲突不产生 strong（只降级为建议）', () => {
    const cards = replayCards().map((card) =>
      card.id === 'entry'
        ? { ...card, aiAnalysis: analysisFixture({ direction: { value: 'long' }, stopLoss: { value: '90966.12' } }) }
        : card,
    )
    const signals = analyzeCaseTradeMatch(tradeFixture(), cards)
    expect(signals.directionMismatch).toBe(true)
    expect(signals.strong).toBe(false)
  })

  it('只有价格佐证（无 barRef、墙钟对不上）不算 strong，但算候选', () => {
    const cards = [
      cardFixture('entry', 'entry', at(RECORD_DAY, 6, 13), {
        aiAnalysis: analysisFixture({ direction: { value: 'short' }, stopLoss: { value: '90966.12' } }),
      }),
    ]
    const signals = analyzeCaseTradeMatch(tradeFixture(), cards)
    expect(signals.entryTimeHit).toBe(false)
    expect(signals.priceHit).toBe(true)
    expect(signals.strong).toBe(false)
  })

  it('止损数字带「附近」等文字仍能提取；数量级不符的 K 线序号不算价格', () => {
    const cards = [
      cardFixture('entry', 'entry', at(RECORD_DAY, 6, 13), {
        barRef: 70,
        aiAnalysis: analysisFixture({
          direction: { value: 'short' },
          stopLoss: { value: '止损放在了 90364 附近' },
        }),
      }),
    ]
    const trade = tradeFixture({ initialStopLoss: 90364, initialTakeProfit: undefined })
    const signals = analyzeCaseTradeMatch(trade, cards)
    expect(signals.priceHit).toBe(true)
    expect(signals.strong).toBe(true)
  })
})

describe('analyzeCaseTradeMatch（场内实时，墙钟轴兜底）', () => {
  it('卡片 createdAt ≈ 成交时间（无 barRef）仍能精确匹配', () => {
    const cards = [
      cardFixture('entry', 'entry', at(CHART_DAY, 5, 48), {
        aiAnalysis: analysisFixture({ direction: { value: 'short' } }),
      }),
      cardFixture('close', 'closing', at(CHART_DAY, 8, 36)),
    ]
    const signals = analyzeCaseTradeMatch(tradeFixture(), cards)
    expect(signals.entryTimeHit).toBe(true)
    expect(signals.closingTimeHit).toBe(true)
    expect(signals.strong).toBe(true)
  })
})

describe('matchTradesToCases', () => {
  const cases = [caseFixture('case-1')]

  it('回放工作流：唯一的强匹配 Case 自动绑定（exact）', () => {
    const results = matchTradesToCases([tradeFixture()], cases, replayCards(), [])
    expect(results[0].level).toBe('exact')
    expect(results[0].candidates[0].caseId).toBe('case-1')
  })

  it('两个 Case 同为强匹配时不自动绑定，降级为建议', () => {
    const cards = [...replayCards(), ...replayCards().map((card) => ({ ...card, caseId: 'case-2' }))]
    const results = matchTradesToCases([tradeFixture()], [...cases, caseFixture('case-2')], cards, [])
    expect(results[0].level).toBe('suggest')
    expect(results[0].candidates).toHaveLength(2)
  })

  it('方向冲突的候选不进 exact', () => {
    const cards = replayCards().map((card) =>
      card.id === 'entry'
        ? { ...card, aiAnalysis: analysisFixture({ direction: { value: 'long' }, stopLoss: { value: '90966.12' } }) }
        : card,
    )
    const results = matchTradesToCases([tradeFixture()], cases, cards, [])
    expect(results[0].level).toBe('suggest')
  })

  it('时间与价格都对不上 → none（不再被墙钟弱窗口误伤）', () => {
    const cards = [
      cardFixture('entry', 'entry', at(RECORD_DAY, 6, 13), { barRef: 30 }),
      cardFixture('close', 'closing', at(RECORD_DAY, 6, 33), { barRef: 40 }),
    ]
    const results = matchTradesToCases([tradeFixture()], cases, cards, [])
    expect(results[0].level).toBe('none')
  })

  it('excludedCaseIds 消费掉已用 Case', () => {
    const results = matchTradesToCases([tradeFixture()], cases, replayCards(), [], new Set(['case-1']))
    expect(results[0].level).toBe('none')
  })
})
