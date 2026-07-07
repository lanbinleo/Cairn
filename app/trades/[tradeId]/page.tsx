'use client'

import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Clipboard, Copy, ImagePlus, NotebookPen, RotateCcw, Trash2 } from 'lucide-react'

import { TradeChart } from '@/components/trade-chart'
import { PnlText, RText } from '@/components/pnl-text'
import { DirectionBadge, StatusBadge } from '@/components/trades-table'
import { EditTradeDialog } from '@/components/edit-trade-dialog'
import { TagBadge } from '@/components/tag-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useCairn } from '@/lib/store'
import { computeTradeMetrics } from '@/lib/metrics'
import { fmtPrice, fmtDuration, fmtUtcDateTime, fmtUtcDate } from '@/lib/format'
import { timeToBarIndex } from '@/lib/bar-time'
import { readFileAsDataUrl } from '@/lib/tradingview-import'
import { CHART_TIMEFRAMES, chartTimeframeLabel } from '@/lib/chart-timeframes'
import type { ChartTimeframe } from '@/lib/types'

const actionLabel: Record<string, string> = {
  entry: '进场',
  'scale-in': '加仓',
  'scale-out': '减仓',
  exit: '离场',
}

const orderTypeLabel: Record<string, string> = {
  market: '市价',
  limit: '限价',
  stop: '停损单（Stop）',
  'stop-limit': '止损限价',
  'stop-loss': '止损',
  'take-profit': '止盈',
  'trailing-stop': '移动止损离场',
}

const eventLabel: Record<string, string> = {
  'sl-set': '设置止损',
  'sl-moved': '移动止损',
  'tp-set': '设置止盈',
  'tp-moved': '移动止盈',
  note: '标记',
}

