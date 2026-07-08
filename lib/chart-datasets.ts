import { chartTimeframeMinutes } from './chart-timeframes'
import type { ChartCandle, ChartImport, ChartTimeframe, TimeRange, Trade } from './types'

export interface ChartDataset {
  id: string
  symbolId: string
  timeframe: ChartTimeframe
  timeframeMin: number
  originalFile: string
  archivedFile: string
  sourcePath?: string
  startTime: number | null
  endTime: number | null
  rowCount: number
  insertedCount: number
  duplicateCount: number
  conflictCount: number
  hasEma20: boolean
  status: 'parsed' | 'error'
  error?: string
  importedAt: number
}

export interface CanonicalSummary {
  symbolId: string
  timeframe: ChartTimeframe
  timeframeMin: number
  merged: TimeRange[]
  canonicalBars: number
  totalRows: number
  duplicateRows: number
  gapCount: number
  datasetCount: number
}

export interface WindowOption {
  id: string
  label: string
  range: TimeRange
}

const DAY = 86_400_000

function sourceName(path?: string, fallback = '') {
  if (!path) return fallback
  return path.split(/[\\/]/).pop() || fallback
}

export function fmtTimeframe(min: number | null): string {
  if (min == null) return '-'
  if (min < 60) return `${min}m`
  if (min < 1440) return `${min / 60}h`
  return `${min / 1440}D`
}

export function deriveDatasets(imports: ChartImport[], candles: ChartCandle[]): ChartDataset[] {
  return imports.map((record) => {
    const importCandles = candles.filter((candle) => candle.importIds.includes(record.id))
    return {
      id: record.id,
      symbolId: record.symbolId,
      timeframe: record.timeframe,
      timeframeMin: chartTimeframeMinutes(record.timeframe),
      originalFile: record.fileName,
      archivedFile: sourceName(record.sourcePath, record.fileName),
      sourcePath: record.sourcePath,
      startTime: record.startTime ?? importCandles[0]?.time ?? null,
      endTime: record.endTime ?? importCandles[importCandles.length - 1]?.time ?? null,
      rowCount: record.rowCount,
      insertedCount: record.insertedCount,
      duplicateCount: record.duplicateCount,
      conflictCount: record.conflictCount,
      hasEma20: importCandles.some((candle) => candle.ema20 != null),
      status: record.status === 'parsed' ? 'parsed' : 'error',
      error: record.error,
      importedAt: record.createdAt,
    }
  })
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: TimeRange[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      out.push({ ...range })
    }
  }
  return out
}

export function interiorGaps(merged: TimeRange[], window: TimeRange): TimeRange[] {
  const gaps: TimeRange[] = []
  for (let index = 0; index < merged.length - 1; index += 1) {
    const start = Math.max(merged[index].end, window.start)
    const end = Math.min(merged[index + 1].start, window.end)
    if (start < end) gaps.push({ start, end })
  }
  return gaps
}

export function clipRanges(ranges: TimeRange[], window: TimeRange): TimeRange[] {
  return ranges
    .map((range) => ({ start: Math.max(range.start, window.start), end: Math.min(range.end, window.end) }))
    .filter((range) => range.start < range.end)
}

export function isCovered(time: number, merged: TimeRange[]): boolean {
  return merged.some((range) => time >= range.start && time < range.end)
}

export function computeCanonical(datasets: ChartDataset[]): CanonicalSummary[] {
  const groups = new Map<string, ChartDataset[]>()
  for (const dataset of datasets) {
    if (dataset.status !== 'parsed' || dataset.startTime == null || dataset.endTime == null) continue
    const key = `${dataset.symbolId}|${dataset.timeframe}`
    groups.set(key, [...(groups.get(key) ?? []), dataset])
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const [symbolId, timeframe] = key.split('|') as [string, ChartTimeframe]
      const timeframeMin = chartTimeframeMinutes(timeframe)
      const barMs = timeframeMin * 60_000
      const merged = mergeRanges(group.map((dataset) => ({ start: dataset.startTime!, end: dataset.endTime! + barMs })))
      const canonicalBars = merged.reduce((sum, range) => sum + Math.round((range.end - range.start) / barMs), 0)
      const totalRows = group.reduce((sum, dataset) => sum + dataset.rowCount, 0)
      const duplicateRows = group.reduce((sum, dataset) => sum + dataset.duplicateCount + dataset.conflictCount, 0)
      return {
        symbolId,
        timeframe,
        timeframeMin,
        merged,
        canonicalBars,
        totalRows,
        duplicateRows,
        gapCount: Math.max(0, merged.length - 1),
        datasetCount: group.length,
      }
    })
    .sort((a, b) => a.symbolId.localeCompare(b.symbolId) || a.timeframeMin - b.timeframeMin)
}

function startOfUtcMonth(time: number) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function addMonth(time: number) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

function monthId(time: number) {
  const date = new Date(time)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(id: string) {
  const [year, month] = id.split('-')
  return `${year}年${Number(month)}月`
}

export function buildWindowOptions(datasets: ChartDataset[], trades: Trade[]): WindowOption[] {
  const months = new Set<string>()
  const times: number[] = []

  for (const dataset of datasets) {
    if (dataset.startTime != null) {
      months.add(monthId(dataset.startTime))
      times.push(dataset.startTime)
    }
    if (dataset.endTime != null) {
      months.add(monthId(dataset.endTime))
      times.push(dataset.endTime)
    }
  }

  for (const trade of trades) {
    for (const execution of trade.executions) {
      months.add(monthId(execution.time))
      times.push(execution.time)
    }
  }

  if (times.length === 0) {
    const now = Date.now()
    const start = startOfUtcMonth(now)
    return [{ id: 'all', label: '全部时间', range: { start, end: addMonth(start) } }]
  }

  const monthOptions = [...months].sort().map((id) => {
    const [year, month] = id.split('-').map(Number)
    const start = Date.UTC(year, month - 1, 1)
    return { id, label: monthLabel(id), range: { start, end: addMonth(start) } }
  })
  const start = startOfUtcMonth(Math.min(...times))
  const end = addMonth(Math.max(...times))
  return [
    ...monthOptions,
    { id: 'all', label: '全部时间', range: { start, end: Math.max(end, start + DAY) } },
  ]
}

