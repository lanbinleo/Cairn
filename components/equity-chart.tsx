'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Activity } from 'lucide-react'
import { createChart, AreaSeries, BaselineSeries, LineSeries, LineType, type IChartApi, type UTCTimestamp } from 'lightweight-charts'

import { Button } from '@/components/ui/button'
import { computeEquityMaByDays, computeEquityMaByTrades } from '@/lib/metrics'
import type { EquityPoint } from '@/lib/types'

const palettes = {
  light: {
    text: '#78716c',
    grid: '#eeedec',
    line: '#3b6ef5',
    top: 'rgba(59, 110, 245, 0.16)',
    bottom: 'rgba(59, 110, 245, 0.01)',
    above: 'rgb(37, 99, 235)',
    aboveFill: 'rgba(37, 99, 235, 0.2)',
    below: 'rgb(250, 204, 21)',
    belowFill: 'rgba(250, 204, 21, 0.22)',
  },
  dark: {
    text: '#a8a29e',
    grid: '#31302e',
    line: '#6b96ff',
    top: 'rgba(107, 150, 255, 0.2)',
    bottom: 'rgba(107, 150, 255, 0.02)',
    above: 'rgb(122, 162, 255)',
    aboveFill: 'rgba(122, 162, 255, 0.24)',
    below: 'rgb(250, 204, 21)',
    belowFill: 'rgba(250, 204, 21, 0.22)',
  },
}

/** 均线开关循环：关 → 按笔数 → 按天数 */
type MaMode = 'off' | 'trades' | 'days'
const MA_TRADES_N = 20
const MA_DAYS_N = 30
const MA_LABEL: Record<MaMode, string> = { off: '关', trades: `${MA_TRADES_N} 笔`, days: `${MA_DAYS_N} 天` }

export function EquityChart({ points, height = 260, baseline }: { points: EquityPoint[]; height?: number; baseline?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const { resolvedTheme } = useTheme()
  const [maMode, setMaMode] = useState<MaMode>('off')

  const maData = useMemo(
    () =>
      maMode === 'trades' ? computeEquityMaByTrades(points, MA_TRADES_N)
        : maMode === 'days' ? computeEquityMaByDays(points, MA_DAYS_N)
          : [],
    [maMode, points],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || points.length === 0) return

    const p = resolvedTheme === 'dark' ? palettes.dark : palettes.light

    const chart = createChart(el, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: p.text,
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: p.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScroll: false,
      handleScale: false,
      crosshair: {
        horzLine: { visible: false },
        vertLine: { width: 1 },
      },
    })
    chartRef.current = chart

    const series = baseline == null
      ? chart.addSeries(AreaSeries, {
          lineColor: p.line,
          lineWidth: 2,
          lineType: LineType.Curved,
          topColor: p.top,
          bottomColor: p.bottom,
          priceLineVisible: false,
          lastValueVisible: true,
        })
      : chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: baseline },
          topLineColor: p.above,
          topFillColor1: p.aboveFill,
          topFillColor2: 'rgba(0, 0, 0, 0)',
          bottomLineColor: p.below,
          bottomFillColor1: p.belowFill,
          bottomFillColor2: 'rgba(0, 0, 0, 0)',
          lineWidth: 2,
          lineType: LineType.Curved,
          priceLineVisible: false,
          lastValueVisible: true,
        })
    const dataBySecond = new Map<number, number>()
    for (const pt of points) {
      dataBySecond.set(Math.floor(pt.time / 1000), pt.equity)
    }
    series.setData(
      [...dataBySecond.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
    )
    if (maData.length > 0) {
      const ma = chart.addSeries(LineSeries, {
        color: resolvedTheme === 'dark' ? '#d4a72c' : '#b45309',
        lineWidth: 1,
        lineType: LineType.Simple,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      const maBySecond = new Map<number, number>()
      for (const pt of maData) {
        maBySecond.set(Math.floor(pt.time / 1000), pt.value)
      }
      ma.setData(
        [...maBySecond.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
      )
    }
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
      chart.timeScale().fitContent()
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [points, height, baseline, resolvedTheme, maData])

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        暂无已平仓交易，无法绘制资金曲线
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setMaMode((prev) => (prev === 'off' ? 'trades' : prev === 'trades' ? 'days' : 'off'))}
        >
          <Activity className="size-3" />
          均线：{MA_LABEL[maMode]}
        </Button>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  )
}
