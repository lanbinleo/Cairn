import * as XLSX from 'xlsx'

import type { ChartBar, Execution, Trade, TradeDirection, OrderType } from './types'

export interface RawImportRow {
  sourceRef: string
  type: string
  signal?: string
  time: number
  price: number
  quantity: number
}

export interface ProposedExecution extends RawImportRow {
  action: Execution['action']
}

export interface ProposedTrade {
  id: string
  direction: TradeDirection
  executions: ProposedExecution[]
  warning?: string
}

const FIELD_ALIASES = {
  tradeNo: ['Trade #', 'Trade No', 'Trade', '交易 #', '交易编号', '编号'],
  type: ['Type', '类型', '订单类型', '方向'],
  signal: ['Signal', '信号', '信号名称'],
  time: ['Date/Time', 'Date Time', 'Time', '时间', '日期时间', '成交时间'],
  price: ['Price', '价格', '成交价'],
  quantity: ['Qty', 'Quantity', '数量', '合约', 'Contracts'],
}

const CHART_FIELD_ALIASES = {
  time: ['time', 'Time', 'Date/Time', '时间', '日期时间'],
  open: ['open', 'Open', '开盘', '开盘价'],
  high: ['high', 'High', '最高', '最高价'],
  low: ['low', 'Low', '最低', '最低价'],
  close: ['close', 'Close', '收盘', '收盘价'],
  ema20: ['EMA20', 'ema20', 'EMA 20', 'EMA', 'ema'],
}

function valueByAliases(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias] != null && String(row[alias]).trim() !== '') return row[alias]
  }
  const lowerMap = new Map(Object.keys(row).map((key) => [key.trim().toLowerCase(), key]))
  for (const alias of aliases) {
    const key = lowerMap.get(alias.toLowerCase())
    if (key && row[key] != null && String(row[key]).trim() !== '') return row[key]
  }
  return undefined
}

function toNumber(value: unknown) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function toTime(value: unknown) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))
    }
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const withZone = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`
  const ms = Date.parse(withZone)
  return Number.isFinite(ms) ? ms : null
}

function inferDirection(type: string): TradeDirection | null {
  const lower = type.toLowerCase()
  if (type.includes('多') || lower.includes('long')) return 'long'
  if (type.includes('空') || lower.includes('short')) return 'short'
  return null
}

function isEntry(type: string) {
  const lower = type.toLowerCase()
  return type.includes('进场') || type.includes('买入') || lower.includes('entry') || lower.includes('buy')
}

function isExit(type: string) {
  const lower = type.toLowerCase()
  return type.includes('出场') || type.includes('卖出') || lower.includes('exit') || lower.includes('sell')
}

export function inferOrderType(signal?: string): OrderType {
  const lower = (signal ?? '').toLowerCase()
  if (lower.includes('tp') || lower.includes('take')) return 'take-profit'
  if (lower.includes('sl') || lower.includes('stop')) return 'stop-loss'
  return 'market'
}

export async function parseTradingViewRows(file: File): Promise<RawImportRow[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return rows.flatMap((row, index) => {
    const type = String(valueByAliases(row, FIELD_ALIASES.type) ?? '').trim()
    const signal = String(valueByAliases(row, FIELD_ALIASES.signal) ?? '').trim()
    const time = toTime(valueByAliases(row, FIELD_ALIASES.time))
    const price = toNumber(valueByAliases(row, FIELD_ALIASES.price))
    const quantity = toNumber(valueByAliases(row, FIELD_ALIASES.quantity))
    if (!type || time == null || price == null || quantity == null || quantity <= 0) return []
    const tradeNo = String(valueByAliases(row, FIELD_ALIASES.tradeNo) ?? index + 1)
    return [{
      sourceRef: `tv:row:${tradeNo}`,
      type,
      signal: signal || undefined,
      time,
      price,
      quantity,
    }]
  })
}

export async function parseChartBars(file: File): Promise<ChartBar[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return rows.flatMap((row) => {
    const time = toTime(valueByAliases(row, CHART_FIELD_ALIASES.time))
    const open = toNumber(valueByAliases(row, CHART_FIELD_ALIASES.open))
    const high = toNumber(valueByAliases(row, CHART_FIELD_ALIASES.high))
    const low = toNumber(valueByAliases(row, CHART_FIELD_ALIASES.low))
    const close = toNumber(valueByAliases(row, CHART_FIELD_ALIASES.close))
    if (time == null || open == null || high == null || low == null || close == null) return []
    const ema20 = toNumber(valueByAliases(row, CHART_FIELD_ALIASES.ema20))
    return [{
      time,
      open,
      high,
      low,
      close,
      ema20: ema20 ?? undefined,
    }]
  }).sort((a, b) => a.time - b.time)
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function groupRows(rows: RawImportRow[]): ProposedTrade[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time)
  const proposed: ProposedTrade[] = []
  let current: ProposedTrade | null = null
  let position = 0

  for (const row of sorted) {
    const direction = inferDirection(row.type)
    if (!direction) {
      proposed.push({
        id: `warning-${proposed.length + 1}`,
        direction: 'long',
        executions: [{ ...row, action: 'entry' }],
        warning: `无法识别方向：${row.type}`,
      })
      continue
    }

    if (!current || position <= 0) {
      current = {
        id: `group-${proposed.length + 1}`,
        direction,
        executions: [],
      }
      proposed.push(current)
      position = 0
    }

    if (current.direction !== direction && position > 0) {
      current.warning = '检测到未平仓时方向切换，请确认归组。'
      current = {
        id: `group-${proposed.length + 1}`,
        direction,
        executions: [],
      }
      proposed.push(current)
      position = 0
    }

    const entry = isEntry(row.type)
    const exit = isExit(row.type)
    const action: Execution['action'] = entry
      ? position === 0 ? 'entry' : 'scale-in'
      : exit
        ? row.quantity >= position ? 'exit' : 'scale-out'
        : position === 0 ? 'entry' : 'scale-in'

    current.executions.push({ ...row, action })
    if (action === 'entry' || action === 'scale-in') {
      position += row.quantity
    } else {
      position = Math.max(0, position - row.quantity)
    }
  }

  return proposed
}
