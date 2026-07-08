import type { ChartTimeframe } from './types'

export const CHART_TIMEFRAMES: Array<{ value: ChartTimeframe; label: string; minutes: number }> = [
  { value: '5m', label: '5分钟', minutes: 5 },
  { value: '15m', label: '15分钟', minutes: 15 },
  { value: '1h', label: '1小时', minutes: 60 },
  { value: '4h', label: '4小时', minutes: 240 },
  { value: '1d', label: '日线', minutes: 1440 },
]

export function chartTimeframeLabel(value: ChartTimeframe) {
  return CHART_TIMEFRAMES.find((item) => item.value === value)?.label ?? value
}

export function chartTimeframeMinutes(value: ChartTimeframe) {
  return CHART_TIMEFRAMES.find((item) => item.value === value)?.minutes ?? 5
}
