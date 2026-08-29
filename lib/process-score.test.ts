import { describe, expect, it } from 'vitest'

import { extractExplicitBarRef } from './cases'
import { firstNumberIn, firstPlausibleNumberIn } from './process-score'

describe('extractExplicitBarRef', () => {
  it('取最早出现的显式引用', () => {
    expect(extractExplicitBarRef('BAR41 之后看到回调')).toBe(41)
    expect(extractExplicitBarRef('先犹豫了一下，然后 bar #38 收了长上影')).toBe(38)
    expect(extractExplicitBarRef('第 42 根 K 线跌破区间')).toBe(42)
    expect(extractExplicitBarRef('没有锚点')).toBeUndefined()
  })

  it('越界引用（>1440）不参与——语音误识别的 2000 不落库', () => {
    expect(extractExplicitBarRef('BAR 2000 的时候我还不知道')).toBeUndefined()
    expect(extractExplicitBarRef('BAR 1440 是今天的最后一根')).toBe(1440)
  })
})

describe('firstNumberIn', () => {
  it('取第一个数字（含小数与负号）', () => {
    expect(firstNumberIn('区间上沿上方 41650')).toBe(41650)
    expect(firstNumberIn('90820.36 下方')).toBe(90820.36)
    expect(firstNumberIn('回落 -12.5 再说')).toBe(-12.5)
    expect(firstNumberIn('没有数字')).toBeNull()
    expect(firstNumberIn(undefined)).toBeNull()
  })
})

describe('firstPlausibleNumberIn', () => {
  const ref = 90800

  it('正常价格直通', () => {
    expect(firstPlausibleNumberIn('止损 90364 附近', ref)).toBe(90364)
    expect(firstPlausibleNumberIn('90820.36 这个位置', ref)).toBe(90820.36)
  })

  it('K 线号不被当成价格（生产案例：initialEntryPrice=64）', () => {
    expect(firstPlausibleNumberIn('在 64 号 K 线的底部挂一个 stop order', ref)).toBeNull()
  })

  it('K 线号在前、真价格在后时跳过 K 线号', () => {
    expect(firstPlausibleNumberIn('64 号 K 线下方挂单，价格改到 90767', ref)).toBe(90767)
  })

  it('盈亏倍数不被当成价格（生产案例：initialTakeProfit=2）', () => {
    expect(firstPlausibleNumberIn('至少拿到一个 2~3 倍', ref)).toBeNull()
  })

  it('仓位百分比被数量级过滤', () => {
    expect(firstPlausibleNumberIn('按 2% 仓位开', ref)).toBeNull()
  })

  it('无参考价时退化为第一个数字', () => {
    expect(firstPlausibleNumberIn('止损 41650', null)).toBe(41650)
    expect(firstPlausibleNumberIn('64 号 K 线', null)).toBe(64)
    expect(firstPlausibleNumberIn(undefined, ref)).toBeNull()
  })

  it('低价品种也在允许区间内（参考价上下 10 倍）', () => {
    expect(firstPlausibleNumberIn('止盈 0.15', 0.12)).toBe(0.15)
    expect(firstPlausibleNumberIn('止损 64', 0.12)).toBeNull()
  })
})
