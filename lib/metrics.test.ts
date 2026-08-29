import { describe, expect, it } from 'vitest'

import { computeEquityMaByDays, computeEquityMaByTrades } from './metrics'
import type { EquityPoint } from './types'

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
