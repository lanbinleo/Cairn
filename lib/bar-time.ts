/**
 * Bar 序号 ↔ UTC 时间双向换算
 * 约定：一天从 UTC 00:00 开始；内部 barIndex 从 0 开始。
 * UI 输入和显示使用 1-based barNumber。
 * 注意：bar 序号仅为录入辅助，数据库只存真实 UTC 时间。
 */

export const TIMEFRAMES = [
  { value: 1, label: '1 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 240, label: '4 小时' },
] as const

/** 某 timeframe 下一天的 bar 总数 */
export function barsPerDay(timeframeMinutes: number): number {
  return Math.floor((24 * 60) / timeframeMinutes)
}

/**
 * bar 序号 → UTC 时间
 * @param dayStartUtc 当天 UTC 00:00 的 epoch ms
 */
export function barIndexToTime(dayStartUtc: number, barIndex: number, timeframeMinutes: number): number {
  return dayStartUtc + barIndex * timeframeMinutes * 60_000
}

/**
 * UTC 时间 → bar 序号（相对当天 UTC 00:00）
 */
export function timeToBarIndex(time: number, timeframeMinutes: number): number {
  const dayStart = utcDayStart(time)
  return Math.floor((time - dayStart) / (timeframeMinutes * 60_000))
}

/** UI 显示用 bar 编号：从 1 开始 */
export function timeToBarNumber(time: number, timeframeMinutes: number): number {
  return timeToBarIndex(time, timeframeMinutes) + 1
}

/** UI 输入 bar 编号 → UTC 时间 */
export function barNumberToTime(dayStartUtc: number, barNumber: number, timeframeMinutes: number): number {
  return barIndexToTime(dayStartUtc, barNumber - 1, timeframeMinutes)
}

/** 给定任意 UTC 时间，返回当天 UTC 00:00 */
export function utcDayStart(time: number): number {
  const d = new Date(time)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** 校验 bar 序号是否在当天范围内 */
export function isValidBarIndex(barIndex: number, timeframeMinutes: number): boolean {
  return Number.isInteger(barIndex) && barIndex >= 0 && barIndex < barsPerDay(timeframeMinutes)
}

/** 校验 UI 输入的 1-based bar 编号 */
export function isValidBarNumber(barNumber: number, timeframeMinutes: number): boolean {
  return Number.isInteger(barNumber) && barNumber >= 1 && barNumber <= barsPerDay(timeframeMinutes)
}

export interface ResolvedCaseCardTime {
  time: number
  /** barRef 越界或跨日推导越窗，时间按创建顺序兜底放置 */
  invalid: boolean
}

/**
 * 按创建顺序把绑定 Trade 的 Case 卡片 barRef 解析为 UTC 时间（防 hindsight，机械推导）。
 * 锚点：window.anchor（Trade 首笔持仓成交时刻）所在 UTC 日。回放/复盘场景下卡片
 * createdAt 是记录墙钟时间，与图表日期无关，不能用来锚定。
 * 规则：
 * - barRef 先做当日合法性校验（1..barsPerDay），越界值（如语音误识别的 2265）不参与推导；
 * - 候选时间早于上一张卡片的已解析时间（序号变小）→ 判定跨 UTC 日界，日 +1；
 * - 跨日后仍越过 window.end 的（回看区间等噪声），放弃 bar 数学，紧跟上一张放置；
 * - 无 barRef 或无效的卡片沿用上一张时间 +1ms，保持创建顺序。
 * 记录顺序优先于 bar 数学：解析结果永不回退。
 */
export function resolveCaseCardTimesForTrade(
  cards: Array<{ id: string; createdAt: number; barRef?: number | null }>,
  timeframeMinutes: number,
  window: { anchor: number; start: number; end: number },
): Map<string, ResolvedCaseCardTime> {
  const resolved = new Map<string, ResolvedCaseCardTime>()
  let prevTime: number | null = null
  let prevDay = utcDayStart(window.anchor)
  const ordered = [...cards].sort((a, b) => a.createdAt - b.createdAt)
  for (const card of ordered) {
    if (card.barRef == null || !isValidBarNumber(card.barRef, timeframeMinutes)) {
      resolved.set(card.id, { time: prevTime == null ? window.start : prevTime + 1, invalid: card.barRef != null })
      prevTime = prevTime == null ? window.start : prevTime + 1
      continue
    }
    let day = prevDay
    let time = barNumberToTime(day, card.barRef, timeframeMinutes)
    while (prevTime != null && time < prevTime) {
      day += 24 * 60 * 60_000
      time = barNumberToTime(day, card.barRef, timeframeMinutes)
    }
    if (time > window.end) {
      time = prevTime == null ? window.start : prevTime + 1
      resolved.set(card.id, { time, invalid: true })
      prevTime = time
      continue
    }
    resolved.set(card.id, { time, invalid: false })
    prevTime = time
    prevDay = day
  }
  return resolved
}
