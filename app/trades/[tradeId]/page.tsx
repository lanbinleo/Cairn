'use client'

import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Clipboard, Copy, ImagePlus, MoreHorizontal, NotebookPen, Trash2 } from 'lucide-react'

import { AttachmentImage } from '@/components/attachment-image'
import { TradeChart, type TradeChartCaseMarker } from '@/components/trade-chart'
import { TradeCasePanel, TradeCaseSummaryCard } from '@/components/trade-case-panel'
import { PnlText, RText } from '@/components/pnl-text'
import { DirectionBadge, StatusBadge } from '@/components/trades-table'
import { EditTradeDialog } from '@/components/edit-trade-dialog'
import { TagBadge } from '@/components/tag-badge'
import { TradeProcessScoreCard } from '@/components/trade-process-score'
import { TradePlanCompareCard } from '@/components/trade-plan-compare'
import { InfoHint } from '@/components/info-hint'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useCairn } from '@/lib/store'
import { executionActionLabel, hasPositionFill, isPositionExecutionAction, orderTypeLabel } from '@/lib/executions'
import { aggregateDisplayExecutions } from '@/lib/execution-display'
import { computeTradeMetrics } from '@/lib/metrics'
import { savedProcessScoreTotal } from '@/lib/process-score'
import { fmtPrice, fmtDuration, fmtQty, fmtUtcDateTime, fmtUtcDate, fmtMoney } from '@/lib/format'
import { sortTagNamesByColor } from '@/lib/tags'
import { resolveCaseCardTimesForTrade, timeToBarNumber } from '@/lib/bar-time'
import { readFileAsDataUrl } from '@/lib/tradingview-import'
import { createTradeTransferPayload, stringifyTradeTransfer } from '@/lib/trade-transfer'
import { CHART_TIMEFRAMES, chartTimeframeLabel, chartTimeframeMinutes } from '@/lib/chart-timeframes'
import { logFrontendError } from '@/lib/frontend-log'
import { caseCardDigest, casePhaseLabel } from '@/lib/cases'
import type { CaseCardPhase, ChartTimeframe, Execution } from '@/lib/types'

type TradeDetailTab = 'overview' | 'case' | 'trade'

