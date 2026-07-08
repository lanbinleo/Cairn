'use client'

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Save, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EXECUTION_ACTION_OPTIONS, ORDER_TYPE_OPTIONS } from '@/lib/executions'
import { useCairn } from '@/lib/store'
import { uniqueTagNames } from '@/lib/tags'
import type { Execution, ExecutionAction, OrderType, Trade, TradeDirection, TradeStatus } from '@/lib/types'

interface DraftExecution {
  id: string
  action: ExecutionAction
  orderType: OrderType
  time: string
  price: string
  quantity: string
  note: string
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function utcInputValue(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 16)
}

function parseUtcInput(value: string) {
  const ms = Date.parse(`${value}:00Z`)
  return Number.isFinite(ms) ? ms : Date.now()
}

function numberOrUndefined(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function newDraftExecution(action: ExecutionAction = 'entry'): DraftExecution {
  return {
    id: makeId('exec-draft'),
    action,
    orderType: 'market',
    time: utcInputValue(),
    price: '',
    quantity: '',
    note: '',
  }
}

export default function NewTradePage() {
  const navigate = useNavigate()
  const { accounts, periods, symbols, trades, createTrades } = useCairn()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const periodOptions = useMemo(() => periods.filter((period) => period.accountId === accountId), [accountId, periods])
  const [periodId, setPeriodId] = useState(periodOptions[0]?.id ?? '')
  const [symbolId, setSymbolId] = useState(symbols[0]?.id ?? '')
  const [direction, setDirection] = useState<TradeDirection>('long')
  const [status, setStatus] = useState<TradeStatus>('closed')
  const [initialStopLoss, setInitialStopLoss] = useState('')
  const [initialTakeProfit, setInitialTakeProfit] = useState('')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const [executions, setExecutions] = useState<DraftExecution[]>([
    newDraftExecution('entry'),
    newDraftExecution('exit'),
  ])

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
    if (!symbolId && symbols[0]) setSymbolId(symbols[0].id)
  }, [accountId, accounts, symbolId, symbols])

  useEffect(() => {
    if (!periodId && periodOptions[0]) setPeriodId(periodOptions[0].id)
  }, [periodId, periodOptions])

  function updateExecution(id: string, patch: Partial<DraftExecution>) {
    setExecutions((prev) => prev.map((execution) => (execution.id === id ? { ...execution, ...patch } : execution)))
  }

  function addExecution() {
    setExecutions((prev) => [...prev, newDraftExecution(prev.some((execution) => execution.action === 'entry') ? 'exit' : 'entry')])
  }

  function handleSave() {
    const tradeId = makeId('trd')
    const seq = Math.max(0, ...trades.map((trade) => trade.seq)) + 1
    const normalizedExecutions: Execution[] = executions
      .filter((execution) => execution.time.trim() !== '')
      .map((execution) => ({
        id: makeId('exe'),
        tradeId,
        action: execution.action,
        orderType: execution.orderType,
        time: parseUtcInput(execution.time),
        price: numberOrUndefined(execution.price),
        quantity: numberOrUndefined(execution.quantity),
        note: execution.note.trim() === '' ? undefined : execution.note.trim(),
      }))
      .sort((a, b) => a.time - b.time)

    const now = Date.now()
    const trade: Trade = {
      id: tradeId,
      seq,
      accountId,
      periodId,
      symbolId,
      direction,
      status,
      initialStopLoss: numberOrUndefined(initialStopLoss),
      initialTakeProfit: numberOrUndefined(initialTakeProfit),
      executions: normalizedExecutions,
      events: [],
      referenceImages: [],
      tags: uniqueTagNames(tags.split(',')),
      note: note.trim() === '' ? undefined : note.trim(),
      createdAt: now,
    }
    createTrades([trade])
    navigate(`/trades/${trade.id}`)
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="新建 Trade"
        description="手动录入一笔交易及其 executions"
        actions={
          <Button onClick={handleSave} disabled={!accountId || !periodId || !symbolId || executions.length === 0}>
            <Save data-icon="inline-start" />
            保存
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {accounts.length === 0 || periods.length === 0 || symbols.length === 0 ? (
          <Card className="xl:col-span-2">
            <CardContent className="py-10 text-sm text-muted-foreground">
              新建 Trade 前需要先创建 Account、Period 和 Symbol。
            </CardContent>
          </Card>
        ) : (
          <>
        <Card>
          <CardHeader>
            <CardTitle>Executions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {executions.map((execution, index) => (
              <div key={execution.id} className="grid grid-cols-1 gap-3 rounded-lg border p-3 lg:grid-cols-[8rem_8rem_12rem_1fr_1fr_auto]">
                <Field>
                  <FieldLabel>Action</FieldLabel>
                  <Select
                    items={EXECUTION_ACTION_OPTIONS}
                    value={execution.action}
                    onValueChange={(value) => updateExecution(execution.id, { action: value as ExecutionAction })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {EXECUTION_ACTION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Order</FieldLabel>
                  <Select
                    items={ORDER_TYPE_OPTIONS}
                    value={execution.orderType}
                    onValueChange={(value) => updateExecution(execution.id, { orderType: value as OrderType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {ORDER_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>时间（UTC）</FieldLabel>
                  <Input type="datetime-local" value={execution.time} onChange={(event) => updateExecution(execution.id, { time: event.target.value })} />
                </Field>

                <Field>
                  <FieldLabel>价格</FieldLabel>
                  <Input inputMode="decimal" value={execution.price} onChange={(event) => updateExecution(execution.id, { price: event.target.value })} />
                </Field>

                <Field>
                  <FieldLabel>数量</FieldLabel>
                  <Input inputMode="decimal" value={execution.quantity} onChange={(event) => updateExecution(execution.id, { quantity: event.target.value })} />
                </Field>

                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除 execution ${index + 1}`}
                    disabled={executions.length <= 1}
                    onClick={() => setExecutions((prev) => prev.filter((item) => item.id !== execution.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <Field className="lg:col-span-6">
                  <FieldLabel>备注</FieldLabel>
                  <Input value={execution.note} onChange={(event) => updateExecution(execution.id, { note: event.target.value })} />
                </Field>
              </div>
            ))}

            <Button variant="outline" onClick={addExecution}>
              <Plus data-icon="inline-start" />
              添加 Execution
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trade 信息</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>Account</FieldLabel>
                <Select
                  items={accounts.map((account) => ({ value: account.id, label: account.name }))}
                  value={accountId}
                  onValueChange={(value) => {
                    setAccountId(value as string)
                    const nextPeriod = periods.find((period) => period.accountId === value)
                    setPeriodId(nextPeriod?.id ?? '')
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Period</FieldLabel>
                <Select
                  items={periodOptions.map((period) => ({ value: period.id, label: period.name }))}
                  value={periodId}
                  onValueChange={(value) => setPeriodId(value as string)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {periodOptions.map((period) => (
                        <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Symbol</FieldLabel>
                <Select
                  items={symbols.map((symbol) => ({ value: symbol.id, label: `${symbol.exchange}:${symbol.code}` }))}
                  value={symbolId}
                  onValueChange={(value) => setSymbolId(value as string)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {symbols.map((symbol) => (
                        <SelectItem key={symbol.id} value={symbol.id}>{symbol.exchange}:{symbol.code}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>方向</FieldLabel>
                  <Select
                    items={[{ value: 'long', label: '多' }, { value: 'short', label: '空' }]}
                    value={direction}
                    onValueChange={(value) => setDirection(value as TradeDirection)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="long">多</SelectItem>
                        <SelectItem value="short">空</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>状态</FieldLabel>
                  <Select
                    items={[{ value: 'closed', label: '已平仓' }, { value: 'open', label: '持仓中' }]}
                    value={status}
                    onValueChange={(value) => setStatus(value as TradeStatus)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="closed">已平仓</SelectItem>
                        <SelectItem value="open">持仓中</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>初始止损</FieldLabel>
                  <Input inputMode="decimal" value={initialStopLoss} onChange={(event) => setInitialStopLoss(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>初始止盈</FieldLabel>
                  <Input inputMode="decimal" value={initialTakeProfit} onChange={(event) => setInitialTakeProfit(event.target.value)} />
                </Field>
              </div>

              <Field>
                <FieldLabel>标签</FieldLabel>
                <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用英文逗号分隔" />
              </Field>

              <Field>
                <FieldLabel>复盘备注</FieldLabel>
                <Textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
                <FieldDescription>保存后可在 Trade 详情页继续添加配图和关联笔记。</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
          </>
        )}
      </div>
    </div>
  )
}
