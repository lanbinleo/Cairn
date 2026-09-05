import * as XLSX from 'xlsx'

import type { ChartBar, Execution, Trade, TradeDirection, OrderType, TradeEventType } from './types'

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
  /** 导出文件自带的每行手续费（绝对金额，货币同账户）；无此列时靠账户费率事后推算 */
  commission?: number
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

export interface ParsedChartEvent {
  type: TradeEventType
  time: number
  price?: number
  sourceRef: string
  note?: string
}

const FIELD_ALIASES = {
  tradeNo: ['Trade #', 'Trade No', 'Trade', '交易 #', '交易编号', '编号'],
  type: ['Type', '类型', '方向', '交易类型'],
  orderType: ['Order Type', 'Order', '订单类型', '委托类型'],
  signal: ['Signal', '信号', '信号名称'],
  time: ['Date/Time', 'Date Time', 'Time', '时间', '日期时间', '日期和时间', '成交时间'],
  price: ['Price', '价格', '价格 USDT', '价格 USD', '成交价'],
  quantity: ['Qty', 'Quantity', '数量', '大小（数量）', '大小 (数量)', '合约', 'Contracts'],
  commission: ['Commission', '手续费', '佣金', '佣金费用'],
}

const CHART_FIELD_ALIASES = {
  time: ['time', 'Time', 'Date/Time', '时间', '日期时间'],
  open: ['open', 'Open', '开盘', '开盘价'],
  high: ['high', 'High', '最高', '最高价'],
  low: ['low', 'Low', '最低', '最低价'],
  close: ['close', 'Close', '收盘', '收盘价'],
  ema20: ['EMA20', 'ema20', 'EMA 20', 'EMA', 'ema'],
}

const CHART_EVENT_FIELD_ALIASES = {
  stopLoss: ['SL', 'Stop Loss', 'StopLoss', 'stop_loss', '止损', '止损价', '移动止损', 'Trailing Stop'],
  takeProfit: ['TP', 'Take Profit', 'TakeProfit', 'take_profit', '止盈', '止盈价', '移动止盈'],
}

const POSITION_EPS = 1e-9

interface IndexedImportRow {
  row: RawImportRow
  index: number
}

interface SourceTradeFragment {
  sourceTradeNo: string
  direction: TradeDirection
  rows: IndexedImportRow[]
  start: number
  end: number
  warning?: string
}

