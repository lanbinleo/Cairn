'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts'
import type { ChartBar, Trade } from '@/lib/types'

const palettes = {
  light: {
    text: '#78716c',
    grid: '#eeedec',
    up: '#0da678',
    down: '#e5484d',
    ema: '#e8a33d',
    sl: '#e5484d',
    tp: '#0da678',
  },
  dark: {
    text: '#a8a29e',
    grid: '#31302e',
    up: '#33cf9a',
    down: '#ff6b6e',
    ema: '#f0b859',
    sl: '#ff6b6e',
    tp: '#33cf9a',
  },
}

const toTs = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp

export function TradeChart({
  bars,
  trade,
  height = 480,
}: {
  bars: ChartBar[]
  trade: Trade
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const el = containerRef.current
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

    /* Execution 标记 */
    const execMarkers: SeriesMarker<UTCTimestamp>[] = [...trade.executions]
      .sort((a, b) => a.time - b.time)
      .map((e) => {
        const isBuy =
          (trade.direction === 'long' && (e.action === 'entry' || e.action === 'scale-in')) ||
          (trade.direction === 'short' && (e.action === 'exit' || e.action === 'scale-out'))
        const label =
          e.action === 'entry'
            ? '进场'
            : e.action === 'scale-in'
              ? '加仓'
              : e.action === 'scale-out'
                ? '减仓'
                : '离场'
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

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [bars, trade, height, resolvedTheme])

  if (bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        暂无图表数据，可在导入时附带 OHLC 数据文件
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" style={{ height }} />
}
