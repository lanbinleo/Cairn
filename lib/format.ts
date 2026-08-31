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

/** 紧凑金额（统计卡单行用）：|值| ≥ 1 万时用 K/M/B 后缀（$12.4K / $1.23M），否则完整格式。
 *  完整值由调用处通过 title 提示展示。 */
export function fmtCompactMoney(value: number, currency = 'USD'): string {
  const abs = Math.abs(value)
  if (abs < 10_000) return fmtMoney(value, currency)
  const sign = value < 0 ? '-' : ''
  const symbol = currency === 'USD' ? '$' : currency === 'USDT' ? '' : `${currency} `
  const suffix = currency === 'USDT' ? ' USDT' : ''
  const compact = (div: number, unit: string) => {
    const scaled = abs / div
    const digits = scaled >= 10 ? 1 : 2
    return `${sign}${symbol}${scaled.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}${suffix}`
  }
  if (abs >= 1_000_000_000) return compact(1_000_000_000, 'B')
  if (abs >= 1_000_000) return compact(1_000_000, 'M')
  return compact(1_000, 'K')
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

/** 数值（AI 上下文用）：最多 precision 位小数并去掉尾零——去掉浮点累加噪声
 *  （2.4425999999999997 → 2.4426），无千分位逗号，与 Rust 侧 fmt_num 同语义。 */
export function fmtNum(value: number, precision = 6): string {
  const digits = Math.max(0, Math.min(precision, 20))
  return String(Number(value.toFixed(digits)))
}

/** 数量（仓位/手数）：fmtNum 的默认 6 位——去掉浮点噪声的同时不损失合约数量精度。 */
export function fmtQty(value: number): string {
  return fmtNum(value)
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

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本地时区可读相对时间：数秒前 / N 分钟前 / N 小时前 / 昨天 / 前天 / MM-DD / YYYY-MM-DD */
export function fmtRelativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 60_000) return '数秒前'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(ms)) / 86_400_000)
  if (days === 1) return '昨天'
  if (days === 2) return '前天'
  const d = new Date(ms)
  const monthDay = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return d.getFullYear() === new Date(now).getFullYear() ? monthDay : `${d.getFullYear()}-${monthDay}`
}
