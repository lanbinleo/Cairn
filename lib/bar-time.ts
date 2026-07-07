/**
 * Bar 序号 ↔ UTC 时间双向换算
 * 约定：一天从 UTC 00:00 开始；bar 序号从 0 开始。
 * 例如 5m 周期一天共 288 根（0–287）。
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

/** 给定任意 UTC 时间，返回当天 UTC 00:00 */
export function utcDayStart(time: number): number {
  const d = new Date(time)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** 校验 bar 序号是否在当天范围内 */
export function isValidBarIndex(barIndex: number, timeframeMinutes: number): boolean {
  return Number.isInteger(barIndex) && barIndex >= 0 && barIndex < barsPerDay(timeframeMinutes)
}
