import * as XLSX from 'xlsx'

import type { ChartBar, Execution, Trade, TradeDirection, OrderType } from './types'

const defaultExportKey = ['def', 'ault'].join('')
const xlsx = (XLSX as unknown as Record<string, typeof XLSX>)[defaultExportKey] ?? XLSX

export interface RawImportRow {
  sourceRef: string
  sourceTradeNo?: string
  type: string
  orderType?: OrderType
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
  type: ['Type', '类型', '方向', '交易类型'],
  orderType: ['Order Type', 'Order', '订单类型', '委托类型'],
  signal: ['Signal', '信号', '信号名称'],
  time: ['Date/Time', 'Date Time', 'Time', '时间', '日期时间', '日期和时间', '成交时间'],
  price: ['Price', '价格', '价格 USDT', '价格 USD', '成交价'],
  quantity: ['Qty', 'Quantity', '数量', '大小（数量）', '大小 (数量)', '合约', 'Contracts'],
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

function numberToTime(value: number) {
  if (value > 1_000_000_000_000) return value
  if (value > 1_000_000_000) return value * 1000
  const parsed = xlsx.SSF.parse_date_code(value)
  if (parsed) {
    return Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))
  }
  return null
}

function toTime(value: unknown) {
  if (typeof value === 'number') {
    return numberToTime(value)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d+(\.\d+)?$/.test(raw)) return numberToTime(Number(raw))
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const withZone = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`
  const ms = Date.parse(withZone)
  return Number.isFinite(ms) ? ms : null
}

function rowsFromFirstMatchingSheet(workbook: XLSX.WorkBook, required: Array<Array<string>>) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    const sample = rows.find((row) => Object.keys(row).length > 0)
    if (sample && required.every((aliases) => valueByAliases(sample, aliases) !== undefined)) {
      return rows
    }
  }
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
}

function inferDirection(type: string, signal?: string): TradeDirection | null {
  const text = `${type} ${signal ?? ''}`.toLowerCase()
  if (type.includes('多') || type.includes('开多') || type.includes('平多') || text.includes('long')) return 'long'
  if (type.includes('空') || type.includes('开空') || type.includes('平空') || text.includes('short')) return 'short'
  return null
}

function isEntry(type: string) {
  const lower = type.toLowerCase()
  return type.includes('进场') || type.includes('开仓') || type.includes('开多') || type.includes('开空') || lower.includes('entry')
}

function isExit(type: string) {
  const lower = type.toLowerCase()
  return type.includes('出场') || type.includes('平仓') || type.includes('平多') || type.includes('平空') || lower.includes('exit') || lower.includes('close')
}

export function inferOrderType(signal?: string, rawOrderType?: string): OrderType {
  const lower = `${rawOrderType ?? ''} ${signal ?? ''}`.toLowerCase()
  if (lower.includes('tp') || lower.includes('take') || lower.includes('止盈')) return 'take-profit'
  if (lower.includes('sl') || lower.includes('stop loss') || lower.includes('止损')) return 'stop-loss'
  if (lower.includes('stop')) return 'stop'
  if (lower.includes('limit') || lower.includes('限价')) return 'limit'
  return 'market'
}

export async function parseTradingViewRows(file: File): Promise<RawImportRow[]> {
  const buffer = await file.arrayBuffer()
  const workbook = xlsx.read(buffer, { type: 'array', cellDates: false })
  const rows = rowsFromFirstMatchingSheet(workbook, [
    FIELD_ALIASES.type,
    FIELD_ALIASES.time,
    FIELD_ALIASES.price,
    FIELD_ALIASES.quantity,
  ])

  return rows.flatMap((row, index) => {
    const type = String(valueByAliases(row, FIELD_ALIASES.type) ?? '').trim()
    const rawOrderType = String(valueByAliases(row, FIELD_ALIASES.orderType) ?? '').trim()
    const signal = String(valueByAliases(row, FIELD_ALIASES.signal) ?? '').trim()
    const time = toTime(valueByAliases(row, FIELD_ALIASES.time))
    const price = toNumber(valueByAliases(row, FIELD_ALIASES.price))
    const quantity = toNumber(valueByAliases(row, FIELD_ALIASES.quantity))
    if (!type || time == null || price == null || quantity == null || quantity <= 0) return []
    const tradeNo = String(valueByAliases(row, FIELD_ALIASES.tradeNo) ?? '').trim()
    return [{
      sourceRef: `tv:row:${index + 1}`,
      sourceTradeNo: tradeNo || undefined,
      type,
      orderType: inferOrderType(signal, rawOrderType),
      signal: signal || undefined,
      time,
      price,
      quantity,
    }]
  })
}

export async function parseChartBars(file: File): Promise<ChartBar[]> {
  const buffer = await file.arrayBuffer()
  const workbook = xlsx.read(buffer, { type: 'array', cellDates: false })
  const rows = rowsFromFirstMatchingSheet(workbook, [
    CHART_FIELD_ALIASES.time,
    CHART_FIELD_ALIASES.open,
    CHART_FIELD_ALIASES.high,
    CHART_FIELD_ALIASES.low,
    CHART_FIELD_ALIASES.close,
  ])

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

function buildTradeFromRows(rows: RawImportRow[], id: string): ProposedTrade {
  const sorted = [...rows].sort((a, b) => a.time - b.time)
  const firstDirection = sorted.map((row) => inferDirection(row.type, row.signal)).find((direction) => direction != null)
  const trade: ProposedTrade = {
    id,
    direction: firstDirection ?? 'long',
    executions: [],
    warning: firstDirection ? undefined : `无法识别方向：${sorted[0]?.type ?? ''}`,
  }
  let position = 0

  for (const row of sorted) {
    const direction = inferDirection(row.type, row.signal)
    if (direction && direction !== trade.direction) {
      trade.warning = '同一 TradingView 交易编号内检测到方向不一致，请确认。'
    }
    const entry = isEntry(row.type)
    const exit = isExit(row.type)
    const action: Execution['action'] = entry
      ? position === 0 ? 'entry' : 'scale-in'
      : exit
        ? row.quantity >= position ? 'exit' : 'scale-out'
        : position === 0 ? 'entry' : 'scale-in'

    trade.executions.push({ ...row, action })
    if (action === 'entry' || action === 'scale-in') {
      position += row.quantity
    } else {
      position = Math.max(0, position - row.quantity)
    }
  }

  return trade
}

export function groupRows(rows: RawImportRow[]): ProposedTrade[] {
  const rowsWithTradeNo = rows.filter((row) => row.sourceTradeNo)
  if (rows.length > 0 && rowsWithTradeNo.length === rows.length) {
    const groups = new Map<string, RawImportRow[]>()
    for (const row of rows) {
      const key = row.sourceTradeNo as string
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    return [...groups.entries()]
      .map(([tradeNo, group]) => buildTradeFromRows(group, `tv-${tradeNo}`))
      .sort((a, b) => a.executions[0].time - b.executions[0].time)
  }

  const sorted = [...rows].sort((a, b) => a.time - b.time)
  const proposed: ProposedTrade[] = []
  let current: ProposedTrade | null = null
  let position = 0

  for (const row of sorted) {
    const direction = inferDirection(row.type, row.signal)
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
