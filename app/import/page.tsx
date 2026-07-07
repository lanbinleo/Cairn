'use client'

import { useRef, useState } from 'react'
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
import { useCairn } from '@/lib/store'
import { groupRows, inferOrderType, parseTradingViewRows, type ProposedTrade } from '@/lib/tradingview-import'
import type { Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

const STEPS = ['选择归属', '上传文件', '归组预览', '完成'] as const

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

export default function ImportPage() {
  const navigate = useNavigate()
  const { accounts, periods, symbols, trades, getPeriod, updatePeriod, createTrades } = useCairn()
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [step, setStep] = useState(0)
  const [accountId, setAccountId] = useState(accounts[0].id)
  const [periodId, setPeriodId] = useState('')
  const [symbolId, setSymbolId] = useState('')
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({})
  const [proposedTrades, setProposedTrades] = useState<ProposedTrade[]>([])
  const [importError, setImportError] = useState('')

  const periodOptions = periods.filter((p) => p.accountId === accountId)
  const canNext =
    step === 0 ? periodId !== '' && symbolId !== '' : step === 1 ? Boolean(files.trades) : true

  async function handleNext() {
    if (!canNext) return
    if (step === 1) {
      setImportError('')
      try {
        const rows = await parseTradingViewRows(files.trades as File)
        const grouped = groupRows(rows)
        setProposedTrades(grouped)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
        return
      }
    }
    if (step === 2) {
      confirmImport()
      return
    }
    setStep((s) => s + 1)
  }

  function confirmImport() {
    const now = Date.now()
    const maxSeq = trades.reduce((max, trade) => Math.max(max, trade.seq), 0)
    const created: Trade[] = proposedTrades
      .filter((trade) => trade.executions.length > 0 && !trade.warning)
      .map((trade, index) => {
        const tradeId = `tr-import-${now}-${index + 1}`
        const executions = trade.executions.map((execution, execIndex) => ({
          id: `ex-import-${now}-${index + 1}-${execIndex + 1}`,
          tradeId,
          action: execution.action,
          orderType: inferOrderType(execution.signal),
          time: execution.time,
          price: execution.price,
          quantity: execution.quantity,
          signal: execution.signal,
        }))
        const sl = executions.find((execution) => execution.orderType === 'stop-loss')?.price
        const lastAction = executions[executions.length - 1]?.action
        return {
          id: tradeId,
          seq: maxSeq + index + 1,
          accountId,
          periodId,
          symbolId,
          direction: trade.direction,
          status: lastAction === 'exit' ? 'closed' : 'open',
          initialStopLoss: sl,
          executions,
          events: [],
          referenceImages: [],
          tags: [],
          createdAt: now,
        }
      })

    createTrades(created)
    const period = getPeriod(periodId)
    if (period && !period.symbolIds.includes(symbolId)) {
      updatePeriod(period.id, { symbolIds: [...period.symbolIds, symbolId] })
    }
    setStep(3)
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
                  <TableHead>归组</TableHead>
                  <TableHead>TV 编号</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>信号</TableHead>
                  <TableHead>时间（UTC）</TableHead>
                  <TableHead className="text-right">价格</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposedTrades.flatMap((trade, tradeIndex) =>
                  trade.executions.map((row, rowIndex) => (
                    <TableRow key={`${trade.id}-${rowIndex}`}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono',
                            trade.warning ? 'border-loss/40 text-loss' : 'border-profit/40 text-profit',
                          )}
                        >
                          Trade {tradeIndex + 1}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{row.sourceRef.replace('tv:row:', '')}</TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell className="text-muted-foreground">{row.signal}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{new Date(row.time).toISOString().slice(0, 16).replace('T', ' ')}</TableCell>
                      <TableCell className="text-right font-mono">{row.price}</TableCell>
                      <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                    </TableRow>
                  )),
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
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <CircleCheck className="size-12 text-profit" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">导入完成</h2>
              <p className="text-sm text-muted-foreground text-pretty">
                {proposedTrades.filter((trade) => !trade.warning).length} 个 Trade 已归入所选 Period。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate(periodId ? `/accounts/${accountId}/periods/${periodId}` : '/accounts')}>
                查看 Period
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep(0)
                  setFiles({})
                  setProposedTrades([])
                  setImportError('')
                }}
              >
                再导入一批
              </Button>
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
