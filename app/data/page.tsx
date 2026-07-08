'use client'

import { useMemo, useState } from 'react'
import { Database, Download, FileWarning, Trash2 } from 'lucide-react'

import { CoverageTimeline, TimelineLegend, type TimelineRow } from '@/components/coverage-timeline'
import { ImportDatasetDialog } from '@/components/import-dataset-dialog'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  buildWindowOptions,
  clipRanges,
  computeCanonical,
  deriveDatasets,
  fmtTimeframe,
  interiorGaps,
  isCovered,
} from '@/lib/chart-datasets'
import { fmtUtcDateTime } from '@/lib/format'
import { useCairn } from '@/lib/store'
import type { ChartCandle, TimeRange, Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

const ALL = 'all'

function firstExecution(trade: Trade) {
  return [...trade.executions].sort((a, b) => a.time - b.time)[0]
}

function exportCanonicalCsv(label: string, candles: ChartCandle[], merged: TimeRange[]) {
  const rows = ['time,open,high,low,close,ema20']
  const included = candles
    .filter((candle) => isCovered(candle.time, merged))
    .sort((a, b) => a.time - b.time)

  for (const candle of included) {
    rows.push([
      Math.floor(candle.time / 1000),
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.ema20 ?? '',
    ].join(','))
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${label}_canonical.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function DataPage() {
  const { chartImports, chartCandles, trades, symbols, deleteChartImport } = useCairn()
  const [windowId, setWindowId] = useState(ALL)
  const [tfFilter, setTfFilter] = useState(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const datasets = useMemo(() => deriveDatasets(chartImports, chartCandles), [chartImports, chartCandles])
  const canonical = useMemo(() => computeCanonical(datasets), [datasets])
  const windowOptions = useMemo(() => buildWindowOptions(datasets, trades), [datasets, trades])
  const windowOption = windowOptions.find((option) => option.id === windowId) ?? windowOptions[0]
  const window = windowOption.range

  const symbolOf = (id: string) => symbols.find((symbol) => symbol.id === id)

  const rows = useMemo<TimelineRow[]>(() => {
    const selected = datasets.find((dataset) => dataset.id === selectedId)
    const out: TimelineRow[] = []

    for (const summary of canonical) {
      if (tfFilter !== ALL && String(summary.timeframeMin) !== tfFilter) continue

      const coveredInWindow = clipRanges(summary.merged, window)
      const symbolTrades = trades
        .map((trade) => ({ trade, execution: firstExecution(trade) }))
        .filter(
          ({ trade, execution }) =>
            trade.symbolId === summary.symbolId &&
            execution &&
            execution.time >= window.start &&
            execution.time < window.end,
        )

      if (coveredInWindow.length === 0 && symbolTrades.length === 0) continue

      const symbol = symbolOf(summary.symbolId)
      out.push({
        key: `${summary.symbolId}-${summary.timeframeMin}`,
        label: symbol?.code ?? summary.symbolId,
        sublabel: `${fmtTimeframe(summary.timeframeMin)} · ${summary.datasetCount} 个文件`,
        covered: coveredInWindow,
        gaps: interiorGaps(summary.merged, window),
        markers: symbolTrades.map(({ trade, execution }) => ({
          tradeId: trade.id,
          seq: trade.seq,
          time: execution!.time,
          covered: isCovered(execution!.time, summary.merged),
        })),
        highlight:
          selected &&
          selected.symbolId === summary.symbolId &&
          selected.timeframe === summary.timeframe &&
          selected.startTime != null &&
          selected.endTime != null
            ? {
                start: Math.max(selected.startTime, window.start),
                end: Math.min(selected.endTime, window.end),
              }
            : null,
      })
    }

    const canonicalKeys = new Set(canonical.map((summary) => `${summary.symbolId}|${summary.timeframeMin}`))
    const orphanSymbols = new Set(
      trades
        .map((trade) => ({ trade, execution: firstExecution(trade) }))
        .filter(
          ({ trade, execution }) =>
            execution &&
            execution.time >= window.start &&
            execution.time < window.end &&
            ![...canonicalKeys].some((key) => key.startsWith(`${trade.symbolId}|`)),
        )
        .map(({ trade }) => trade.symbolId),
    )

    if (tfFilter === ALL) {
      for (const symbolId of orphanSymbols) {
        const symbol = symbolOf(symbolId)
        const symbolTrades = trades
          .map((trade) => ({ trade, execution: firstExecution(trade) }))
          .filter(
            ({ trade, execution }) =>
              trade.symbolId === symbolId &&
              execution &&
              execution.time >= window.start &&
              execution.time < window.end,
          )
        out.push({
          key: `${symbolId}-none`,
          label: symbol?.code ?? symbolId,
          sublabel: '未导入任何数据',
          covered: [],
          gaps: [],
          noData: true,
          markers: symbolTrades.map(({ trade, execution }) => ({
            tradeId: trade.id,
            seq: trade.seq,
            time: execution!.time,
            covered: false,
          })),
        })
      }
    }

    return out
  }, [canonical, datasets, selectedId, tfFilter, trades, window])

  const parsedCount = datasets.filter((dataset) => dataset.status === 'parsed').length
  const errorCount = datasets.length - parsedCount
  const totalCanonicalBars = canonical.reduce((sum, summary) => sum + summary.canonicalBars, 0)
  const totalGaps = canonical.reduce((sum, summary) => sum + summary.gapCount, 0)
  const uncoveredTrades = useMemo(() => {
    let count = 0
    for (const trade of trades) {
      const execution = firstExecution(trade)
      if (!execution) continue
      const summaries = canonical.filter((summary) => summary.symbolId === trade.symbolId)
      if (!summaries.some((summary) => isCovered(execution.time, summary.merged))) count += 1
    }
    return count
  }, [canonical, trades])

  const timeframes = [...new Set(canonical.map((summary) => summary.timeframeMin))].sort((a, b) => a - b)
  const sortedDatasets = [...datasets].sort((a, b) => b.importedAt - a.importedAt)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="数据"
        description="图表数据的导入、覆盖度检查与规范化管理"
        actions={<ImportDatasetDialog />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="数据文件" value={`${datasets.length}`} sub={errorCount > 0 ? `${errorCount} 个解析失败` : '全部解析成功'} />
        <StatCard label="规范数据集" value={`${canonical.length}`} sub="品种 × 周期" />
        <StatCard label="规范 K 线" value={totalCanonicalBars.toLocaleString()} sub="去重合并后" />
        <StatCard
          label="缺口 / 缺数据交易"
          value={`${totalGaps} / ${uncoveredTrades}`}
          sub={uncoveredTrades > 0 ? '有交易缺少图表数据' : '交易均有数据支撑'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>覆盖度</CardTitle>
          <CardDescription>各品种×周期的数据覆盖情况；圆点为交易入场点，红点表示该时段缺少图表数据</CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Select value={windowOption.id} onValueChange={(value) => value && setWindowId(value)}>
              <SelectTrigger className="w-36" aria-label="时间窗口">
                <SelectValue>{windowOption.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {windowOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={tfFilter} onValueChange={(value) => value && setTfFilter(value)}>
              <SelectTrigger className="w-28" aria-label="周期筛选">
                <SelectValue>{tfFilter === ALL ? '全部周期' : fmtTimeframe(Number(tfFilter))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>全部周期</SelectItem>
                  {timeframes.map((timeframe) => (
                    <SelectItem key={timeframe} value={String(timeframe)}>
                      {fmtTimeframe(timeframe)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">该窗口内没有数据或交易</p>
          ) : (
            <CoverageTimeline rows={rows} window={window} />
          )}
          <TimelineLegend />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>数据文件</CardTitle>
          <CardDescription>每次导入的原始文件（已归档重命名）；点击行可在覆盖度图上定位其范围</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>归档文件</TableHead>
                <TableHead>品种</TableHead>
                <TableHead>周期</TableHead>
                <TableHead>时间范围（UTC）</TableHead>
                <TableHead className="text-right">行数</TableHead>
                <TableHead>EMA20</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-10" aria-label="操作" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedDatasets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    暂无导入记录
                  </TableCell>
                </TableRow>
              ) : (
                sortedDatasets.map((dataset) => {
                  const symbol = symbolOf(dataset.symbolId)
                  const selected = selectedId === dataset.id
                  return (
                    <TableRow
                      key={dataset.id}
                      data-state={selected ? 'selected' : undefined}
                      className={cn('cursor-pointer', selected && 'bg-accent/50')}
                      onClick={() => setSelectedId(selected ? null : dataset.id)}
                    >
                      <TableCell className="max-w-64">
                        <Tooltip>
                          <TooltipTrigger render={<span className="block truncate font-mono text-xs">{dataset.archivedFile}</span>} />
                          <TooltipContent>原始文件：{dataset.originalFile}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{symbol?.code ?? '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtTimeframe(dataset.timeframeMin)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {dataset.startTime != null && dataset.endTime != null
                          ? `${fmtUtcDateTime(dataset.startTime, false)} - ${fmtUtcDateTime(dataset.endTime, false)}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {dataset.rowCount > 0 ? dataset.rowCount.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {dataset.hasEma20 ? <Badge variant="secondary">有</Badge> : <span className="text-xs text-muted-foreground">无</span>}
                      </TableCell>
                      <TableCell>
                        {dataset.status === 'parsed' ? (
                          <Badge className="border-transparent bg-profit/12 text-profit">已解析</Badge>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge className="cursor-help border-transparent bg-loss/12 text-loss">
                                  <FileWarning className="size-3" aria-hidden="true" />
                                  解析失败
                                </Badge>
                              }
                            />
                            <TooltipContent className="max-w-64">{dataset.error}</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${dataset.archivedFile}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (selectedId === dataset.id) setSelectedId(null)
                            deleteChartImport(dataset.id)
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>规范数据</CardTitle>
          <CardDescription>同一品种×周期的所有文件合并去重后的完整数据，可导出为单个 CSV</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canonical.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">暂无规范数据。导入图表数据后会在这里汇总。</p>
          ) : (
            canonical.map((summary) => {
              const symbol = symbolOf(summary.symbolId)
              const label = `${symbol?.exchange ?? ''}_${symbol?.code.replace(/[^A-Za-z0-9]/g, '') ?? summary.symbolId}_${fmtTimeframe(summary.timeframeMin)}`
              const candles = chartCandles.filter(
                (candle) => candle.symbolId === summary.symbolId && candle.timeframe === summary.timeframe,
              )
              return (
                <div
                  key={`${summary.symbolId}-${summary.timeframeMin}`}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono text-sm font-medium">
                        {symbol?.code ?? summary.symbolId} · {fmtTimeframe(summary.timeframeMin)}
                      </span>
                      {summary.gapCount > 0 ? (
                        <Badge className="border-transparent bg-warning/15 text-warning-foreground">
                          {summary.gapCount} 个缺口
                        </Badge>
                      ) : (
                        <Badge className="border-transparent bg-profit/12 text-profit">连续完整</Badge>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
                      {summary.merged.map((range, index) => (
                        <span key={index}>
                          {fmtUtcDateTime(range.start, false)} - {fmtUtcDateTime(range.end, false)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-sm tabular-nums">{summary.canonicalBars.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">规范 K 线</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-sm tabular-nums">{summary.duplicateRows.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">重复 / 冲突</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => exportCanonicalCsv(label, candles, summary.merged)}>
                      <Download data-icon="inline-start" />
                      导出
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

