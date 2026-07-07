'use client'

import { useMemo, useRef, useState } from 'react'
import { Database, Download, Upload } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CHART_TIMEFRAMES, chartTimeframeMinutes, chartTimeframeLabel } from '@/lib/chart-timeframes'
import { fmtUtcDateTime } from '@/lib/format'
import { saveChartSourceFile } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import { parseChartBars } from '@/lib/tradingview-import'
import type { ChartBar, ChartCandle, ChartImport, ChartTimeframe } from '@/lib/types'
import { cn } from '@/lib/utils'

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(value: string) {
  const [year, month] = value.split('-').map(Number)
  const start = Date.UTC(year, month - 1, 1)
  const end = Date.UTC(year, month, 1) - 1
  return { start, end }
}

function utcDate(value: number) {
  return new Date(value).toISOString().slice(0, 10)
}

function utcStamp(value?: number) {
  return value == null ? 'unknown' : new Date(value).toISOString().replace(/[:.]/g, '-')
}

function sameCandle(a: ChartCandle, b: ChartBar) {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && (a.ema20 ?? null) === (b.ema20 ?? null)
}

function detectIntervalMs(bars: ChartBar[]) {
  const diffs = bars.slice(1).map((bar, index) => bar.time - bars[index].time).filter((diff) => diff > 0)
  if (diffs.length === 0) return undefined
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function coverageSegments(candles: ChartCandle[], intervalMs: number) {
  if (candles.length === 0) return []
  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const segments: Array<{ start: number; end: number; count: number }> = []
  let current = { start: sorted[0].time, end: sorted[0].time, count: 1 }
  for (const candle of sorted.slice(1)) {
    if (candle.time - current.end <= intervalMs * 1.5) {
      current.end = candle.time
      current.count += 1
    } else {
      segments.push(current)
      current = { start: candle.time, end: candle.time, count: 1 }
    }
  }
  segments.push(current)
  return segments
}

function missingSegments(candles: ChartCandle[], start: number, end: number, intervalMs: number) {
  const times = new Set(candles.map((item) => item.time))
  const missing: Array<{ start: number; end: number; count: number }> = []
  let current: { start: number; end: number; count: number } | null = null
  const alignedStart = Math.ceil(start / intervalMs) * intervalMs
  for (let time = alignedStart; time <= end; time += intervalMs) {
    if (times.has(time)) {
      if (current) missing.push(current)
      current = null
      continue
    }
    if (!current) current = { start: time, end: time, count: 1 }
    else {
      current.end = time
      current.count += 1
    }
  }
  if (current) missing.push(current)
  return missing
}

export default function DataPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { symbols, trades, chartImports, chartCandles, createChartImport, symbolLabel } = useCairn()
  const [symbolId, setSymbolId] = useState(symbols[0]?.id ?? '')
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('5m')
  const [month, setMonth] = useState(monthValue())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const range = monthRange(month)
  const intervalMs = chartTimeframeMinutes(timeframe) * 60_000
  const selectedCandles = chartCandles.filter((item) => item.symbolId === symbolId && item.timeframe === timeframe)
  const monthCandles = selectedCandles.filter((item) => item.time >= range.start && item.time <= range.end)
  const segments = coverageSegments(monthCandles, intervalMs)
  const gaps = missingSegments(monthCandles, range.start, range.end, intervalMs)
  const selectedSymbol = symbols.find((item) => item.id === symbolId)
  const monthDays = useMemo(() => {
    const days: Array<{ date: string; pct: number; count: number }> = []
    const byDay = new Map<string, number>()
    for (const candle of monthCandles) {
      const key = utcDate(candle.time)
      byDay.set(key, (byDay.get(key) ?? 0) + 1)
    }
    for (let day = range.start; day <= range.end; day += 24 * 60 * 60_000) {
      const date = utcDate(day)
      const expected = Math.round((24 * 60) / chartTimeframeMinutes(timeframe))
      const count = byDay.get(date) ?? 0
      days.push({ date, count, pct: Math.min(1, count / expected) })
    }
    return days
  }, [monthCandles, range.start, range.end, timeframe])

  const tradeCoverage = trades
    .filter((trade) => trade.symbolId === symbolId)
    .map((trade) => {
      const times = trade.executions.map((execution) => execution.time)
      const start = Math.min(...times)
      const end = Math.max(...times)
      const padding = intervalMs * 80
      const covered = selectedCandles.some((candle) => candle.time >= start - padding && candle.time <= end + padding)
      return { trade, start, end, covered }
    })
    .filter((item) => item.start <= range.end && item.end >= range.start)

  async function handleImport(file?: File) {
    if (!file || !symbolId) return
    setBusy(true)
    setMessage('')
    const importId = `chart-import-${Date.now().toString(36)}`
    try {
      const bars = await parseChartBars(file)
      if (bars.length === 0) throw new Error('未解析到 OHLC 数据')
      const detectedIntervalMs = detectIntervalMs(bars)
      const startTime = bars[0].time
      const endTime = bars[bars.length - 1].time
      const existingById = new Map(chartCandles.map((item) => [item.id, item]))
      let duplicateCount = 0
      let conflictCount = 0
      const inserted: ChartCandle[] = []

      for (const bar of bars) {
        const id = `${symbolId}:${timeframe}:${bar.time}`
        const existing = existingById.get(id)
        if (existing) {
          if (sameCandle(existing, bar)) duplicateCount += 1
          else conflictCount += 1
          continue
        }
        inserted.push({ ...bar, id, symbolId, timeframe, importIds: [importId] })
      }

      const sourcePath = await saveChartSourceFile({
        fileName: file.name,
        contentBase64: await toBase64(file),
        symbolLabel: selectedSymbol ? `${selectedSymbol.exchange}-${selectedSymbol.code}` : symbolId,
        timeframe,
        startUtc: utcStamp(startTime),
        endUtc: utcStamp(endTime),
      })

      const record: ChartImport = {
        id: importId,
        symbolId,
        timeframe,
        fileName: file.name,
        sourcePath,
        status: 'parsed',
        rowCount: bars.length,
        insertedCount: inserted.length,
        duplicateCount,
        conflictCount,
        startTime,
        endTime,
        detectedIntervalMs,
        createdAt: Date.now(),
      }
      createChartImport(record, inserted)
      setMessage(`已导入 ${inserted.length} 根，重复 ${duplicateCount} 根，冲突 ${conflictCount} 根。`)
    } catch (error) {
      const record: ChartImport = {
        id: importId,
        symbolId,
        timeframe,
        fileName: file.name,
        status: 'failed',
        rowCount: 0,
        insertedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        error: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
      }
      createChartImport(record, [])
      setMessage(record.error ?? '导入失败')
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    const rows = ['time,open,high,low,close,EMA']
    for (const candle of selectedCandles) {
      rows.push([Math.floor(candle.time / 1000), candle.open, candle.high, candle.low, candle.close, candle.ema20 ?? ''].join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${symbolLabel(symbolId).replace(/[:/\\]/g, '-')}-${timeframe}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="数据"
        description="管理独立导入的图表数据、覆盖范围和缺口"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={selectedCandles.length === 0}>
              <Download data-icon="inline-start" />
              导出
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={!symbolId || busy}>
              <Upload data-icon="inline-start" />
              导入图表数据
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 py-4 md:grid-cols-3">
          <Field>
            <FieldLabel>Symbol</FieldLabel>
            <Select value={symbolId} onValueChange={(value) => { if (value) setSymbolId(value) }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择品种" />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((symbol) => (
                  <SelectItem key={symbol.id} value={symbol.id}>
                    {symbol.exchange}:{symbol.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>周期</FieldLabel>
            <Select value={timeframe} onValueChange={(value) => setTimeframe(value as ChartTimeframe)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TIMEFRAMES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>月份</FieldLabel>
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Field>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              void handleImport(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </CardContent>
      </Card>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">覆盖日历</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date} · ${day.count} 根`}
                  className={cn(
                    'flex h-12 flex-col justify-between rounded-md border p-1 text-[10px]',
                    day.pct >= 0.98 ? 'border-profit/30 bg-profit/15' : day.pct > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-loss/30 bg-loss/10',
                  )}
                >
                  <span>{day.date.slice(8)}</span>
                  <span className="font-mono">{Math.round(day.pct * 100)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">摘要</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">总 K 线</span><span className="font-mono">{selectedCandles.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">本月 K 线</span><span className="font-mono">{monthCandles.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">已有区间</span><span className="font-mono">{segments.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">缺失区间</span><span className="font-mono">{gaps.length}</span></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">已有区间</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {segments.length === 0 ? <p className="text-sm text-muted-foreground">暂无数据</p> : segments.slice(0, 12).map((segment, index) => (
              <div key={index} className="rounded-md border bg-profit/10 px-3 py-2 text-sm">
                {fmtUtcDateTime(segment.start, false)} - {fmtUtcDateTime(segment.end, false)}
                <span className="ml-2 text-xs text-muted-foreground">{segment.count} 根</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">缺失区间</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {gaps.length === 0 ? <p className="text-sm text-muted-foreground">当前月份没有缺口</p> : gaps.slice(0, 12).map((gap, index) => (
              <div key={index} className="rounded-md border bg-loss/10 px-3 py-2 text-sm">
                {fmtUtcDateTime(gap.start, false)} - {fmtUtcDateTime(gap.end, false)}
                <span className="ml-2 text-xs text-muted-foreground">缺 {gap.count} 根</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">交易覆盖检查</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {tradeCoverage.length === 0 ? <p className="text-sm text-muted-foreground">当前月份没有相关交易</p> : tradeCoverage.map(({ trade, start, end, covered }) => (
            <div key={trade.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">Trade #{String(trade.seq).padStart(3, '0')}</span>
                <span className="text-xs text-muted-foreground">{fmtUtcDateTime(start, false)} - {fmtUtcDateTime(end, false)}</span>
              </div>
              <Badge variant={covered ? 'secondary' : 'destructive'}>{covered ? '有数据' : '缺数据'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">导入记录</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {chartImports.length === 0 ? <p className="text-sm text-muted-foreground">暂无导入记录</p> : chartImports.map((record) => (
            <div key={record.id} className="grid grid-cols-1 gap-2 rounded-md border px-3 py-2 text-sm md:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{record.fileName}</span>
                  <Badge variant={record.status === 'parsed' ? 'secondary' : 'destructive'}>{record.status}</Badge>
                  <span className="text-xs text-muted-foreground">{chartTimeframeLabel(record.timeframe)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {record.startTime ? fmtUtcDateTime(record.startTime, false) : 'unknown'} - {record.endTime ? fmtUtcDateTime(record.endTime, false) : 'unknown'}
                </span>
                {record.sourcePath && <span className="font-mono text-xs text-muted-foreground">{record.sourcePath}</span>}
                {record.error && <span className="text-xs text-loss">{record.error}</span>}
              </div>
              <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>rows {record.rowCount}</span>
                <span>new {record.insertedCount}</span>
                <span>dup {record.duplicateCount}</span>
                <span>conflict {record.conflictCount}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
