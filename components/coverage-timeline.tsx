'use client'

import { Link } from 'react-router-dom'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtUtcDateTime } from '@/lib/format'
import type { TimeRange } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface TimelineMarker {
  tradeId: string
  seq: number
  time: number
  covered: boolean
}

export interface TimelineRow {
  key: string
  label: string
  sublabel: string
  covered: TimeRange[]
  gaps: TimeRange[]
  markers: TimelineMarker[]
  highlight?: TimeRange | null
  noData?: boolean
}

function pct(time: number, window: TimeRange): number {
  return ((time - window.start) / (window.end - window.start)) * 100
}

function fmtDayShort(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

export function CoverageTimeline({ rows, window }: { rows: TimelineRow[]; window: TimeRange }) {
  const ticks = Array.from({ length: 6 }, (_, index) => window.start + ((window.end - window.start) * index) / 5)

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
          <div className="flex flex-col">
            <span className="font-mono text-sm font-medium">{row.label}</span>
            <span className="text-xs text-muted-foreground">{row.sublabel}</span>
          </div>

          <div
            className="relative h-9 overflow-hidden rounded-md bg-muted/60"
            role="img"
            aria-label={`${row.label} ${row.sublabel} 数据覆盖情况`}
          >
            {row.covered.map((range, index) => (
              <div
                key={`c-${index}`}
                className="absolute inset-y-1 rounded-sm bg-primary/75"
                style={{
                  left: `${pct(range.start, window)}%`,
                  width: `${pct(range.end, window) - pct(range.start, window)}%`,
                }}
              />
            ))}

            {row.gaps.map((range, index) => (
              <Tooltip key={`g-${index}`}>
                <TooltipTrigger
                  render={
                    <div
                      className="absolute inset-y-1 rounded-sm bg-loss/15"
                      style={{
                        left: `${pct(range.start, window)}%`,
                        width: `${pct(range.end, window) - pct(range.start, window)}%`,
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, transparent, transparent 4px, color-mix(in oklch, var(--loss) 35%, transparent) 4px, color-mix(in oklch, var(--loss) 35%, transparent) 6px)',
                      }}
                    />
                  }
                />
                <TooltipContent>
                  缺口：{fmtUtcDateTime(range.start, false)} - {fmtUtcDateTime(range.end, false)}
                </TooltipContent>
              </Tooltip>
            ))}

            {row.highlight && (
              <div
                className="absolute inset-y-0.5 rounded-md border-2 border-warning"
                style={{
                  left: `${Math.max(0, pct(row.highlight.start, window))}%`,
                  width: `${Math.min(100, pct(row.highlight.end, window)) - Math.max(0, pct(row.highlight.start, window))}%`,
                }}
              />
            )}

            {row.markers.map((marker) => (
              <Tooltip key={marker.tradeId}>
                <TooltipTrigger
                  render={
                    <Link
                      to={`/trades/${marker.tradeId}`}
                      aria-label={`Trade #${marker.seq}${marker.covered ? '' : '（缺图表数据）'}`}
                      className={cn(
                        'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150',
                        marker.covered
                          ? 'bg-primary-foreground ring-2 ring-primary'
                          : 'bg-loss ring-2 ring-loss-foreground/80',
                      )}
                      style={{ left: `${pct(marker.time, window)}%` }}
                    />
                  }
                />
                <TooltipContent className="flex flex-col gap-0.5">
                  <span className="font-mono font-medium">Trade #{String(marker.seq).padStart(3, '0')}</span>
                  <span>{fmtUtcDateTime(marker.time)}</span>
                  {!marker.covered && <span className="font-medium text-loss">该时段缺图表数据</span>}
                </TooltipContent>
              </Tooltip>
            ))}

            {row.noData && (
              <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                无图表数据
              </span>
            )}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-[8.5rem_1fr] gap-3">
        <div />
        <div className="relative h-5">
          {ticks.map((tick, index) => (
            <span
              key={index}
              className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
              style={{ left: `${pct(tick, window)}%` }}
            >
              {fmtDayShort(tick)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm bg-primary/75" aria-hidden="true" />
        已覆盖
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-5 rounded-sm bg-loss/15"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent, transparent 3px, color-mix(in oklch, var(--loss) 35%, transparent) 3px, color-mix(in oklch, var(--loss) 35%, transparent) 5px)',
          }}
          aria-hidden="true"
        />
        缺口
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm bg-muted" aria-hidden="true" />
        范围外
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-primary-foreground ring-2 ring-primary" aria-hidden="true" />
        交易点
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-loss ring-2 ring-loss-foreground/80" aria-hidden="true" />
        缺数据交易
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-md border-2 border-warning" aria-hidden="true" />
        选中文件范围
      </span>
    </div>
  )
}