export default function TradeDetailPage() {
  const navigate = useNavigate()
  const { tradeId = '' } = useParams()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [imageEditIndex, setImageEditIndex] = useState<number | null>(null)
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('5m')
  const { getTrade, getAccount, getPeriod, getSymbol, getNotesMentioningTrade, symbolLabel, setTradeStatus, updateTrade, createNote } = useCairn()
  const trade = getTrade(tradeId)
  if (!trade) return <Navigate to="/trades" replace />
  const activeTrade = trade

  const account = getAccount(trade.accountId)
  const period = getPeriod(trade.periodId)
  const symbol = getSymbol(trade.symbolId)
  const m = computeTradeMetrics(trade)
  const bars = trade.chartData?.[chartTimeframe] ?? (chartTimeframe === '5m' ? trade.chartBars : undefined) ?? []
  const mentioningNotes = getNotesMentioningTrade(trade.id)

  function createLinkedNote() {
    const note = createNote({
      title: `Trade #${String(activeTrade.seq).padStart(3, '0')}`,
      content: `[[trade:${activeTrade.id}]]\n`,
      tags: [],
      mentions: [{ type: 'trade', ref: activeTrade.id }],
    })
    navigate(`/notes/${note.id}/edit`)
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text)
  }

  async function handleImageSelected(file?: File) {
    if (!file) return
    const dataUrl = await readFileAsDataUrl(file)
    const next = [...activeTrade.referenceImages]
    if (imageEditIndex == null) {
      next.push(dataUrl)
    } else {
      next[imageEditIndex] = dataUrl
    }
    updateTrade(activeTrade.id, { referenceImages: next })
    setImageEditIndex(null)
  }

  const timeline = [
    ...trade.executions.map((e) => ({
      kind: 'exec' as const,
      time: e.time,
      title: `${actionLabel[e.action]} ${e.quantity} @ ${fmtPrice(e.price, symbol?.pricePrecision)}`,
      detail: `${orderTypeLabel[e.orderType]}${e.signal ? ` · 信号 ${e.signal}` : ''}`,
      tone: e.action === 'entry' || e.action === 'scale-in' ? 'entry' : 'exit',
    })),
    ...trade.events.map((ev) => ({
      kind: 'event' as const,
      time: ev.time,
      title: ev.price == null ? eventLabel[ev.type] : `${eventLabel[ev.type]} -> ${fmtPrice(ev.price, symbol?.pricePrecision)}`,
      detail: ev.note ?? '',
      tone: ev.type.startsWith('sl') ? 'sl' : 'tp',
    })),
  ].sort((a, b) => a.time - b.time)

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="面包屑">
            <Link to="/trades" className="transition-colors hover:text-foreground">
              交易
            </Link>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="text-foreground">#{trade.seq}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              Trade <span className="text-primary">#{String(trade.seq).padStart(3, '0')}</span>
            </h1>
            <span className="font-mono text-lg text-muted-foreground">{symbolLabel(trade.symbolId)}</span>
            <DirectionBadge direction={trade.direction} />
            <StatusBadge status={trade.status} />
          </div>
          {trade.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {trade.tags.map((tag) => (
                <TagBadge key={tag} name={tag} />
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {account?.name} · {period?.name} · {fmtUtcDate(m.entryTime)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => copyText(trade.id)}>
            <Clipboard data-icon="inline-start" />
            复制 ID
          </Button>
          <Button variant="outline" onClick={createLinkedNote}>
            <NotebookPen data-icon="inline-start" />
            新建笔记
          </Button>
          {trade.status === 'open' ? (
            <Button variant="outline" onClick={() => setTradeStatus(trade.id, 'closed')}>
              <CheckCircle2 data-icon="inline-start" />
              标记为已平仓
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setTradeStatus(trade.id, 'open')}
            >
              <RotateCcw data-icon="inline-start" />
              重新打开
            </Button>
          )}
          <EditTradeDialog trade={trade} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        {/* 主区：K 线图 + 时间线 */}
        <div className="flex flex-col gap-6 xl:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">复盘图表</CardTitle>
                <div className="flex flex-wrap items-center gap-1">
                  {CHART_TIMEFRAMES.map((item) => (
                    <Button
                      key={item.value}
                      variant={chartTimeframe === item.value ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setChartTimeframe(item.value)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TradeChart bars={bars} trade={trade} />
              <p className="mt-2 text-xs text-muted-foreground">
                {chartTimeframeLabel(chartTimeframe)} · UTC · EMA · 箭头为 Execution，圆点为 SL/TP 变动，虚线为初始止损
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">操作时间线</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col">
                {timeline.map((item, i) => (
                  <li key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span
                        className={
                          item.kind === 'exec'
                            ? item.tone === 'entry'
                              ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-profit'
                              : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-loss'
                            : 'mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-muted-foreground bg-background'
                        }
                        aria-hidden="true"
                      />
                      {i < timeline.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
                    </div>
                    <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4 pb-5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{item.title}</span>
                        {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          {fmtUtcDateTime(item.time, false)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground/70">
                          Bar #{timeToBarIndex(item.time, 5)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">配图区</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setImageEditIndex(null)
                    imageInputRef.current?.click()
                  }}
                >
                  <ImagePlus data-icon="inline-start" />
                  添加图片
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {trade.referenceImages.length === 0 ? (
                <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  暂无配图
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {trade.referenceImages.map((src, i) => (
                    <figure key={src + i} className="overflow-hidden rounded-lg border">
                      <img
                        src={src || "/placeholder.svg"}
                        alt={`交易 #${trade.seq} 配图 ${i + 1}`}
                        className="w-full"
                      />
                      <figcaption className="flex items-center justify-between gap-2 border-t p-2">
                        <span className="text-xs text-muted-foreground">图片 {i + 1}</span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label="复制图片引用" onClick={() => copyText(src)}>
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setImageEditIndex(i)
                              imageInputRef.current?.click()
                            }}
                          >
                            替换
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="删除图片"
                            onClick={() => updateTrade(trade.id, { referenceImages: trade.referenceImages.filter((_, index) => index !== i) })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handleImageSelected(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* 侧栏：概要信息 */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">结果</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">PnL</span>
                {trade.status === 'closed' ? (
                  <PnlText value={m.pnl} currency={account?.currency} className="text-lg font-semibold" />
                ) : (
                  <span className="text-sm text-muted-foreground">持仓中</span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">R 倍数</span>
                <RText value={m.rMultiple} className="text-sm font-medium" />
              </div>
              {trade.initialStopLoss == null && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground text-pretty">
                  未设置初始止损，无法计算 R。可点击「编辑」补录。
                </p>
              )}
              <Separator />
              <div className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">进场均价</span>
                <span className="font-mono text-sm tabular-nums">
                  {fmtPrice(m.avgEntry, symbol?.pricePrecision)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">离场均价</span>
                <span className="font-mono text-sm tabular-nums">
                  {fmtPrice(m.avgExit, symbol?.pricePrecision)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">总仓位</span>
                <span className="font-mono text-sm tabular-nums">{m.totalQuantity}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">持仓时长</span>
                <span className="whitespace-nowrap font-mono text-sm tabular-nums">
                  {fmtDuration(m.durationMs)}
                  <span className="text-muted-foreground"> · {Math.max(1, Math.round(m.durationMs / 300_000))} bars</span>
                </span>
              </div>
              {trade.initialStopLoss != null && (
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">初始止损</span>
                  <span className="font-mono text-sm tabular-nums">
                    {fmtPrice(trade.initialStopLoss, symbol?.pricePrecision)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Execution 数</span>
                <span className="font-mono text-sm tabular-nums">{trade.executions.length}</span>
              </div>
            </CardContent>
          </Card>

          {trade.note && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">交易备注</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-pretty">{trade.note}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">提及此交易的笔记</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {mentioningNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无笔记提及</p>
              ) : (
                mentioningNotes.map((note) => (
                  <Link
                    key={note.id}
                    to={`/notes?note=${note.id}`}
                    className="flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="text-sm font-medium">{note.title}</span>
                    <span className="text-xs text-muted-foreground">{fmtUtcDate(note.updatedAt)} 更新</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">归属</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Link
                to={`/accounts/${trade.accountId}`}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
              >
                <span className="text-muted-foreground">账户</span>
                <span className="font-medium">{account?.name}</span>
              </Link>
              <Link
                to={`/accounts/${trade.accountId}/periods/${trade.periodId}`}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
              >
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">{period?.name}</span>
              </Link>
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-muted-foreground">全局编号</span>
                <span className="font-mono font-medium">#{trade.seq}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">录入时间</span>
                <span className="whitespace-nowrap font-mono text-xs">{fmtUtcDateTime(trade.createdAt, false)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