interface DraftGroupedTrade {
  id: string
  direction: TradeDirection
  rows: IndexedImportRow[]
  openUntil: number
  warning?: string
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

function compareSourceTradeNo(a: string, b: string) {
  const an = Number(a)
  const bn = Number(b)
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function compareRowsForPositionSimulation(a: IndexedImportRow, b: IndexedImportRow) {
  const timeDiff = a.row.time - b.row.time
  if (timeDiff !== 0) return timeDiff

  const sameSourceTrade = a.row.sourceTradeNo != null && a.row.sourceTradeNo === b.row.sourceTradeNo
  const aEntry = isEntry(a.row.type)
  const bEntry = isEntry(b.row.type)
  const aExit = isExit(a.row.type)
  const bExit = isExit(b.row.type)

  if (sameSourceTrade && aEntry !== bEntry && (aExit || bExit)) {
    return aEntry ? -1 : 1
  }
  if (!sameSourceTrade && aExit !== bExit && (aEntry || bEntry)) {
    return aExit ? -1 : 1
  }
  return a.index - b.index
}

function compareRowsWithinSourceTrade(a: IndexedImportRow, b: IndexedImportRow) {
  const timeDiff = a.row.time - b.row.time
  if (timeDiff !== 0) return timeDiff

  const aEntry = isEntry(a.row.type)
  const bEntry = isEntry(b.row.type)
  const aExit = isExit(a.row.type)
  const bExit = isExit(b.row.type)
  if (aEntry !== bEntry && (aExit || bExit)) return aEntry ? -1 : 1
  return a.index - b.index
}

function appendWarning(existing: string | undefined, next: string | undefined) {
  if (!next) return existing
  return existing ? `${existing} ${next}` : next
}

export function inferOrderType(signal?: string, rawOrderType?: string): OrderType {
  const lower = `${rawOrderType ?? ''} ${signal ?? ''}`.toLowerCase()
  if (lower.includes('trailing') || lower.includes('跟踪') || lower.includes('移动止损')) return 'trailing-stop'
  if (lower.includes('stop limit') || lower.includes('stop-limit') || lower.includes('止损限价')) return 'stop-limit'
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
    const commission = toNumber(valueByAliases(row, FIELD_ALIASES.commission))
    return [{
      sourceRef: `tv:row:${index + 1}`,
      sourceTradeNo: tradeNo || undefined,
      type,
      orderType: inferOrderType(signal, rawOrderType),
      signal: signal || undefined,
      time,
      price,
      quantity,
      commission: commission != null && Number.isFinite(commission) && commission !== 0 ? commission : undefined,
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

export async function parseChartEvents(file: File): Promise<ParsedChartEvent[]> {
  const buffer = await file.arrayBuffer()
  const workbook = xlsx.read(buffer, { type: 'array', cellDates: false })
  const rows = rowsFromFirstMatchingSheet(workbook, [CHART_FIELD_ALIASES.time])
  const sorted = rows
    .map((row, index) => ({ row, index, time: toTime(valueByAliases(row, CHART_FIELD_ALIASES.time)) }))
    .filter((item): item is { row: Record<string, unknown>; index: number; time: number } => item.time != null)
    .sort((a, b) => a.time - b.time)

  const events: ParsedChartEvent[] = []
  collectLevelEvents(sorted, CHART_EVENT_FIELD_ALIASES.stopLoss, 'sl-set', 'sl-moved', 'sl', events)
  collectLevelEvents(sorted, CHART_EVENT_FIELD_ALIASES.takeProfit, 'tp-set', 'tp-moved', 'tp', events)
  return events.sort((a, b) => a.time - b.time)
}

function collectLevelEvents(
  rows: Array<{ row: Record<string, unknown>; index: number; time: number }>,
  aliases: string[],
  setType: TradeEventType,
  movedType: TradeEventType,
  sourceLabel: string,
  out: ParsedChartEvent[],
) {
  let previous: number | null = null
  for (const item of rows) {
    const price = toNumber(valueByAliases(item.row, aliases))
    if (price == null || price <= 0) continue
    if (previous == null || Math.abs(previous - price) > 1e-9) {
      out.push({
        type: previous == null ? setType : movedType,
        time: item.time,
        price,
        sourceRef: `chart:row:${item.index + 1}:${sourceLabel}`,
      })
      previous = price
    }
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function finalizeGroupedTrade(draft: DraftGroupedTrade): ProposedTrade {
  const sorted = [...draft.rows].sort(compareRowsForPositionSimulation)
  const trade: ProposedTrade = {
    id: draft.id,
    direction: draft.direction,
    executions: [],
    warning: draft.warning,
  }
  let position = 0

  for (const { row } of sorted) {
    const direction = inferDirection(row.type, row.signal)
    if (!direction) {
      trade.warning = appendWarning(trade.warning, `无法识别方向：${row.type}`)
    } else if (direction !== trade.direction) {
      trade.warning = appendWarning(trade.warning, '同一归组内检测到方向不一致，请确认。')
    }

    const entry = isEntry(row.type)
    const exit = isExit(row.type)
    const shouldEnter = entry || !exit

    if (shouldEnter) {
      const action: Execution['action'] = position <= POSITION_EPS ? 'entry' : 'scale-in'
      trade.executions.push({ ...row, action })
      position += row.quantity
      continue
    }

    if (position <= POSITION_EPS) {
      trade.warning = appendWarning(trade.warning, '检测到没有对应持仓的离场记录，请确认归组。')
      trade.executions.push({ ...row, action: 'exit' })
      continue
    }

    const action: Execution['action'] = row.quantity >= position - POSITION_EPS ? 'exit' : 'scale-out'
    trade.executions.push({ ...row, action })
    if (row.quantity > position + POSITION_EPS) {
      trade.warning = appendWarning(trade.warning, '检测到离场数量大于当前模拟持仓，请确认数量或归组。')
    }
    position = Math.max(0, position - row.quantity)
  }

  return trade
}

function buildSourceTradeFragment(sourceTradeNo: string, rows: IndexedImportRow[]): SourceTradeFragment {
  const sorted = [...rows].sort(compareRowsWithinSourceTrade)
  const directions = sorted.map(({ row }) => inferDirection(row.type, row.signal)).filter((direction): direction is TradeDirection => direction != null)
  const direction = directions[0] ?? 'long'
  const entries = sorted.filter(({ row }) => isEntry(row.type))
  const exits = sorted.filter(({ row }) => isExit(row.type))
  const start = (entries[0] ?? sorted[0]).row.time
  const end = exits.length > 0 ? Math.max(...exits.map(({ row }) => row.time)) : Number.POSITIVE_INFINITY
  let warning: string | undefined

  if (directions.length === 0) {
    warning = appendWarning(warning, `无法识别 TV 编号 ${sourceTradeNo} 的方向。`)
  } else if (directions.some((item) => item !== direction)) {
    warning = appendWarning(warning, `TV 编号 ${sourceTradeNo} 内检测到方向不一致。`)
  }
  if (entries.length === 0) {
    warning = appendWarning(warning, `TV 编号 ${sourceTradeNo} 缺少进场记录。`)
  }
  if (exits.length === 0) {
    warning = appendWarning(warning, `TV 编号 ${sourceTradeNo} 缺少离场记录。`)
  }

  return {
    sourceTradeNo,
    direction,
    rows: sorted,
    start,
    end,
    warning,
  }
}

function groupRowsBySourceTrades(indexedRows: IndexedImportRow[]): ProposedTrade[] {
  const bySourceTrade = new Map<string, IndexedImportRow[]>()
  for (const item of indexedRows) {
    const sourceTradeNo = item.row.sourceTradeNo as string
    bySourceTrade.set(sourceTradeNo, [...(bySourceTrade.get(sourceTradeNo) ?? []), item])
  }

  const fragments = [...bySourceTrade.entries()]
    .map(([sourceTradeNo, sourceRows]) => buildSourceTradeFragment(sourceTradeNo, sourceRows))
    .sort((a, b) => a.start - b.start || compareSourceTradeNo(a.sourceTradeNo, b.sourceTradeNo))

  const drafts: DraftGroupedTrade[] = []
  const activeByDirection: Record<TradeDirection, DraftGroupedTrade | null> = {
    long: null,
    short: null,
  }

  for (const fragment of fragments) {
    let draft = activeByDirection[fragment.direction]
    const overlapsActiveTrade = draft != null && fragment.start < draft.openUntil - POSITION_EPS
    if (!overlapsActiveTrade || draft == null) {
      draft = {
        id: `group-${drafts.length + 1}`,
        direction: fragment.direction,
        rows: [],
        openUntil: fragment.end,
      }
      drafts.push(draft)
      activeByDirection[fragment.direction] = draft
    }

    draft.rows.push(...fragment.rows)
    draft.openUntil = Math.max(draft.openUntil, fragment.end)
    draft.warning = appendWarning(draft.warning, fragment.warning)
  }

  return drafts.map(finalizeGroupedTrade)
}

function groupRowsByNetPosition(indexedRows: IndexedImportRow[]): ProposedTrade[] {
  const sorted = [...indexedRows].sort(compareRowsForPositionSimulation)
  const proposed: ProposedTrade[] = []
  const activeByDirection: Record<TradeDirection, { trade: ProposedTrade | null; position: number }> = {
    long: { trade: null, position: 0 },
    short: { trade: null, position: 0 },
  }

  for (const { row } of sorted) {
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

    const state = activeByDirection[direction]
    const entry = isEntry(row.type)
    const exit = isExit(row.type)
    const shouldEnter = entry || !exit

    if (shouldEnter) {
      if (!state.trade || state.position <= POSITION_EPS) {
        state.trade = {
          id: `group-${proposed.length + 1}`,
          direction,
          executions: [],
        }
        proposed.push(state.trade)
        state.position = 0
      }
      const action: Execution['action'] = state.position <= POSITION_EPS ? 'entry' : 'scale-in'
      state.trade.executions.push({ ...row, action })
      state.position += row.quantity
      continue
    }

    if (!state.trade || state.position <= POSITION_EPS) {
      const trade: ProposedTrade = {
        id: `group-${proposed.length + 1}`,
        direction,
        executions: [],
        warning: '检测到没有对应持仓的离场记录，请确认归组。',
      }
      trade.executions.push({ ...row, action: 'exit' })
      proposed.push(trade)
      continue
    }

    const action: Execution['action'] = row.quantity >= state.position - POSITION_EPS ? 'exit' : 'scale-out'
    state.trade.executions.push({ ...row, action })
    if (row.quantity > state.position + POSITION_EPS) {
      state.trade.warning = '检测到离场数量大于当前模拟持仓，请确认数量或归组。'
    }
    state.position = Math.max(0, state.position - row.quantity)
    if (state.position <= POSITION_EPS) state.trade = null
  }

  return proposed
}

export function groupRows(rows: RawImportRow[]): ProposedTrade[] {
  const indexedRows = rows.map((row, index) => ({ row, index }))
  const rowsWithTradeNo = indexedRows.filter(({ row }) => row.sourceTradeNo)
  if (indexedRows.length > 0 && rowsWithTradeNo.length === indexedRows.length) {
    return groupRowsBySourceTrades(indexedRows)
  }
  return groupRowsByNetPosition(indexedRows)
}