const CASE_TIMELINE_DOT: Record<CaseCardPhase, string> = {
  'pre-entry': 'border-blue-500',
  entry: 'border-emerald-500',
  intermediate: 'border-amber-500',
  closing: 'border-rose-500',
  reflection: 'border-violet-500',
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
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [imageUploadError, setImageUploadError] = useState('')
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('5m')
  const [showTrailLines, setShowTrailLines] = useState(true)
  const [showEntryLine, setShowEntryLine] = useState(true)
  const [activeTab, setActiveTab] = useState<TradeDetailTab>('overview')
  const [targetCaseCardId, setTargetCaseCardId] = useState<string>()
  const [planPromptOpen, setPlanPromptOpen] = useState(false)
  const [planPrefillHint, setPlanPrefillHint] = useState('')
  const [editOpenRequest, setEditOpenRequest] = useState(0)
  /* AI 补录建议「修改后添加」：nonce 触发 EditTradeDialog 打开并预填草稿 */
  const [suggestPrefill, setSuggestPrefill] = useState<{ execution: Execution; nonce: number } | null>(null)
  const planPromptShownRef = useRef<string | null>(null)
  const { getTrade, getAccount, getPeriod, getSymbol, getNotesMentioningTrade, symbolLabel, setTradeStatus, updateTrade, createNote, createImageAttachment, deleteAttachment, getChartCandles, tagDefs, cases, caseCards, caseBindings, prefillTradePlanFromBoundCase } = useCairn()
  /* 缺失计划价提醒：每笔 Trade 每次访问最多弹一次；「忽略」持久化，「待会儿提醒」下次访问再弹 */
  useEffect(() => {
    const current = getTrade(tradeId)
    if (!current || current.status !== 'closed') return
    if (current.initialStopLoss != null && current.initialTakeProfit != null) return
    if (localStorage.getItem(`cairn.trade-plan-prompt.${current.id}`) === 'ignored') return
    if (planPromptShownRef.current === current.id) return
    planPromptShownRef.current = current.id
    setPlanPrefillHint('')
    setPlanPromptOpen(true)
  }, [getTrade, tradeId])
  const trade = getTrade(tradeId)
  if (!trade) return <Navigate to="/trades" replace />
  const activeTrade = trade

  const account = getAccount(trade.accountId)
  const period = getPeriod(trade.periodId)
  const symbol = getSymbol(trade.symbolId)
  const m = computeTradeMetrics(trade)
  const tags = sortTagNamesByColor(trade.tags, tagDefs)
  const executionTimes = trade.executions.map((execution) => execution.time)
  const barMinutes = chartTimeframeMinutes(chartTimeframe)
  const chartPadding = barMinutes * 60_000 * 80
  const chartStart = executionTimes.length ? Math.min(...executionTimes) - chartPadding : undefined
  const chartEnd = executionTimes.length ? Math.max(...executionTimes) + chartPadding : undefined
  const libraryBars = getChartCandles(trade.symbolId, chartTimeframe, chartStart, chartEnd)
  const bars = libraryBars.length ? libraryBars : trade.chartData?.[chartTimeframe] ?? (chartTimeframe === '5m' ? trade.chartBars : undefined) ?? []
  const mentioningNotes = getNotesMentioningTrade(trade.id)
  const tradeBinding = caseBindings.find((binding) => binding.tradeId === trade.id)
  const boundCase = tradeBinding ? cases.find((caseRecord) => caseRecord.id === tradeBinding.caseId) : undefined
  const boundCaseCards = boundCase ? caseCards.filter((card) => card.caseId === boundCase.id) : []
  const entryMemo = boundCaseCards.find((card) => card.phase === 'entry')?.aiAnalysis?.memo ?? null
  const fillTimes = trade.executions.filter(hasPositionFill).map((execution) => execution.time)
  const anchorTime = fillTimes.length ? Math.min(...fillTimes) : (executionTimes.length ? Math.min(...executionTimes) : undefined)
  const cardWindow = anchorTime == null ? undefined : {
    anchor: anchorTime,
    start: bars.length ? bars[0].time : anchorTime,
    end: bars.length ? bars[bars.length - 1].time : anchorTime,
  }
  const cardBarTimes = cardWindow
    ? resolveCaseCardTimesForTrade(boundCaseCards, barMinutes, cardWindow)
    : new Map<string, { time: number; invalid: boolean }>()
  const barIntervalMs = barMinutes * 60_000
  const caseMarkers: TradeChartCaseMarker[] = boundCaseCards.flatMap((card) => {
    const resolved = cardBarTimes.get(card.id)
    if (!resolved) return []
    return [{
      cardId: card.id,
      barNumber: timeToBarNumber(resolved.time, barMinutes),
      time: resolved.time,
      phase: card.phase,
      invalid: resolved.invalid,
      label: casePhaseLabel[card.phase],
      detail: card.rawText,
    }]
  })
  const inRangeCaseMarkers = cardWindow
    ? caseMarkers.filter((marker) => marker.time >= cardWindow.start - barIntervalMs && marker.time <= cardWindow.end + barIntervalMs)
    : []
  const outOfRangeCaseMarkerCount = caseMarkers.length - inRangeCaseMarkers.length

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

  function copyTradeJson(includeChartData: boolean) {
    copyText(stringifyTradeTransfer(createTradeTransferPayload(activeTrade, symbol, includeChartData)))
  }

  async function handleImageSelected(file?: File) {
    if (!file) return
    setIsImageUploading(true)
    setImageUploadError('')
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const attachment = await createImageAttachment({
        ownerType: 'trade',
        ownerId: activeTrade.id,
        kind: 'reference-image',
        fileName: file.name,
        contentDataUrl: dataUrl,
      })
      const next = [...activeTrade.referenceImages]
      if (imageEditIndex == null) {
        next.push(attachment.id)
      } else {
        const previous = next[imageEditIndex]
        next[imageEditIndex] = attachment.id
        if (previous && !previous.startsWith('data:') && !previous.startsWith('http://') && !previous.startsWith('https://')) {
          deleteAttachment(previous)
        }
      }
      updateTrade(activeTrade.id, { referenceImages: next })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setImageUploadError(`添加图片失败：${message}`)
      void logFrontendError(`image attachment save failed: ${message}`)
    } finally {
      setIsImageUploading(false)
      setImageEditIndex(null)
    }
  }

  function stopLabelForExecutionIndex(index: number) {
    const hasPriorStop =
      activeTrade.initialStopLoss != null ||
      activeTrade.executions.slice(0, index).some((execution) => execution.price != null && (execution.action === 'stop' || execution.action === 'stop-set' || execution.action === 'stop-moved'))
    return hasPriorStop ? 'Move stop' : 'Set stop'
  }

  const displayExecutions = aggregateDisplayExecutions(trade.executions, chartTimeframeMinutes(chartTimeframe) * 60_000)
  const timeline = [
    ...displayExecutions.map((e) => {
      const executionIndex = activeTrade.executions.findIndex((execution) => execution.id === e.aggregateExecutionIds[0])
      const label = e.action === 'stop' ? stopLabelForExecutionIndex(executionIndex) : (executionActionLabel[e.action] ?? e.action)
      const priceText = e.price == null ? '' : fmtPrice(e.price, symbol?.pricePrecision)
      const isPositionAction = isPositionExecutionAction(e.action)
      const aggregateText = e.aggregateCount > 1 ? ` · 合并 ${e.aggregateCount} 笔同 K 线同价成交` : ''
      return {
        kind: 'exec' as const,
        time: e.time,
        title: isPositionAction ? `${label} ${e.quantity == null ? '—' : fmtQty(e.quantity)} @ ${priceText || '—'}` : `${label}${priceText ? ` -> ${priceText}` : ''}`,
        detail: `${orderTypeLabel[e.orderType] ?? e.orderType}${e.anchorPrice == null ? '' : ` · anchor ${fmtPrice(e.anchorPrice, symbol?.pricePrecision)}`}${e.signal ? ` · 信号 ${e.signal}` : ''}${aggregateText}`,
        tone: e.action === 'entry' || e.action === 'scale-in' || e.action.startsWith('target') ? 'entry' : 'exit',
        barNumber: timeToBarNumber(e.time, barMinutes),
      }
    }),
    ...trade.events.map((ev) => ({
      kind: 'event' as const,
      time: ev.time,
      title: ev.price == null ? eventLabel[ev.type] : `${eventLabel[ev.type]} -> ${fmtPrice(ev.price, symbol?.pricePrecision)}`,
      detail: ev.note ?? '',
      tone: ev.type.startsWith('sl') ? 'sl' : 'tp',
      barNumber: timeToBarNumber(ev.time, barMinutes),
    })),
    ...boundCaseCards.map((card) => {
      const resolved = cardBarTimes.get(card.id)
      const time = resolved?.time ?? card.createdAt
      return {
        kind: 'case' as const,
        time,
        title: `${casePhaseLabel[card.phase]}${resolved?.invalid ? ' · BAR 异常' : ''}`,
        // 时间线上先看一句话提炼（点击跳 Case Tab 看原文）；无 digest 回退原文
        detail: caseCardDigest(card) ?? card.rawText,
        tone: 'case' as const,
        cardId: card.id,
        barNumber: timeToBarNumber(time, barMinutes),
        phase: card.phase,
      }
    }),
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
          <p className="text-sm text-muted-foreground">
            {account?.name} · {period?.name} · {fmtUtcDate(m.entryTime)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={createLinkedNote}>
            <NotebookPen data-icon="inline-start" />
            新建笔记
          </Button>
          {trade.status === 'open' && (
            <Button variant="outline" onClick={() => setTradeStatus(trade.id, 'closed')}>
              <CheckCircle2 data-icon="inline-start" />
              标记为已平仓
            </Button>
          )}
          <EditTradeDialog trade={trade} openRequest={editOpenRequest} prefill={suggestPrefill} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" aria-label="更多操作">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => copyText(trade.id)}>
                <Clipboard />
                复制 ID
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyTradeJson(false)}>
                <Clipboard />
                复制 JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyTradeJson(true)}>
                <Clipboard />
                JSON + 图表
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog open={planPromptOpen} onOpenChange={setPlanPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>缺少计划信息</DialogTitle>
            <DialogDescription>
              这笔已平仓的 Trade 还缺 {[
                trade.initialStopLoss == null && '初始止损',
                trade.initialTakeProfit == null && '初始止盈',
              ].filter(Boolean).join('、')}
              ，缺失时 R 与过程分不完整。可以现在补，也可以待会儿再说。
            </DialogDescription>
          </DialogHeader>
          {planPrefillHint && <p className="text-sm text-muted-foreground">{planPrefillHint}</p>}
          <DialogFooter className="flex-wrap gap-2 sm:flex-wrap">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                localStorage.setItem(`cairn.trade-plan-prompt.${trade.id}`, 'ignored')
                setPlanPromptOpen(false)
              }}
            >
              忽略
            </Button>
            <Button variant="outline" onClick={() => setPlanPromptOpen(false)}>待会儿提醒</Button>
            <Button
              variant="outline"
              onClick={() => {
                setPlanPromptOpen(false)
                setEditOpenRequest((n) => n + 1)
              }}
            >
              手动填写
            </Button>
            {boundCase && (
              <Button
                onClick={() => {
                  const filled = prefillTradePlanFromBoundCase(trade.id)
                  if (filled) {
                    setPlanPromptOpen(false)
                  } else {
                    setPlanPrefillHint('Entry 卡还没有可用的 memo（先在 Case 页点「AI 识别」，或手动填写）。')
                  }
                }}
              >
                从 Entry 卡填入
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TradeDetailTab)} className="gap-6">
        <TabsList className="h-10">
          <TabsTrigger value="overview" className="px-4">复盘</TabsTrigger>
          <TabsTrigger value="case" className="px-4">案例</TabsTrigger>
          <TabsTrigger value="trade" className="px-4">评估</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        {/* 主区：K 线图 + 配图 */}
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
                  <Button
                    variant={showTrailLines ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setShowTrailLines((value) => !value)}
                  >
                    轨迹线
                  </Button>
                  <Button
                    variant={showEntryLine ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setShowEntryLine((value) => !value)}
                  >
                    入场线
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TradeChart
                bars={bars}
                trade={trade}
                showTrailLines={showTrailLines}
                showEntryLine={showEntryLine}
                caseMarkers={inRangeCaseMarkers}
                pricePrecision={symbol?.pricePrecision}
                onCaseMarkerClick={(cardId) => {
                  setTargetCaseCardId(cardId)
                  setActiveTab('case')
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {chartTimeframeLabel(chartTimeframe)} · UTC · EMA · 箭头为仓位成交，圆点为管理动作，方块为 Case Card（可点击），虚线为止损/止盈轨迹
                {outOfRangeCaseMarkerCount > 0 && ` · ${outOfRangeCaseMarkerCount} 张卡片时间在图表范围外`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">时间线</CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? <p className="text-sm text-muted-foreground">暂无时间线记录。</p> : (
                <ol className="flex flex-col">
                  {timeline.map((item, i) => (
                    <li key={`${item.kind}-${item.time}-${i}`} className="flex min-w-0 gap-4">
                      <div className="flex flex-col items-center">
                        <span className={item.kind === 'case' ? `mt-1.5 size-2.5 shrink-0 rounded-full border-2 bg-background ${CASE_TIMELINE_DOT[item.phase]}` : item.kind === 'exec' ? (item.tone === 'entry' ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-profit' : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-loss') : 'mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-muted-foreground bg-background'} aria-hidden="true" />
                        {i < timeline.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
                      </div>
                      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 pb-5">
                        <div className="min-w-0 flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{item.title}</span>
                          {item.detail && (item.kind === 'case' ? <button type="button" className="max-w-2xl truncate text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => { setTargetCaseCardId(item.cardId); setActiveTab('case') }}>{item.detail}</button> : <span className="text-xs text-muted-foreground">{item.detail}</span>)}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right"><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtUtcDateTime(item.time, false)}</span><span className="whitespace-nowrap font-mono text-xs text-muted-foreground/70">{item.barNumber == null ? '未标注 BAR' : `Bar #${item.barNumber}`}</span></div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">配图区</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isImageUploading}
                  onClick={() => {
                    setImageEditIndex(null)
                    imageInputRef.current?.click()
                  }}
                >
                  <ImagePlus data-icon="inline-start" />
                  {isImageUploading ? '添加中...' : '添加图片'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {imageUploadError && (
                <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {imageUploadError}
                </p>
              )}
              {trade.referenceImages.length === 0 ? (
                <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  暂无配图
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {trade.referenceImages.map((imageRef, i) => (
                    <figure key={imageRef + i} className="overflow-hidden rounded-lg border">
                      <AttachmentImage
                        imageRef={imageRef}
                        alt={`交易 #${trade.seq} 配图 ${i + 1}`}
                        className="w-full"
                      />
                      <figcaption className="flex items-center justify-between gap-2 border-t p-2">
                        <span className="text-xs text-muted-foreground">图片 {i + 1}</span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label="复制图片引用" onClick={() => copyText(`[[image:${imageRef}]]`)}>
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isImageUploading}
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
                            onClick={() => {
                              if (!imageRef.startsWith('data:') && !imageRef.startsWith('http://') && !imageRef.startsWith('https://')) {
                                deleteAttachment(imageRef)
                              }
                              updateTrade(trade.id, { referenceImages: trade.referenceImages.filter((_, index) => index !== i) })
                            }}
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
                disabled={isImageUploading}
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
          {tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">标签</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <TagBadge key={tag} name={tag} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
              {(() => {
                const score = savedProcessScoreTotal(trade.processScore)
                return (
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">过程分</span>
                    {score != null ? (
                      <span className="font-mono text-sm font-medium tabular-nums" title="过程分只看决策时点的信息，与盈亏无关；明细在评估 tab。">{score} / 10</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                        onClick={() => setActiveTab('trade')}
                      >
                        未评分，去评分
                      </button>
                    )}
                  </div>
                )
              })()}
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
                <span className="shrink-0 text-sm text-muted-foreground">持仓时长</span>
                <span className="whitespace-nowrap font-mono text-sm tabular-nums">
                  {fmtDuration(m.durationMs)}
                  <span className="text-muted-foreground"> · {Math.max(1, Math.round(m.durationMs / 300_000))} 根K线</span>
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">交易备注</CardTitle>
            </CardHeader>
            <CardContent>
              {trade.note ? (
                <p className="text-sm leading-relaxed text-pretty">{trade.note}</p>
              ) : (
                <p className="text-sm text-muted-foreground">还没有备注；可在案例 tab 用 AI 总结的「填入复盘备注」生成草稿。</p>
              )}
            </CardContent>
          </Card>

          {mentioningNotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">提及此交易的笔记</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {mentioningNotes.map((note) => (
                  <Link
                    key={note.id}
                    to={`/notes?note=${note.id}`}
                    className="flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="text-sm font-medium">{note.title}</span>
                    <span className="text-xs text-muted-foreground">{fmtUtcDate(note.updatedAt)} 更新</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">元信息</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col text-sm">
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

          <TradeCaseSummaryCard trade={trade} onOpenCaseTab={() => setActiveTab('case')} />
        </div>
          </div>
        </TabsContent>

        <TabsContent value="case">
          <TradeCasePanel
            trade={trade}
            targetCardId={targetCaseCardId}
            cardTimes={cardBarTimes}
            onJumpCard={(cardId) => setTargetCaseCardId(cardId)}
            onSuggestEditPrefill={(draft) => setSuggestPrefill({ execution: draft, nonce: Date.now() })}
          />
        </TabsContent>

        <TabsContent value="trade">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  结果事实
                  <InfoHint>
                    初始风险锚定首笔入场与初始止损（计划的 1R）；实际风险按每笔加仓当时的生效止损分段累加。两个 R 只并列，不判断。
                  </InfoHint>
                </CardTitle>
                <p className="text-sm text-muted-foreground">结果只记录，不参与过程评分。</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">PnL</p>{trade.status === 'closed' ? <PnlText value={m.pnl} currency={account?.currency} className="mt-1 text-lg font-semibold" /> : <p className="mt-1 text-lg font-semibold text-muted-foreground">持仓中</p>}</div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">R 倍数（初始风险）</p><RText value={m.rMultiple} className="mt-1 text-lg font-semibold" /></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Execution</p><p className="mt-1 font-mono text-lg font-semibold">{trade.executions.length}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">持仓时长</p><p className="mt-1 font-mono text-lg font-semibold">{fmtDuration(m.durationMs)}</p></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">总仓位</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{fmtQty(m.totalQuantity)}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">初始止损</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{trade.initialStopLoss == null ? '—' : fmtPrice(trade.initialStopLoss, symbol?.pricePrecision)}</p></div>
                  <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">初始止盈</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{trade.initialTakeProfit == null ? '—' : fmtPrice(trade.initialTakeProfit, symbol?.pricePrecision)}</p></div>
                </div>
                {m.initialRisk != null && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">初始风险</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{fmtMoney(m.initialRisk, account?.currency)}</p></div>
                    <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">实际风险</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{m.actualRisk == null ? '—' : fmtMoney(m.actualRisk, account?.currency)}</p></div>
                    <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">R 实际风险</p><RText value={m.rActual} className="mt-1 text-lg font-semibold" /></div>
                    <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">最终止损</p><p className="mt-1 font-mono text-lg font-semibold tabular-nums">{m.finalStop == null ? '—' : fmtPrice(m.finalStop, symbol?.pricePrecision)}</p></div>
                  </div>
                )}
              </CardContent>
            </Card>
            <TradePlanCompareCard trade={trade} m={m} entryMemo={entryMemo} pricePrecision={symbol?.pricePrecision} />
            <TradeProcessScoreCard trade={trade} rMultiple={m.rMultiple} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
