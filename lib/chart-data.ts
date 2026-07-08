/**
 * Mock 图表数据生成：为某个 Trade 生成其时段的 5m OHLC + EMA20 序列。
 * 真实系统中，这些数据来自导入的 TradingView 图表数据导出。
 * 使用确定性 PRNG（同一 trade 每次生成结果一致），并锚定各 Execution 的成交价，
 * 使 K 线走势与交易记录相互吻合。
 */

import { hasPositionFill } from './executions'
import type { Trade, ChartBar } from './types'

const BAR_MS = 5 * 60_000

/** mulberry32 确定性 PRNG */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function alignToBar(time: number): number {
  return Math.floor(time / BAR_MS) * BAR_MS
}

/**
 * 生成覆盖该 Trade 全部 Execution 的 5m K 线序列（前后各加约 60 根缓冲），
 * 价格路径在各 Execution 时间点锚定其成交价，其余部分为受控随机游走。
 */
export function generateChartBars(trade: Trade): ChartBar[] {
  const execs = [...trade.executions].filter(hasPositionFill).sort((a, b) => a.time - b.time)
  if (execs.length === 0) return []

  const pad = 60 * BAR_MS
  const start = alignToBar(execs[0].time - pad)
  const end = alignToBar(execs[execs.length - 1].time + pad)
  const barCount = Math.min(Math.floor((end - start) / BAR_MS) + 1, 2000)

  const rand = mulberry32(hashString(trade.id))
  const anchors = execs.map((e) => ({ time: alignToBar(e.time), price: e.price }))
  const basePrice = anchors[0].price
  // 波动幅度与价格量级成比例
  const vol = basePrice * 0.0008

  // 先构造收盘价路径：分段在锚点间插值 + 噪声
  const closes: number[] = new Array(barCount)
  for (let i = 0; i < barCount; i++) {
    const t = start + i * BAR_MS
    // 找到左右锚点
    let left = { time: start - pad, price: basePrice * (1 + (rand() - 0.5) * 0.004) }
    let right = { time: end + pad, price: anchors[anchors.length - 1].price * (1 + (rand() - 0.5) * 0.004) }
    for (const a of anchors) {
      if (a.time <= t && a.time >= left.time) left = a
      if (a.time >= t && a.time < right.time) right = a
    }
    const span = right.time - left.time
    const ratio = span > 0 ? (t - left.time) / span : 0
    const base = left.price + (right.price - left.price) * ratio
    // 距锚点越远噪声越大
    const anchorDist = Math.min(Math.abs(t - left.time), Math.abs(right.time - t)) / BAR_MS
    const noise = (rand() - 0.5) * 2 * vol * Math.min(1, anchorDist / 6 + 0.15)
    closes[i] = base + noise
  }

  // 由收盘价路径生成 OHLC + EMA20
  const bars: ChartBar[] = []
  const k = 2 / (20 + 1)
  let ema: number | undefined
  for (let i = 0; i < barCount; i++) {
    const time = start + i * BAR_MS
    const open = i === 0 ? closes[0] + (rand() - 0.5) * vol : bars[i - 1].close
    const close = closes[i]
    const hi = Math.max(open, close) + rand() * vol * 0.8
    const lo = Math.min(open, close) - rand() * vol * 0.8
    ema = ema == null ? close : close * k + ema * (1 - k)
    bars.push({
      time,
      open,
      high: hi,
      low: lo,
      close,
      ema20: i >= 19 ? ema : undefined,
    })
  }
  return bars
}
