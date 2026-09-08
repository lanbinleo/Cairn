import { describe, expect, it } from 'vitest'

import { bindingContextForCase, bindingContextForTrade } from './binding-suggestions'
import type { CaseCard, CaseCardAnalysis, Trade, TradeCase } from './types'

const MIN = 60_000
/** 回放工作流：图表日 2026-01-11（UTC），录音墙钟 2026-08-28 */
const CHART_DAY = Date.UTC(2026, 0, 11)
const RECORD_DAY = Date.UTC(2026, 7, 28)

function at(day: number, hour: number, minute: number): number {
  return day + hour * 60 * MIN + minute * MIN
}

function tradeFixture(id: string, entryMinute: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    seq: 1,
    accountId: 'acc-1',
    periodId: 'p-1',
    symbolId: 'sym-1',
    direction: 'short',
    status: 'closed',
    initialStopLoss: 90966.12,
    initialTakeProfit: 90449.67,
    executions: [
      { id: `${id}-e1`, tradeId: id, action: 'entry', orderType: 'market', time: at(CHART_DAY, 5, entryMinute), price: 90805.54, quantity: 1.65 },
      { id: `${id}-e2`, tradeId: id, action: 'exit', orderType: 'market', time: at(CHART_DAY, 8, 35), price: 90788.89, quantity: 1.65 },
    ],
    events: [],
    referenceImages: [],
    tags: [],
    createdAt: RECORD_DAY,
    ...overrides,
  }
}

function analysisFixture(): CaseCardAnalysis {
  return {
    schemaVersion: 'test',
    promptVersion: 'test',
    model: 'test',
    providerId: 'test',
    analyzedAt: RECORD_DAY,
    digest: null,
    barRef: null,
    labels: [],
    memo: {
      direction: { value: 'short' },
      stopLoss: { value: '90966.12（震荡区间上沿上方一点点）' },
    },
    missingFields: [],
  }
}

function cardFixture(id: string, caseId: string, phase: CaseCard['phase'], createdAt: number, overrides: Partial<CaseCard> = {}): CaseCard {
  return {
    id,
    caseId,
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

/** Entry bar 70（图表时间 05:45，成交 05:50）、Closing bar 104（08:35）→ strong */
function strongCards(caseId: string): CaseCard[] {
  return [
    cardFixture(`${caseId}-pre`, caseId, 'pre-entry', at(RECORD_DAY, 6, 6), { barRef: 64 }),
    cardFixture(`${caseId}-entry`, caseId, 'entry', at(RECORD_DAY, 6, 13), { barRef: 70, aiAnalysis: analysisFixture() }),
    cardFixture(`${caseId}-close`, caseId, 'closing', at(RECORD_DAY, 6, 33), { barRef: 104 }),
  ]
}

/** 弱候选：无 barRef，墙钟距成交 1~8 分钟（部分比 strong 的图表轴 5 分钟更近） */
function weakCase(id: string, leadMinutes: number): { caseRecord: TradeCase; cards: CaseCard[] } {
  return {
    caseRecord: caseFixture(id),
    cards: [cardFixture(`${id}-entry`, id, 'entry', at(CHART_DAY, 5, 50) + leadMinutes * MIN)],
  }
}

describe('binding-suggestions 候选池排序', () => {
  it('为 Trade 找 Case：strong 候选排在弱候选之前，再按距离；超 6 个截断不丢 strong', () => {
    const trade = tradeFixture('tr-1', 50)
    const strong = { caseRecord: caseFixture('case-strong'), cards: strongCards('case-strong') }
    const weaks = [1, 2, 3, 4, 6, 7, 8].map((lead, index) => weakCase(`case-weak-${index}`, lead))
    const allCases = [strong, ...weaks]
    const { cases: candidates } = bindingContextForTrade(
      trade,
      allCases.map((item) => item.caseRecord),
      allCases.flatMap((item) => item.cards),
      [],
    )
    // 修复前 comparator 反向：strong 垫底，超过 6 个候选时被直接截掉
    expect(candidates.length).toBe(6)
    expect(candidates[0]?.id).toBe('case-strong')
  })

  it('为 Case 找 Trade：strong 候选同样优先且不被截断丢弃', () => {
    const strongTrade = tradeFixture('tr-strong', 50)
    const weakTrades = [1, 2, 3, 4, 6, 7, 8].map((lead, index) =>
      // 各自独立成交时间，避免同 trade 的重复判定干扰
      tradeFixture(`tr-weak-${index}`, 50 + lead),
    )
    const { candidates } = bindingContextForCase(
      caseFixture('case-strong'),
      strongCards('case-strong'),
      [strongTrade, ...weakTrades],
      [],
    )
    expect(candidates.length).toBe(6)
    expect(candidates[0]?.id).toBe('tr-strong')
  })
})
