'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ChartCandlestick,
  ImageIcon,
  CircleCheck,
} from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { BindingSuggestForTrade } from '@/components/binding-suggestions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { useCairn } from '@/lib/store'
import { groupRows, parseChartBars, parseChartEvents, parseTradingViewRows, readFileAsDataUrl, type ParsedChartEvent, type ProposedTrade } from '@/lib/tradingview-import'
import { CHART_TIMEFRAMES, chartTimeframeLabel } from '@/lib/chart-timeframes'
import { getPossibleDuplicateTrade } from '@/lib/trade-duplicates'
import { matchTradesToCases, type ImportMatchCandidate, type ImportMatchLevel } from '@/lib/case-import-matching'
import { computeTradeMetrics } from '@/lib/metrics'
import { fmtUtcDateTime } from '@/lib/format'
import type { ChartBar, ChartTimeframe, Execution, ImportBatch, OrderType, Trade, TradeDirection, TradeEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

const STEPS = ['选择归属', '上传文件', '归组预览', '完成'] as const

/** 导入结果页的 Case 关联行状态 */
interface ImportMatchRow {
  tradeId: string
  level: ImportMatchLevel
  candidates: ImportMatchCandidate[]
  /** 已绑定（自动或人工确认）的 Case；null 表示待定/无匹配 */
  boundCaseId: string | null
}

const fileSlots = [
  {
    key: 'trades',
    icon: FileSpreadsheet,
    title: '① 交易记录',
    desc: 'TradingView 导出的做单记录（CSV/Excel）：编号、类型、信号、日期时间、价格、数量',
    required: true,
    mockName: 'BTCUSDT_trades_2026-02.csv',
  },
  {
    key: 'chart',
    icon: ChartCandlestick,
    title: '② 图表数据',
    desc: '同时段的 OHLC + EMA20 导出（CSV），用于在复盘页重建 K 线图',
    required: false,
    mockName: 'BTCUSDT_5m_2026-02.csv',
  },
  {
    key: 'reference',
    icon: ImageIcon,
    title: '③ 参考图',
    desc: '包含订单标记的图表截图，作为数据缺漏时的最终备份',
    required: false,
    mockName: 'BTCUSDT_2026-02_overview.png',
  },
] as const

type SlotKey = (typeof fileSlots)[number]['key']

function chartBarsForExecutions(chartBars: ChartBar[], executions: Execution[]) {
  if (chartBars.length === 0 || executions.length === 0) return undefined
  const times = executions.map((execution) => execution.time)
  const start = Math.min(...times)
  const end = Math.max(...times)
  const interval = chartBars.length > 1 ? Math.max(60_000, chartBars[1].time - chartBars[0].time) : 5 * 60_000
  const padding = interval * 80
  const selected = chartBars.filter((bar) => bar.time >= start - padding && bar.time <= end + padding)
  return selected.length > 0 ? selected : undefined
}

function chartEventsForExecutions(chartEvents: ParsedChartEvent[], executions: Execution[], tradeId: string): TradeEvent[] {
  if (chartEvents.length === 0 || executions.length === 0) return []
  const times = executions.map((execution) => execution.time)
  const start = Math.min(...times)
  const end = Math.max(...times)
  return chartEvents
    .filter((event) => event.time >= start && event.time <= end)
    .map((event, index) => ({
      id: `ev-${tradeId}-${index + 1}`,
      tradeId,
      type: event.type,
      time: event.time,
      price: event.price,
      sourceRef: event.sourceRef,
      note: event.note,
    }))
}

function proposedTradeCandidate(
  trade: ProposedTrade,
  input: { accountId: string; periodId: string; symbolId: string; seq: number },
): Trade {
  const tradeId = `candidate-${trade.id}`
  const executions: Execution[] = trade.executions.map((execution, index) => ({
    id: `candidate-exec-${trade.id}-${index}`,
    tradeId,
    action: execution.action,
    orderType: execution.orderType ?? 'market',
    time: execution.time,
    price: execution.price,
    quantity: execution.quantity,
    signal: execution.signal,
    sourceRef: execution.sourceTradeNo
      ? `tv:trade:${execution.sourceTradeNo}:${execution.sourceRef.replace('tv:', '')}`
      : execution.sourceRef,
  }))
  return {
    id: tradeId,
    seq: input.seq,
    accountId: input.accountId,
    periodId: input.periodId,
    symbolId: input.symbolId,
    direction: trade.direction,
    status: executions[executions.length - 1]?.action === 'exit' ? 'closed' : 'open',
    sourceRef: trade.executions[0]?.sourceTradeNo ? `tv:trade:${trade.executions[0].sourceTradeNo}` : undefined,
    executions,
    events: [],
    referenceImages: [],
    tags: [],
    createdAt: Date.now(),
  }
}

export default function ImportPage() {
  const navigate = useNavigate()
  const { accounts, periods, symbols, trades, getPeriod, updatePeriod, createTrades, createImportBatch, rollbackImportBatch, cases, caseCards, caseBindings, createCaseBinding, deleteCaseBinding } = useCairn()
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [step, setStep] = useState(0)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [periodId, setPeriodId] = useState('')
  const [symbolId, setSymbolId] = useState('')
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({})
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('5m')
  const [proposedTrades, setProposedTrades] = useState<ProposedTrade[]>([])
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([])
  const [chartBars, setChartBars] = useState<ChartBar[]>([])
  const [chartEvents, setChartEvents] = useState<ParsedChartEvent[]>([])
  const [referenceImage, setReferenceImage] = useState('')
  const [importError, setImportError] = useState('')
  const [createdBatchId, setCreatedBatchId] = useState('')
  const [matchRows, setMatchRows] = useState<ImportMatchRow[]>([])
  const [batchBindings, setBatchBindings] = useState<Array<{ bindingId: string; caseId: string; tradeId: string }>>([])
  const [pendingCaseByTrade, setPendingCaseByTrade] = useState<Record<string, string>>({})

  const periodOptions = periods.filter((p) => p.accountId === accountId)
  const canNext =
    step === 0 ? periodId !== '' && symbolId !== '' : step === 1 ? Boolean(files.trades) : step === 2 ? selectedTradeIds.length > 0 : true
  const duplicateTradeMatches = useMemo(() => {
    const matches = new Map<string, ReturnType<typeof getPossibleDuplicateTrade>>()
    const maxSeq = trades.reduce((max, trade) => Math.max(max, trade.seq), 0)
    proposedTrades.forEach((trade, index) => {
      const candidate = proposedTradeCandidate(trade, { accountId, periodId, symbolId, seq: maxSeq + index + 1 })
      const match = getPossibleDuplicateTrade(candidate, trades)
      if (match) matches.set(trade.id, match)
    })
    return matches
  }, [accountId, periodId, proposedTrades, symbolId, trades])
  const duplicateTradeIds = useMemo(() => new Set(duplicateTradeMatches.keys()), [duplicateTradeMatches])

  function toggleProposedTrade(id: string, checked: boolean) {
    setSelectedTradeIds((prev) => checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id))
  }

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
  }, [accountId, accounts])

  useEffect(() => {
    if (!symbolId && symbols[0]) setSymbolId(symbols[0].id)
  }, [symbolId, symbols])

  async function handleNext() {
    if (!canNext) return
    if (step === 1) {
      setImportError('')
      try {
        const rows = await parseTradingViewRows(files.trades as File)
        const grouped = groupRows(rows)
        setProposedTrades(grouped)
        const maxSeq = trades.reduce((max, trade) => Math.max(max, trade.seq), 0)
        setSelectedTradeIds(
          grouped
            .filter((trade, index) => {
              const candidate = proposedTradeCandidate(trade, { accountId, periodId, symbolId, seq: maxSeq + index + 1 })
              return !trade.warning && !getPossibleDuplicateTrade(candidate, trades)
            })
            .map((trade) => trade.id),
        )
        setChartBars(files.chart ? await parseChartBars(files.chart) : [])
        setChartEvents(files.chart ? await parseChartEvents(files.chart) : [])
        setReferenceImage(files.reference ? await readFileAsDataUrl(files.reference) : '')
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
        return
      }
    }
    if (step === 2) {
      await confirmImport()
      return
    }
    setStep((s) => s + 1)
  }

  async function confirmImport() {
    const now = Date.now()
    const maxSeq = trades.reduce((max, trade) => Math.max(max, trade.seq), 0)
    const batchId = `imp-${now}`
    const selected = proposedTrades.filter((trade) => selectedTradeIds.includes(trade.id))
    const created: Trade[] = proposedTrades
      .filter((trade) => selected.includes(trade) && trade.executions.length > 0)
      .map((trade, index) => {
        const tradeId = `tr-import-${now}-${index + 1}`
        const executions = trade.executions.map((execution, execIndex) => ({
          id: `ex-import-${now}-${index + 1}-${execIndex + 1}`,
          tradeId,
          action: execution.action,
          orderType: execution.orderType ?? 'market',
          time: execution.time,
          price: execution.price,
          quantity: execution.quantity,
          signal: execution.signal,
          sourceRef: execution.sourceTradeNo
            ? `tv:trade:${execution.sourceTradeNo}:${execution.sourceRef.replace('tv:', '')}`
            : execution.sourceRef,
        }))
        const sl = executions.find((execution) => execution.orderType === 'stop-loss')?.price
        const lastAction = executions[executions.length - 1]?.action
        const events = chartEventsForExecutions(chartEvents, executions, tradeId)
        const selectedChartBars = chartBarsForExecutions(chartBars, executions)
        return {
          id: tradeId,
          seq: maxSeq + index + 1,
          accountId,
          periodId,
          symbolId,
          direction: trade.direction,
          status: lastAction === 'exit' ? 'closed' : 'open',
          importBatchId: batchId,
          sourceRef: trade.executions[0]?.sourceTradeNo ? `tv:trade:${trade.executions[0].sourceTradeNo}` : undefined,
          initialStopLoss: sl,
          executions,
          events,
          referenceImages: referenceImage ? [referenceImage] : [],
          chartBars: chartTimeframe === '5m' ? selectedChartBars : undefined,
          chartData: selectedChartBars ? { [chartTimeframe]: selectedChartBars } : undefined,
          tags: [],
          createdAt: now,
        }
      })

    createTrades(created)
    const batch: ImportBatch = {
      id: batchId,
      accountId,
      periodId,
      symbolId,
      source: 'tradingview',
      status: 'active',
      tradeIds: created.map((trade) => trade.id),
      attachmentIds: [],
      createdAt: now,
      note: `Imported ${created.length} trades from TradingView`,
    }
    createImportBatch(batch)
    setCreatedBatchId(batchId)
    const period = getPeriod(periodId)
    if (period && !period.symbolIds.includes(symbolId)) {
      updatePeriod(period.id, { symbolIds: [...period.symbolIds, symbolId] })
    }
    await runImportCaseMatching(created)
    setStep(3)
  }

  /** 导入后 Case 关联：精确匹配自动绑定，其余列候选人工确认 */
  async function runImportCaseMatching(created: Trade[]) {
    const matches = matchTradesToCases(created, cases, caseCards, caseBindings)
    const usedCaseIds = new Set<string>()
    const rows: ImportMatchRow[] = []
    const bindings: Array<{ bindingId: string; caseId: string; tradeId: string }> = []
    for (const match of matches) {
      if (match.level === 'exact' && !usedCaseIds.has(match.candidates[0].caseId)) {
        try {
          const binding = await createCaseBinding(match.candidates[0].caseId, match.tradeId, 'import')
          usedCaseIds.add(match.candidates[0].caseId)
          bindings.push({ bindingId: binding.id, caseId: binding.caseId, tradeId: binding.tradeId })
          rows.push({ ...match, boundCaseId: binding.caseId })
          continue
        } catch {
          // 绑定失败（如并发状态冲突）退回人工确认
        }
      }
      rows.push({ ...match, boundCaseId: null })
    }
    setMatchRows(rows)
    setBatchBindings(bindings)
  }

  /** 人工确认关联（suggest 行） */
  async function confirmManualBinding(tradeId: string) {
    const caseId = pendingCaseByTrade[tradeId]
    if (!caseId) return
    try {
      const binding = await createCaseBinding(caseId, tradeId, 'import')
      setBatchBindings((prev) => [...prev, { bindingId: binding.id, caseId: binding.caseId, tradeId: binding.tradeId }])
      setMatchRows((prev) => prev.map((row) => (row.tradeId === tradeId ? { ...row, boundCaseId: caseId } : row)))
      setPendingCaseByTrade((prev) => {
        const next = { ...prev }
        delete next[tradeId]
        return next
      })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  function updateProposedExecution(tradeIndex: number, executionIndex: number, patch: Partial<Execution>) {
    setProposedTrades((prev) =>
      prev.map((trade, ti) =>
        ti === tradeIndex
          ? {
              ...trade,
              executions: trade.executions.map((execution, ei) =>
                ei === executionIndex ? { ...execution, ...patch } : execution,
              ),
            }
          : trade,
      ),
    )
  }

  function updateProposedTradeDirection(tradeIndex: number, direction: TradeDirection) {
    setProposedTrades((prev) =>
      prev.map((trade, index) => (index === tradeIndex ? { ...trade, direction } : trade)),
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="导入"
        description="从 TradingView 导出的文件导入交易记录、图表数据与参考图"
      />

      {/* 步骤指示器 */}
      <nav aria-label="导入步骤" className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                i === step
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i < step
                    ? 'border-profit/40 text-profit'
                    : 'text-muted-foreground',
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden="true" /> : <span className="font-mono text-xs">{i + 1}</span>}
              {label}
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" aria-hidden="true" />}
          </div>
        ))}
      </nav>

      {/* Step 0：选择归属 */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">这批数据属于哪里？</CardTitle>
            <CardDescription>先确定 Account、Period 与品种，导入的交易将全部归入该集合</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="max-w-md">
              <Field>
                <FieldLabel htmlFor="import-account">账户</FieldLabel>
                <Select
                  items={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.name}（${a.kind === 'backtest' ? '回测' : '实盘'}）`,
                  }))}
                  value={accountId}
                  onValueChange={(v) => {
                    setAccountId(v as string)
                    setPeriodId('')
                  }}
                >
                  <SelectTrigger id="import-account">
                    <SelectValue placeholder="选择账户" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}（{a.kind === 'backtest' ? '回测' : '实盘'}）
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-period">Period</FieldLabel>
                <Select
                  items={periodOptions.map((p) => ({ value: p.id, label: p.name }))}
                  value={periodId}
                  onValueChange={(v) => setPeriodId(v as string)}
                >
                  <SelectTrigger id="import-period">
                    <SelectValue placeholder="选择 Period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {periodOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Period 是一批交易的集合，例如「2026年2月」</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-symbol">品种</FieldLabel>
                <Select
                  items={symbols.map((s) => ({ value: s.id, label: `${s.exchange}:${s.code}` }))}
                  value={symbolId}
                  onValueChange={(v) => setSymbolId(v as string)}
                >
                  <SelectTrigger id="import-symbol">
                    <SelectValue placeholder="选择品种" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {symbols.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.exchange}:{s.code}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  没有需要的品种？先到「品种」页创建（交易所 + 代码）
                </FieldDescription>
              </Field>
            </FieldGroup>
            {(accounts.length === 0 || periods.length === 0 || symbols.length === 0) && (
              <p className="mt-4 text-sm text-muted-foreground">
                导入前需要先创建账户、Period 和品种。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 1：上传三份文件 */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {fileSlots.map((slot) => {
              const file = files[slot.key]
              const isUploaded = Boolean(file)
              const Icon = slot.icon
              return (
                <Card key={slot.key} className={cn(isUploaded && 'border-profit/40')}>
                  <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                    {isUploaded ? (
                      <CircleCheck className="size-8 text-profit" aria-hidden="true" />
                    ) : (
                      <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
                    )}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-medium">{slot.title}</span>
                        {slot.required ? (
                          <Badge variant="destructive" className="text-[10px]">
                            必需
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            可选
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{slot.desc}</p>
                    </div>
                    {isUploaded ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{file?.name}</span>
                        {slot.key === 'chart' && (
                          <span className="text-xs text-muted-foreground">周期：{chartTimeframeLabel(chartTimeframe)}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFiles((prev) => ({ ...prev, [slot.key]: undefined }))}
                        >
                          移除
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputs.current[slot.key]?.click()}
                      >
                        选择文件
                      </Button>
                    )}
                    {slot.key === 'chart' && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-xs text-muted-foreground">K 线周期</span>
                        <Select value={chartTimeframe} onValueChange={(value) => setChartTimeframe(value as ChartTimeframe)}>
                          <SelectTrigger size="sm" className="w-28">
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
                      </div>
                    )}
                    <input
                      ref={(node) => {
                        fileInputs.current[slot.key] = node
                      }}
                      type="file"
                      className="hidden"
                      accept={slot.key === 'reference' ? 'image/*' : '.csv,.xlsx,.xls'}
                      onChange={(event) => {
                        const selected = event.target.files?.[0]
                        if (selected) setFiles((prev) => ({ ...prev, [slot.key]: selected }))
                        event.target.value = ''
                      }}
                    />
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {importError && <p className="text-sm text-loss">{importError}</p>}
        </div>
      )}

      {/* Step 2：归组预览 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution 归组预览</CardTitle>
            <CardDescription>
              解析出 {proposedTrades.reduce((sum, trade) => sum + trade.executions.length, 0)} 条成交记录，按「同向连续建仓 → 全部离场」自动归组为 {proposedTrades.length} 个
              Trade。TradingView 的编号已替换为全局编号，可在此调整归组后确认。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">导入</TableHead>
                  <TableHead>归组</TableHead>
                  <TableHead>提示</TableHead>
                  <TableHead>TV 编号</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead>Execution</TableHead>
                  <TableHead>订单</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>信号</TableHead>
                  <TableHead>时间（UTC）</TableHead>
                  <TableHead className="text-right">价格</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposedTrades.flatMap((trade, tradeIndex) =>
                  trade.executions.map((row, rowIndex) => {
                    const duplicateMatch = duplicateTradeMatches.get(trade.id)
                    const duplicate = Boolean(duplicateMatch)
                    const selected = selectedTradeIds.includes(trade.id)
                    return (
                    <TableRow key={`${trade.id}-${rowIndex}`} className={duplicate ? 'bg-warning/8' : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 accent-current"
                          checked={selected}
                          onChange={(event) => toggleProposedTrade(trade.id, event.target.checked)}
                          aria-label={`导入 Trade ${tradeIndex + 1}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono',
                            trade.warning ? 'border-loss/40 text-loss' : duplicate ? 'border-warning/60 text-warning-foreground' : 'border-profit/40 text-profit',
                          )}
                        >
                          Trade {tradeIndex + 1}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {trade.warning ?? (duplicateMatch ? (
                          <Tooltip>
                            <TooltipTrigger render={<span>疑似重复：Trade #{String(duplicateMatch.trade.seq).padStart(3, '0')}</span>} />
                            <TooltipContent className="max-w-sm">
                              <span className="flex flex-col gap-1 py-1">
                                <span className="font-mono font-medium">Trade #{String(duplicateMatch.trade.seq).padStart(3, '0')}</span>
                                {duplicateMatch.reasons.map((reason) => (
                                  <span key={reason}>{reason}</span>
                                ))}
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        ) : '—')}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {row.sourceTradeNo ?? row.sourceRef.replace('tv:row:', '')}
                      </TableCell>
                      <TableCell>
                        <Select
                          items={[
                            { value: 'long', label: '多' },
                            { value: 'short', label: '空' },
                          ]}
                          value={trade.direction}
                          onValueChange={(value) => updateProposedTradeDirection(tradeIndex, value as TradeDirection)}
                        >
                          <SelectTrigger className="h-7 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="long">多</SelectItem>
                              <SelectItem value="short">空</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          items={[
                            { value: 'entry', label: '进场' },
                            { value: 'scale-in', label: '加仓' },
                            { value: 'scale-out', label: '减仓' },
                            { value: 'exit', label: '离场' },
                          ]}
                          value={row.action}
                          onValueChange={(value) => updateProposedExecution(tradeIndex, rowIndex, { action: value as Execution['action'] })}
                        >
                          <SelectTrigger className="h-7 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="entry">进场</SelectItem>
                              <SelectItem value="scale-in">加仓</SelectItem>
                              <SelectItem value="scale-out">减仓</SelectItem>
                              <SelectItem value="exit">离场</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          items={[
                            { value: 'market', label: '市价' },
                            { value: 'limit', label: '限价' },
                            { value: 'stop', label: 'Stop' },
                            { value: 'stop-loss', label: '止损' },
                            { value: 'take-profit', label: '止盈' },
                          ]}
                          value={row.orderType ?? 'market'}
                          onValueChange={(value) => updateProposedExecution(tradeIndex, rowIndex, { orderType: value as OrderType })}
                        >
                          <SelectTrigger className="h-7 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="market">市价</SelectItem>
                              <SelectItem value="limit">限价</SelectItem>
                              <SelectItem value="stop">Stop</SelectItem>
                              <SelectItem value="stop-loss">止损</SelectItem>
                              <SelectItem value="take-profit">止盈</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell className="text-muted-foreground">{row.signal}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{new Date(row.time).toISOString().slice(0, 16).replace('T', ' ')}</TableCell>
                      <TableCell className="text-right font-mono">{row.price}</TableCell>
                      <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                    </TableRow>
                    )
                  }),
                )}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground text-pretty">
              归组规则：同一方向上，从首次进场到仓位归零视作一个 Trade；期间的加仓（TV
              会给出新编号）与分批离场都会合并为该 Trade 的 Execution。识别为 SL/TP
              信号的出场会自动标记订单类型。
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 3：完成 */}
      {step === 3 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CircleCheck className="size-12 text-profit" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">导入完成</h2>
              <p className="text-sm text-muted-foreground text-pretty">
                {selectedTradeIds.length} 个 Trade 已归入所选 Period。
              </p>
            </div>
            {matchRows.length > 0 && (
              <div className="flex w-full max-w-3xl flex-col gap-2 text-left">
                <h3 className="text-sm font-medium">Case 关联</h3>
                <p className="text-xs text-muted-foreground">
                  绿色 = 精确匹配已自动关联；黄色 = 候选待确认（Case 记录时间与成交时间接近）；红色 = 未找到 Case。匹配按账户与时间窗（±15 分钟），请顺手核对品种。
                </p>
                <div className="flex flex-col gap-1.5">
                  {matchRows.map((row) => {
                    const trade = trades.find((item) => item.id === row.tradeId)
                    if (!trade) return null
                    const metrics = computeTradeMetrics(trade)
                    const symbol = symbols.find((item) => item.id === trade.symbolId)
                    const boundCase = cases.find((item) => item.id === row.boundCaseId)
                    const tone = row.boundCaseId != null || row.level === 'exact'
                      ? 'bg-profit'
                      : row.level === 'suggest'
                        ? 'bg-amber-500'
                        : 'bg-loss'
                    return (
                      <div key={row.tradeId} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                        <span className={cn('inline-block size-2.5 shrink-0 rounded-full', tone)} aria-hidden="true" />
                        <span className="font-mono text-xs">
                          #{String(trade.seq).padStart(3, '0')} {symbol ? `${symbol.exchange}:${symbol.code}` : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">{fmtUtcDateTime(metrics.entryTime)}</span>
                        {boundCase ? (
                          <span className="ml-auto flex items-center gap-2 text-sm">
                            <Link to={`/cases/${boundCase.id}`} className="underline-offset-2 hover:underline">{boundCase.title}</Link>
                            <Badge variant="secondary">{row.level === 'exact' ? '自动关联' : '已确认'}</Badge>
                          </span>
                        ) : row.level === 'suggest' ? (
                          <span className="ml-auto flex items-center gap-2">
                            <Select
                              items={row.candidates.map((candidate) => ({
                                value: candidate.caseId,
                                label: cases.find((item) => item.id === candidate.caseId)?.title ?? candidate.caseId,
                              }))}
                              value={pendingCaseByTrade[row.tradeId] ?? row.candidates[0]?.caseId}
                              onValueChange={(value) => setPendingCaseByTrade((prev) => ({ ...prev, [row.tradeId]: value as string }))}
                            >
                              <SelectTrigger className="h-8 w-52"><SelectValue placeholder="选择 Case" /></SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {row.candidates.map((candidate) => (
                                    <SelectItem key={candidate.caseId} value={candidate.caseId}>
                                      {cases.find((item) => item.id === candidate.caseId)?.title ?? candidate.caseId}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <Button size="sm" className="h-8" onClick={() => void confirmManualBinding(row.tradeId)}>
                              关联
                            </Button>
                          </span>
                        ) : (
                          <span className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">未找到 Case</span>
                            <BindingSuggestForTrade
                              trade={trade}
                              onBound={(binding) => {
                                if (binding.tradeId !== trade.id) return
                                setMatchRows((prev) => prev.map((row) => (row.tradeId === trade.id ? { ...row, boundCaseId: binding.caseId } : row)))
                              }}
                            />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate(periodId ? `/accounts/${accountId}/periods/${periodId}` : '/accounts')}>
                查看 Period
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep(0)
                  setFiles({})
                  setChartTimeframe('5m')
                  setProposedTrades([])
                  setSelectedTradeIds([])
                  setChartBars([])
                  setChartEvents([])
                  setReferenceImage('')
                  setImportError('')
                  setCreatedBatchId('')
                  setMatchRows([])
                  setBatchBindings([])
                  setPendingCaseByTrade({})
                }}
              >
                再导入一批
              </Button>
              {createdBatchId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    batchBindings.forEach((entry) => void deleteCaseBinding(entry.bindingId))
                    rollbackImportBatch(createdBatchId)
                    setCreatedBatchId('')
                    navigate('/trades')
                  }}
                >
                  撤销本次导入
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 底部导航 */}
      {step < 3 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft data-icon="inline-start" />
            上一步
          </Button>
          <Button disabled={!canNext} onClick={() => void handleNext()}>
            {step === 2 ? '确认导入' : '下一步'}
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      )}
    </div>
  )
}
