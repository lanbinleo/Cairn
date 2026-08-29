import { describe, expect, it } from 'vitest'

import { fmtCompactMoney } from './format'

describe('fmtCompactMoney', () => {
  it('小数值保持完整格式', () => {
    expect(fmtCompactMoney(0)).toBe('$0.00')
    expect(fmtCompactMoney(123.456)).toBe('$123.46')
    expect(fmtCompactMoney(9_999.99)).toBe('$9,999.99')
  })

  it('负数带符号', () => {
    expect(fmtCompactMoney(-250)).toBe('-$250.00')
    expect(fmtCompactMoney(-25_000)).toBe('-$25.0K')
  })

  it('达到 1 万启用紧凑后缀', () => {
    expect(fmtCompactMoney(10_000)).toBe('$10.0K')
    expect(fmtCompactMoney(123_456)).toBe('$123.5K')
    expect(fmtCompactMoney(1_234_567)).toBe('$1.23M')
    expect(fmtCompactMoney(250_000)).toBe('$250.0K')
    expect(fmtCompactMoney(2_500_000_000)).toBe('$2.50B')
  })

  it('量级越大保留小数越少', () => {
    expect(fmtCompactMoney(12_345)).toBe('$12.3K')
    expect(fmtCompactMoney(123_456)).toBe('$123.5K')
    expect(fmtCompactMoney(1_234_567)).toBe('$1.23M')
    expect(fmtCompactMoney(12_345_678)).toBe('$12.3M')
    expect(fmtCompactMoney(123_456_789)).toBe('$123.5M')
  })

  it('USDT 与其他币种保持 fmtMoney 的前缀/后缀约定', () => {
    expect(fmtCompactMoney(25_000, 'USDT')).toBe('25.0K USDT')
    expect(fmtCompactMoney(25_000, 'CNY')).toBe('CNY 25.0K')
  })
})
