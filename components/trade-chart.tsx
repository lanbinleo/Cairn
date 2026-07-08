'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  LineType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts'
import { executionActionLabel, hasPositionFill, isEntryExecution, isManagementExecutionAction } from '@/lib/executions'
import type { ChartBar, Trade } from '@/lib/types'

export type TradeChartOverlayStyle = 'zones' | 'lines' | 'both'

const palettes = {
  light: {
    text: '#78716c',
    grid: '#eeedec',
    up: '#0da678',
    down: '#e5484d',
    ema: '#e8a33d',
    sl: '#e5484d',
    tp: '#0da678',
    slZone: 'rgba(229, 72, 77, 0.16)',
    tpZone: 'rgba(13, 166, 120, 0.14)',
  },
  dark: {
    text: '#a8a29e',
    grid: '#31302e',
    up: '#33cf9a',
    down: '#ff6b6e',
    ema: '#f0b859',
    sl: '#ff6b6e',
    tp: '#33cf9a',
    slZone: 'rgba(255, 107, 110, 0.18)',
    tpZone: 'rgba(51, 207, 154, 0.14)',
  },
}

const toTs = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp

interface OverlayStage {
  start: number
  end: number
  anchorPrice: number
  stopPrice?: number
  targetPrice?: number
}

interface ManagementChange {
  time: number
  kind: 'stop' | 'target'
  price: number
  anchorPrice?: number
}

function inferOrderEditKind(orderType: string, signal?: string): 'stop' | 'target' | null {
  const text = `${orderType} ${signal ?? ''}`.toLowerCase()
  if (text.includes('target') || text.includes('take-profit') || /\btp\b/.test(text)) return 'target'
  if (text.includes('stop') || text.includes('sl') || text.includes('trailing')) return 'stop'
  return null
}

function buildManagementChanges(trade: Trade): ManagementChange[] {
  const executionChanges = trade.executions.flatMap((execution): ManagementChange[] => {
    if (!isManagementExecutionAction(execution.action) || execution.price == null) return []
    const kind =
      execution.action.startsWith('stop')
        ? 'stop'
        : execution.action.startsWith('target')
          ? 'target'
          : inferOrderEditKind(execution.orderType, execution.signal)
    if (!kind) return []
    return [{ time: execution.time, kind, price: execution.price, anchorPrice: execution.anchorPrice }]
  })

  const eventChanges = trade.events.flatMap((event): ManagementChange[] => {
    if (event.price == null) return []
    if (event.type.startsWith('sl')) return [{ time: event.time, kind: 'stop', price: event.price }]
    if (event.type.startsWith('tp')) return [{ time: event.time, kind: 'target', price: event.price }]
    return []
  })

  return [...executionChanges, ...eventChanges].sort((a, b) => a.time - b.time)
}

function buildOverlayStages(trade: Trade, bars: ChartBar[]): OverlayStage[] {
  const changes = buildManagementChanges(trade)
  const positionExecutions = trade.executions.filter(hasPositionFill).sort((a, b) => a.time - b.time)
  const tradeStart = positionExecutions[0]?.time ?? trade.executions[0]?.time ?? bars[0]?.time
  const tradeEnd = positionExecutions[positionExecutions.length - 1]?.time ?? trade.executions[trade.executions.length - 1]?.time ?? bars[bars.length - 1]?.time
  const defaultAnchor = positionExecutions.find(isEntryExecution)?.price ?? bars.find((bar) => Number.isFinite(bar.close))?.close
  if (tradeStart == null || tradeEnd == null || defaultAnchor == null) return []

  let anchorPrice = defaultAnchor
  let stopPrice = trade.initialStopLoss
  let targetPrice = trade.initialTakeProfit
  let stageStart = tradeStart
  const stages: OverlayStage[] = []

  function pushStage(end: number) {
    if (end <= stageStart) return
    if (stopPrice == null && targetPrice == null) return
    stages.push({ start: stageStart, end, anchorPrice, stopPrice, targetPrice })
  }

  for (const change of changes) {
    pushStage(change.time)
    if (change.anchorPrice != null) anchorPrice = change.anchorPrice
    if (change.kind === 'stop') stopPrice = change.price
    if (change.kind === 'target') targetPrice = change.price
    stageStart = change.time
  }

  pushStage(Math.max(tradeEnd, stageStart + 5 * 60_000))
  return stages
}

function steppedLineData(stages: OverlayStage[], key: 'stopPrice' | 'targetPrice') {
  const points: Array<{ time: UTCTimestamp; value: number }> = []
  for (const stage of stages) {
    const value = stage[key]
    if (value == null) continue
    points.push({ time: toTs(stage.start), value })
  }
  const last = [...stages].reverse().find((stage) => stage[key] != null)
  if (last && last[key] != null) points.push({ time: toTs(last.end), value: last[key] })
  return points.filter((point, index, list) => index === 0 || point.time !== list[index - 1].time)
}

function averageEntryPrice(trade: Trade) {
  let quantity = 0
  let cost = 0
  for (const execution of trade.executions.filter(hasPositionFill)) {
    if (!isEntryExecution(execution)) continue
    quantity += execution.quantity
    cost += execution.quantity * execution.price
  }
  return quantity > 0 ? cost / quantity : undefined
}

