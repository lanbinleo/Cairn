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

/**
 * 按创建顺序把一个 Case 的卡片 barRef 解析为 UTC 时间（防 hindsight，机械推导）。
 * 规则：卡片创建顺序即时间顺序；首张带 barRef 的卡片锚定自身 createdAt 所在 UTC 日；
 * 后续卡片若换算结果早于上一张的已解析时间（即序号变小），判定跨了 UTC 日界，日 +1；
 * 序号相同视为同一根 bar；不带 barRef 的卡片沿用 createdAt，不参与约束。
 * 用于消除跨天 Case 中每日重置的 bar 序号歧义。
 */
export function resolveCaseCardTimes(
  cards: Array<{ id: string; createdAt: number; barRef?: number | null }>,
  timeframeMinutes: number,
): Map<string, number> {
  const resolved = new Map<string, number>()
  let prevTime: number | null = null
  let prevDay: number | null = null
  const ordered = [...cards].sort((a, b) => a.createdAt - b.createdAt)
  for (const card of ordered) {
    if (card.barRef == null) continue
    let day: number = prevDay ?? utcDayStart(card.createdAt)
    let time: number = barNumberToTime(day, card.barRef, timeframeMinutes)
    while (prevTime != null && time < prevTime) {
      day += 24 * 60 * 60_000
      time = barNumberToTime(day, card.barRef, timeframeMinutes)
    }
    resolved.set(card.id, time)
    prevTime = time
    prevDay = day
  }
  return resolved
}
