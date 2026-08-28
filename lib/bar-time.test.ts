import { describe, expect, it } from 'vitest'

import {
  barNumberToTime,
  resolveCaseCardTimesForTrade,
  utcDayStart,
} from './bar-time'

const MIN = 5
const DAY = 24 * 60 * 60_000

// 复现生产数据场景：回放复盘，Trade 跨 2026-01-10 22:30 -> 01-11 01:20（UTC）
const D0 = Date.UTC(2026, 0, 10)
const D1 = D0 + DAY
const anchor = D0 + 22.5 * 60 * 60_000 // 首笔入场 22:30
const window = { anchor, start: D0, end: D1 + 4 * 60 * 60_000 + 10 * 60_000 }

let seq = 0
function card(barRef: number | null, offsetMs = 0) {
  seq += 1
  return { id: `c${seq}`, createdAt: anchor + seq * 60_000 + offsetMs, barRef }
}

describe('resolveCaseCardTimesForTrade', () => {
  it('锚定 Trade 首笔成交日而不是卡片 createdAt 日', () => {
    // createdAt 在遥远的另一天（回放录制墙钟），锚点必须是 anchor 的 UTC 日
    const c = { id: 'x', createdAt: Date.UTC(2026, 7, 28), barRef: 218 }
    const resolved = resolveCaseCardTimesForTrade([c], MIN, window)
    expect(resolved.get('x')?.time).toBe(barNumberToTime(D0, 218, MIN))
    expect(resolved.get('x')?.invalid).toBe(false)
  })

  it('序号变小判定跨 UTC 日：day1 的 283 之后接 day2 的 4', () => {
    const a = card(283)
    const b = card(4)
    const resolved = resolveCaseCardTimesForTrade([a, b], MIN, window)
    expect(resolved.get(a.id)?.time).toBe(barNumberToTime(D0, 283, MIN))
    expect(resolved.get(b.id)?.time).toBe(barNumberToTime(D1, 4, MIN))
    expect(resolved.get(b.id)?.invalid).toBe(false)
  })

  it('越界 barRef（语音误识别 2265）不参与推导，按创建顺序兜底并标记异常', () => {
    const a = card(259)
    const poison = card(2265)
    const resolved = resolveCaseCardTimesForTrade([a, poison], MIN, window)
    const aTime = barNumberToTime(D0, 259, MIN)
    expect(resolved.get(poison.id)?.time).toBe(aTime + 1)
    expect(resolved.get(poison.id)?.invalid).toBe(true)
  })

  it('跨日推导越过窗口末尾时回退到上一张之后（回看区间噪声）', () => {
    // 259 -> 252：252 早于 259 触发日 +1，落点超出 window.end，放弃 bar 数学
    const a = card(259)
    const b = card(252)
    const resolved = resolveCaseCardTimesForTrade([a, b], MIN, { ...window, end: D0 + 23 * 60 * 60_000 })
    const aTime = barNumberToTime(D0, 259, MIN)
    expect(resolved.get(b.id)?.time).toBe(aTime + 1)
    expect(resolved.get(b.id)?.invalid).toBe(true)
  })

  it('无 barRef 卡片沿用上一张时间 +1ms，保持创建顺序', () => {
    const a = card(218)
    const none = card(null)
    const b = card(254)
    const none2 = card(null)
    const resolved = resolveCaseCardTimesForTrade([a, none, b, none2], MIN, window)
    const aTime = barNumberToTime(D0, 218, MIN)
    const bTime = barNumberToTime(D0, 254, MIN)
    expect(resolved.get(a.id)?.time).toBe(aTime)
    expect(resolved.get(none.id)?.time).toBe(aTime + 1)
    expect(resolved.get(none.id)?.invalid).toBe(false)
    expect(resolved.get(b.id)?.time).toBe(bTime)
    expect(resolved.get(none2.id)?.time).toBe(bTime + 1)
  })

  it('生产数据全序列：毒值与回看噪声不破坏单调创建顺序', () => {
    seq = 0
    const refs: Array<number | null> = [
      218, 254, 257, 258, 259, 252, 2265, 266, 268, null, 270,
      null, null, 272, 283, 271, 4, 6, 9, 10, 14, 15, 15, 17, 48,
    ]
    const cards = refs.map((ref) => card(ref))
    const resolved = resolveCaseCardTimesForTrade(cards, MIN, window)
    const times = cards.map((c) => resolved.get(c.id)!.time)
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
    }
    // 入场卡 270 解析到 D0 22:25（首笔成交 22:30 在其后的下一根 bar，挂单在前）
    const entryCard = cards[10]
    expect(resolved.get(entryCard.id)?.time).toBe(utcDayStart(anchor) + (270 - 1) * MIN * 60_000)
    // 次日卡 4 落在 01-11
    expect(resolved.get(cards[16].id)?.time).toBe(D1 + (4 - 1) * MIN * 60_000)
    // 复盘卡 48 落在 01-11 03:55，仍在窗口内
    expect(resolved.get(cards[24].id)?.time).toBe(D1 + (48 - 1) * MIN * 60_000)
  })
})