export function TradeChart({
  bars,
  trade,
  height = 480,
  overlayStyle = 'lines',
  showTrailLines = true,
  showEntryLine = true,
}: {
  bars: ChartBar[]
  trade: Trade
  height?: number
  overlayStyle?: TradeChartOverlayStyle
  showTrailLines?: boolean
  showEntryLine?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const wrapper = containerRef.current
    const el = chartContainerRef.current
    if (!el || bars.length === 0) return

    const p = resolvedTheme === 'dark' ? palettes.dark : palettes.light

    const chart = createChart(el, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: p.text,
        fontFamily: "'HarmonyOS Sans', 'HarmonyOS Sans SC', 'Harmony Sans OS', system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: p.grid },
        horzLines: { color: p.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    chartRef.current = chart

    /* K 线 */
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: p.up,
      downColor: p.down,
      borderUpColor: p.up,
      borderDownColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      priceLineVisible: false,
    })
    candles.setData(
      bars.map((b) => ({
        time: toTs(b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )

    /* EMA20 */
    const ema = chart.addSeries(LineSeries, {
      color: p.ema,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema.setData(
      bars
        .filter((b) => b.ema20 != null)
        .map((b) => ({ time: toTs(b.time), value: b.ema20 as number })),
    )

    const stages = buildOverlayStages(trade, bars)
    if (showTrailLines && stages.length > 0) {
      const stopData = steppedLineData(stages, 'stopPrice')
      if (stopData.length > 0) {
        const stopLine = chart.addSeries(LineSeries, {
          color: p.sl,
          lineWidth: 2,
          lineType: LineType.WithSteps,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        stopLine.setData(stopData)
      }

      const targetData = steppedLineData(stages, 'targetPrice')
      if (targetData.length > 0) {
        const targetLine = chart.addSeries(LineSeries, {
          color: p.tp,
          lineWidth: 2,
          lineType: LineType.WithSteps,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        targetLine.setData(targetData)
      }
    }

    if (showEntryLine) {
      const entryPrice = averageEntryPrice(trade)
      if (entryPrice != null) {
        candles.createPriceLine({
          price: entryPrice,
          color: p.text,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'Entry',
        })
      }
    }

    /* Execution 标记 */
    const execMarkers: SeriesMarker<UTCTimestamp>[] = [...trade.executions]
      .filter((execution) => execution.action !== 'undecided')
      .sort((a, b) => a.time - b.time)
      .map((e) => {
        if (!hasPositionFill(e)) {
          const isTarget = e.action.startsWith('target')
          if (e.price == null) {
            return {
              time: toTs(e.time),
              position: 'aboveBar' as const,
              shape: 'circle' as const,
              color: isTarget ? p.tp : p.sl,
              text: executionActionLabel[e.action],
              size: 0.7,
            }
          }
          return {
            time: toTs(e.time),
            position: 'atPriceMiddle' as const,
            price: e.price,
            shape: 'circle' as const,
            color: isTarget ? p.tp : p.sl,
            text: `${executionActionLabel[e.action]} ${e.price}`,
            size: 0.7,
          }
        }
        const isBuy = (trade.direction === 'long' && isEntryExecution(e)) || (trade.direction === 'short' && !isEntryExecution(e))
        const label = executionActionLabel[e.action] ?? e.action
        return {
          time: toTs(e.time),
          position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
          shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
          color: isBuy ? p.up : p.down,
          text: `${label} ${e.quantity}@${e.price}`,
        }
      })

    /* SL/TP 事件标记（圆点） */
    const eventMarkers: SeriesMarker<UTCTimestamp>[] = trade.events.map((ev) => ({
      time: toTs(ev.time),
      position: 'aboveBar' as const,
      shape: 'circle' as const,
      color: ev.type.startsWith('sl') ? p.sl : p.tp,
      text: ev.price == null
        ? (ev.note ?? 'Note')
        : ev.type.startsWith('sl') ? `SL->${ev.price}` : `TP->${ev.price}`,
      size: 0.6,
    }))

    createSeriesMarkers(
      candles,
      [...execMarkers, ...eventMarkers].sort((a, b) => (a.time as number) - (b.time as number)),
    )

    /* 初始止损价格线 */
    if (trade.initialStopLoss != null) {
      candles.createPriceLine({
        price: trade.initialStopLoss,
        color: p.sl,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '初始 SL',
      })
    }

    chart.timeScale().fitContent()

    function drawZones() {
      const canvas = overlayRef.current
      if (!canvas || !wrapper) return
      const rect = wrapper.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, height)
      if (overlayStyle === 'lines') return
      for (const stage of stages) {
        const x1 = chart.timeScale().timeToCoordinate(toTs(stage.start))
        const x2 = chart.timeScale().timeToCoordinate(toTs(stage.end))
        const yAnchor = candles.priceToCoordinate(stage.anchorPrice)
        if (x1 == null || x2 == null || yAnchor == null) continue
        const left = Math.min(x1, x2)
        const width = Math.max(1, Math.abs(x2 - x1))
        if (stage.stopPrice != null) {
          const yStop = candles.priceToCoordinate(stage.stopPrice)
          if (yStop != null) {
            ctx.fillStyle = p.slZone
            ctx.fillRect(left, Math.min(yAnchor, yStop), width, Math.abs(yStop - yAnchor))
          }
        }
        if (stage.targetPrice != null) {
          const yTarget = candles.priceToCoordinate(stage.targetPrice)
          if (yTarget != null) {
            ctx.fillStyle = p.tpZone
            ctx.fillRect(left, Math.min(yAnchor, yTarget), width, Math.abs(yTarget - yAnchor))
          }
        }
      }
    }

    drawZones()
    const handleVisibleRangeChange = () => drawZones()
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange)

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
      drawZones()
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange)
      chart.remove()
      chartRef.current = null
    }
  }, [bars, trade, height, resolvedTheme, overlayStyle, showTrailLines, showEntryLine])

  if (bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        没有当前 K 线数据
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
      <div ref={chartContainerRef} className="relative z-10 h-full w-full" />
    </div>
  )
}
