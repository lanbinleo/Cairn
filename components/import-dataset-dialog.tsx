'use client'

import { useMemo, useRef, useState } from 'react'
import { FileCheck2, FileWarning, Upload } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CHART_TIMEFRAMES, chartTimeframeLabel, chartTimeframeMinutes } from '@/lib/chart-timeframes'
import { fmtUtcDateTime } from '@/lib/format'
import { saveChartSourceFile } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import { parseChartBars } from '@/lib/tradingview-import'
import type { ChartBar, ChartCandle, ChartImport, ChartTimeframe, TradingSymbol } from '@/lib/types'

interface ParsedFile {
  file: File
  bars: ChartBar[]
  detectedIntervalMs?: number
}

function detectIntervalMs(bars: ChartBar[]) {
  const diffs = bars.slice(1).map((bar, index) => bar.time - bars[index].time).filter((diff) => diff > 0)
  if (diffs.length === 0) return undefined
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

function timeframeFromInterval(intervalMs?: number): ChartTimeframe | null {
  if (!intervalMs) return null
  const minutes = Math.round(intervalMs / 60_000)
  return CHART_TIMEFRAMES.find((item) => item.minutes === minutes)?.value ?? null
}

function sameCandle(a: ChartCandle, b: ChartBar) {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && (a.ema20 ?? null) === (b.ema20 ?? null)
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

function utcStamp(value?: number) {
  return value == null ? 'unknown' : new Date(value).toISOString().replace(/[:.]/g, '-')
}

function suggestSymbol(fileName: string, symbols: TradingSymbol[]) {
  const normalized = fileName.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return symbols.find((symbol) => normalized.includes(symbol.code.toUpperCase().replace(/[^A-Z0-9]/g, '')))
}

function archivedName(file: File, symbol: TradingSymbol, timeframe: ChartTimeframe, startTime?: number, endTime?: number) {
  const stamp = (time?: number) => {
    if (time == null) return 'unknown'
    const date = new Date(time)
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  }
  const code = symbol.code.replace(/[^A-Za-z0-9]/g, '')
  const ext = file.name.split('.').pop() || 'csv'
  return `${symbol.exchange}_${code}_${timeframe}_${stamp(startTime)}-${stamp(endTime)}.${ext}`
}

export function ImportDatasetDialog() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { symbols, chartCandles, createChartImport } = useCairn()
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [symbolId, setSymbolId] = useState('')
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('5m')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const symbol = symbols.find((item) => item.id === symbolId)
  const startTime = parsed?.bars[0]?.time
  const endTime = parsed?.bars[parsed.bars.length - 1]?.time
  const hasEma20 = parsed?.bars.some((bar) => bar.ema20 != null) ?? false
  const archivePreview = parsed && symbol ? archivedName(parsed.file, symbol, timeframe, startTime, endTime) : ''

  const detectedLabel = useMemo(() => {
    const detected = timeframeFromInterval(parsed?.detectedIntervalMs)
    return detected ? chartTimeframeLabel(detected) : '未识别'
  }, [parsed?.detectedIntervalMs])

  function reset() {
    setParsed(null)
    setSymbolId('')
    setTimeframe('5m')
    setBusy(false)
    setError('')
  }

  async function handleFile(file?: File) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const bars = await parseChartBars(file)
      if (bars.length === 0) throw new Error('未解析到 OHLC 数据')
      const detectedIntervalMs = detectIntervalMs(bars)
      const detectedTimeframe = timeframeFromInterval(detectedIntervalMs)
      const suggested = suggestSymbol(file.name, symbols)
      setParsed({ file, bars, detectedIntervalMs })
      setTimeframe(detectedTimeframe ?? '5m')
      setSymbolId(suggested?.id ?? symbols[0]?.id ?? '')
    } catch (err) {
      setParsed(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!parsed || !symbol) return
    const importId = `chart-import-${Date.now().toString(36)}`
    setBusy(true)
    setError('')
    try {
      const existingById = new Map(chartCandles.map((item) => [item.id, item]))
      let duplicateCount = 0
      let conflictCount = 0
      const inserted: ChartCandle[] = []

      for (const bar of parsed.bars) {
        const id = `${symbol.id}:${timeframe}:${bar.time}`
        const existing = existingById.get(id)
        if (existing) {
          if (sameCandle(existing, bar)) duplicateCount += 1
          else conflictCount += 1
          continue
        }
        inserted.push({ ...bar, id, symbolId: symbol.id, timeframe, importIds: [importId] })
      }

      const sourcePath = await saveChartSourceFile({
        fileName: parsed.file.name,
        contentBase64: await toBase64(parsed.file),
        symbolLabel: `${symbol.exchange}-${symbol.code}`,
        timeframe,
        startUtc: utcStamp(startTime),
        endUtc: utcStamp(endTime),
      })

      const record: ChartImport = {
        id: importId,
        symbolId: symbol.id,
        timeframe,
        fileName: parsed.file.name,
        sourcePath,
        status: 'parsed',
        rowCount: parsed.bars.length,
        insertedCount: inserted.length,
        duplicateCount,
        conflictCount,
        startTime,
        endTime,
        detectedIntervalMs: parsed.detectedIntervalMs,
        createdAt: Date.now(),
      }
      createChartImport(record, inserted)
      setOpen(false)
      reset()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      createChartImport({
        id: importId,
        symbolId: symbol.id,
        timeframe,
        fileName: parsed.file.name,
        status: 'failed',
        rowCount: 0,
        insertedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        error: message,
        createdAt: Date.now(),
      }, [])
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger render={<Button />}>
        <Upload data-icon="inline-start" />
        导入图表数据
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入图表数据</DialogTitle>
          <DialogDescription>
            单独导入 TradingView 导出的 OHLC CSV，无需关联交易记录。周期与时间范围将自动识别。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">CSV 文件</span>
            <Button variant="outline" className="justify-start" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Upload data-icon="inline-start" />
              {parsed ? parsed.file.name : '选择文件'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-loss/30 bg-loss/10 p-3 text-sm text-loss">
              <FileWarning className="mt-0.5 size-4" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {parsed && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <FileCheck2 className="size-4 text-profit" aria-hidden="true" />
                解析成功
                <Badge variant="secondary" className="font-mono">
                  {detectedLabel}
                </Badge>
                <Badge variant="secondary" className="font-mono">
                  {parsed.bars.length.toLocaleString()} 行
                </Badge>
                {hasEma20 && <Badge variant="secondary">EMA20</Badge>}
              </div>
              <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                <span>起：{startTime ? fmtUtcDateTime(startTime) : '-'}</span>
                <span>止：{endTime ? fmtUtcDateTime(endTime) : '-'}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">归属品种</span>
                <Select value={symbolId} onValueChange={(value) => setSymbolId(value ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择品种" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {symbols.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.exchange}:{item.code}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">周期</span>
                <Select value={timeframe} onValueChange={(value) => setTimeframe(value as ChartTimeframe)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CHART_TIMEFRAMES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <span className="text-xs text-muted-foreground">
                归档名：{archivePreview ? <span className="font-mono">{archivePreview}</span> : '-'}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={confirm} disabled={!parsed || !symbol || busy || chartTimeframeMinutes(timeframe) <= 0}>
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

