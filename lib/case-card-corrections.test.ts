import { describe, expect, it } from 'vitest'

import { applyCorrectionPairs } from './case-card-corrections'

describe('applyCorrectionPairs', () => {
  it('按顺序套用多对替换', () => {
    const raw = '6500 做多，BAR 2265 收长上影，然后 6500 又是关键词。'
    const result = applyCorrectionPairs(raw, [
      { oldText: '6500 做多', newText: '65000 做多' },
      { oldText: 'BAR 2265', newText: 'BAR 265' },
    ])
    expect(result.text).toBe('65000 做多，BAR 265 收长上影，然后 6500 又是关键词。')
    expect(result.results.every((item) => item.ok)).toBe(true)
  })

  it('oldText 找不到时标失败，不影响其他对', () => {
    const raw = '原文里没有这个词'
    const result = applyCorrectionPairs(raw, [
      { oldText: '不存在的片段', newText: '任意' },
      { oldText: '原文里', newText: '正文里' },
    ])
    expect(result.results[0].ok).toBe(false)
    expect(result.results[1].ok).toBe(true)
    expect(result.text).toBe('正文里没有这个词')
  })

  it('重复片段优先取上一处替换点之后；前一对改写导致的失配标失败', () => {
    const raw = '在 6500 进，在 6500 出。'
    // 第一对只替换第一次出现
    const result = applyCorrectionPairs(raw, [
      { oldText: '6500', newText: '65000' },
      { oldText: '在 6500 进', newText: '在 65000 进' },
    ])
    // 第二对的 oldText 已被第一对改写（6500→65000）→ 失败
    expect(result.results[0].ok).toBe(true)
    expect(result.results[1].ok).toBe(false)
    expect(result.text).toBe('在 65000 进，在 6500 出。')
  })

  it('空串 / 相同对 / 首尾空白归一', () => {
    const result = applyCorrectionPairs('保持原样', [
      { oldText: '  ', newText: 'x' },
      { oldText: '一样', newText: '一样' },
      { oldText: ' 保持原样 ', newText: '保持原状' },
    ])
    expect(result.results.map((item) => item.ok)).toEqual([false, false, true])
    expect(result.text).toBe('保持原状')
  })
})
