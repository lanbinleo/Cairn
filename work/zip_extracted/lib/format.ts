/** 显示格式化工具：金额、百分比、UTC 时间 */

export function fmtMoney(value: number, currency = 'USD', digits = 2): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const symbol = currency === 'USD' ? '$' : currency === 'USDT' ? '' : `${currency} `
  const suffix = currency === 'USDT' ? ' USDT' : ''
  return `${sign}${symbol}${abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`
}

export function fmtSignedMoney(value: number, currency = 'USD', digits = 2): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${fmtMoney(value, currency, digits)}`
}

export function fmtPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function fmtPrice(value: number, precision = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

export function fmtR(r: number | null): string {
  if (r == null) return '—'
  const prefix = r > 0 ? '+' : ''
  return `${prefix}${r.toFixed(2)}R`
}

/** UTC 日期：2026-01-15 */
export function fmtUtcDate(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** UTC 时间：2026-01-15 08:35 UTC（withSuffix=false 时省略 UTC 后缀） */
export function fmtUtcDateTime(ms: number, withSuffix = true): string {
  const d = new Date(ms)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${fmtUtcDate(ms)} ${h}:${min}${withSuffix ? ' UTC' : ''}`
}

/** 仅时间部分：08:35 */
export function fmtUtcTime(ms: number): string {
  const d = new Date(ms)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

/** 持仓时长：2h 35m / 45m / 3d 4h */
export function fmtDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** 日期范围：2026-01-05 → 2026-01-28 */
export function fmtDateRange(start: number, end: number): string {
  return `${fmtUtcDate(start)} → ${fmtUtcDate(end)}`
}
