import { describe, expect, it } from 'vitest'

import { matchesTradeFilter, tradeFilterChips, isTradeFilterEmpty } from './trade-filters'
import type { Trade } from './types'

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    seq: 1,
    accountId: 'acc',
    periodId: 'p',
    symbolId: 'btc',
    direction: 'long',
    status: 'closed',
    executions: [],
    events: [],
    referenceImages: [],
    tags: [],
    createdAt: 0,
    ...overrides,
  }
}

/** savedProcessScoreTotal：有 processScore 即已评分，缺项按 0 计（结构分直接给总分）。 */
function scoredScore(total: number) {
  return { structureValid: total, updatedAt: 1 }
}

describe('matchesTradeFilter · 评分筛选', () => {
  it('未评分只匹配没有 processScore 的交易', () => {
    const unscored = makeTrade()
    const scored = makeTrade({ processScore: scoredScore(8) })
    expect(matchesTradeFilter(unscored, { flagUnscored: true })).toBe(true)
    expect(matchesTradeFilter(scored, { flagUnscored: true })).toBe(false)
  })

  it('已评分只匹配有 processScore 的交易', () => {
    const unscored = makeTrade()
    const scored = makeTrade({ processScore: scoredScore(8) })
    expect(matchesTradeFilter(unscored, { flagScored: true })).toBe(false)
    expect(matchesTradeFilter(scored, { flagScored: true })).toBe(true)
  })

  it('未评分 + 已评分同勾 = 空结果（互斥）', () => {
    expect(matchesTradeFilter(makeTrade(), { flagUnscored: true, flagScored: true })).toBe(false)
    expect(matchesTradeFilter(makeTrade({ processScore: scoredScore(8) }), { flagUnscored: true, flagScored: true })).toBe(false)
  })

  it('分数区间对已评分生效、排除未评分', () => {
    const scored = makeTrade({ processScore: scoredScore(8) })
    expect(matchesTradeFilter(scored, { flagScored: true, scoreMin: 5 })).toBe(true)
    expect(matchesTradeFilter(scored, { flagScored: true, scoreMin: 9 })).toBe(false)
    expect(matchesTradeFilter(makeTrade(), { scoreMin: 5 })).toBe(false)
  })
})

describe('tradeFilterChips / isTradeFilterEmpty', () => {
  it('已评分生成 chip，且不再视为空筛选', () => {
    expect(isTradeFilterEmpty({ flagScored: true })).toBe(false)
    expect(tradeFilterChips({ flagScored: true })).toEqual([{ key: 'flagScored', label: '已评分' }])
    expect(isTradeFilterEmpty({})).toBe(true)
  })
})
