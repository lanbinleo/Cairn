'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createChart, AreaSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import type { EquityPoint } from '@/lib/types'

const palettes = {
  light: {
    text: '#78716c',
    grid: '#eeedec',
    line: '#3b6ef5',
    top: 'rgba(59, 110, 245, 0.16)',
    bottom: 'rgba(59, 110, 245, 0.01)',
  },
  dark: {
    text: '#a8a29e',
    grid: '#31302e',
    line: '#6b96ff',
    top: 'rgba(107, 150, 255, 0.2)',
    bottom: 'rgba(107, 150, 255, 0.02)',
  },
}

export function EquityChart({ points, height = 260 }: { points: EquityPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const { resolvedTheme } = useTheme()

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

    const series = chart.addSeries(AreaSeries, {
      lineColor: p.line,
      lineWidth: 2,
      lineType: 2, // Curved：平滑曲线而非折线
      topColor: p.top,
      bottomColor: p.bottom,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    series.setData(
      points.map((pt) => ({ time: Math.floor(pt.time / 1000) as UTCTimestamp, value: pt.equity })),
    )
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
  }, [points, height, resolvedTheme])

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

  return <div ref={containerRef} className="w-full" style={{ height }} />
}
