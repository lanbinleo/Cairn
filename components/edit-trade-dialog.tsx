'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, ChevronRight, GripVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { TAG_COLORS, tagColorClasses, tagColorNames, tagDotClasses } from '@/components/tag-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { barIndexToTime, barsPerDay, isValidBarIndex, timeToBarIndex, utcDayStart } from '@/lib/bar-time'
import { insertAtCursor, readPastedImage } from '@/lib/clipboard-images'
import {
  EXECUTION_ACTION_OPTIONS,
  ORDER_TYPE_OPTIONS,
  executionActionLabel,
  isManagementExecutionAction,
  isPositionExecutionAction,
  orderTypeLabel,
} from '@/lib/executions'
import { fmtPrice, fmtUtcDate, fmtUtcTime } from '@/lib/format'
import { useCairn } from '@/lib/store'
import { findTagByName, normalizeTagName, tagNamesEqual, uniqueTagNames } from '@/lib/tags'
import type { Execution, ExecutionAction, OrderType, TagColor, Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

const EXECUTION_TIMEFRAME_MINUTES = 5

const SIGNAL_OPTIONS = [
  'Entry',
  'Exit',
  'Scale In',
  'Scale Out',
  'TP1',
  'TP2',
  'TP3',
  'SL',
  'Break Even',
  'Trailing Stop',
  'Move Stop',
  'Move Target',
  'Order Updated',
  'Manual',
]

function parseUtcDate(dateText: string) {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day))
}

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeExecution(execution: Execution, tradeId: string): Execution {
  return {
    ...execution,
    tradeId,
    price: optionalNumber(execution.price),
    quantity: optionalNumber(execution.quantity),
    anchorPrice: optionalNumber(execution.anchorPrice),
  }
}

function canSaveExecution(execution: Execution) {
  if (!Number.isFinite(execution.time)) return false
  if (execution.action === 'undecided') return true
  if (isPositionExecutionAction(execution.action)) {
    return Number.isFinite(execution.price) && Number.isFinite(execution.quantity) && (execution.quantity ?? 0) > 0
  }
  if (execution.action === 'order-edit') return true
  return isManagementExecutionAction(execution.action) && Number.isFinite(execution.price)
}

export function EditTradeDialog({ trade }: { trade: Trade }) {
  const { updateTrade, deleteTrade, tagDefs, createTag, setTradeStatus } = useCairn()
  const [open, setOpen] = useState(false)

  /* 表单状态：打开时从 trade 初始化 */
  const [note, setNote] = useState(trade.note ?? '')
  const [sl, setSl] = useState(trade.initialStopLoss?.toString() ?? '')
  const [tp, setTp] = useState(trade.initialTakeProfit?.toString() ?? '')
  const [status, setStatus] = useState(trade.status)
  const [executionRows, setExecutionRows] = useState<Execution[]>(trade.executions)
  const [expandedExecutionIds, setExpandedExecutionIds] = useState<Set<string>>(new Set())
  const [draggingExecutionId, setDraggingExecutionId] = useState<string | null>(null)
  const draggingExecutionIdRef = useRef<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>(uniqueTagNames(trade.tags))
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState<TagColor>('blue')
  const normalizedNewTagName = normalizeTagName(newTagName)

  function resetForm() {
    setNote(trade.note ?? '')
    setSl(trade.initialStopLoss?.toString() ?? '')
    setTp(trade.initialTakeProfit?.toString() ?? '')
    setStatus(trade.status)
    setExecutionRows(trade.executions.map((execution) => ({ ...execution })))
    setExpandedExecutionIds(new Set())
    setDraggingExecutionId(null)
    draggingExecutionIdRef.current = null
    setSelectedTags(uniqueTagNames(trade.tags))
    setNewTagName('')
    setNewTagColor('blue')
  }

  function toggleTag(name: string) {
    setSelectedTags((prev) => {
      const active = prev.some((tag) => tagNamesEqual(tag, name))
      return active ? prev.filter((tag) => !tagNamesEqual(tag, name)) : uniqueTagNames([...prev, name])
    })
  }

  function handleCreateTag() {
    if (!normalizedNewTagName) return
    const def = findTagByName(tagDefs, normalizedNewTagName) ?? createTag(normalizedNewTagName, newTagColor)
    if (def) {
      setSelectedTags((prev) => uniqueTagNames([...prev, def.name]))
      setNewTagName('')
    }
  }

  function handleSave() {
    const parsedSl = sl.trim() === '' ? undefined : Number(sl)
    const parsedTp = tp.trim() === '' ? undefined : Number(tp)
    updateTrade(trade.id, {
      note: note.trim() === '' ? undefined : note.trim(),
      initialStopLoss: parsedSl != null && Number.isFinite(parsedSl) ? parsedSl : undefined,
      initialTakeProfit: parsedTp != null && Number.isFinite(parsedTp) ? parsedTp : undefined,
      executions: executionRows
        .map((execution) => normalizeExecution(execution, trade.id))
        .filter(canSaveExecution),
      tags: uniqueTagNames(selectedTags),
    })
    if (status !== trade.status) setTradeStatus(trade.id, status)
    setOpen(false)
  }

  function updateExecution(index: number, patch: Partial<Execution>) {
    setExecutionRows((prev) => prev.map((execution, i) => (i === index ? { ...execution, ...patch } : execution)))
  }

  function updateExecutionAction(index: number, action: ExecutionAction) {
    const execution = executionRows[index]
    if (!execution) return
    const patch: Partial<Execution> = { action }
    if (action.startsWith('stop')) patch.orderType = 'stop-loss'
    if (action.startsWith('target')) patch.orderType = 'take-profit'
    if (isPositionExecutionAction(action) && execution.quantity == null) patch.quantity = 1
    if (isManagementExecutionAction(action) && execution.anchorPrice == null) patch.anchorPrice = execution.price
    updateExecution(index, patch)
  }

  function stopLabelForIndex(index: number) {
    const hasPriorStop =
      trade.initialStopLoss != null ||
      executionRows.slice(0, index).some((execution) => execution.price != null && (execution.action === 'stop' || execution.action === 'stop-set' || execution.action === 'stop-moved'))
    return hasPriorStop ? 'Move stop' : 'Set stop'
  }

  function toggleExecution(id: string) {
    setExpandedExecutionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function moveExecutionById(sourceId: string, targetId: string) {
    setExecutionRows((prev) => {
      const fromIndex = prev.findIndex((execution) => execution.id === sourceId)
      const toIndex = prev.findIndex((execution) => execution.id === targetId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }

  function startExecutionDrag(event: ReactPointerEvent<HTMLElement>, executionId: string) {
    event.preventDefault()
    draggingExecutionIdRef.current = executionId
    setDraggingExecutionId(executionId)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveExecutionDrag(event: ReactPointerEvent<HTMLElement>) {
    const sourceId = draggingExecutionIdRef.current
    if (!sourceId) return
    event.preventDefault()
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const target = element?.closest<HTMLElement>('[data-execution-id]')
    const targetId = target?.dataset.executionId
    if (targetId && targetId !== sourceId) moveExecutionById(sourceId, targetId)
  }

  function endExecutionDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    draggingExecutionIdRef.current = null
    setDraggingExecutionId(null)
  }

  function updateExecutionDate(index: number, value: string) {
    const execution = executionRows[index]
    if (!execution) return
    const dayStart = parseUtcDate(value)
    if (dayStart == null) return
    const barIndex = timeToBarIndex(execution.time, EXECUTION_TIMEFRAME_MINUTES)
    updateExecution(index, { time: barIndexToTime(dayStart, barIndex, EXECUTION_TIMEFRAME_MINUTES) })
  }

  function updateExecutionBar(index: number, value: string) {
    const execution = executionRows[index]
    if (!execution) return
    const barIndex = Number(value)
    if (!isValidBarIndex(barIndex, EXECUTION_TIMEFRAME_MINUTES)) return
    updateExecution(index, { time: barIndexToTime(utcDayStart(execution.time), barIndex, EXECUTION_TIMEFRAME_MINUTES) })
  }

  function updateExecutionClock(index: number, value: string) {
    const execution = executionRows[index]
    if (!execution) return
    const match = value.match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return
    const minutesInDay = hours * 60 + minutes
    const barIndex = Math.min(barsPerDay(EXECUTION_TIMEFRAME_MINUTES) - 1, Math.round(minutesInDay / EXECUTION_TIMEFRAME_MINUTES))
    updateExecution(index, { time: barIndexToTime(utcDayStart(execution.time), barIndex, EXECUTION_TIMEFRAME_MINUTES) })
  }

  function addExecution() {
    let exitIndex = -1
    for (let i = executionRows.length - 1; i >= 0; i--) {
      if (executionRows[i].action === 'exit') {
        exitIndex = i
        break
      }
    }
    const last = exitIndex > 0 ? executionRows[exitIndex - 1] : executionRows[executionRows.length - 1]
    const next: Execution = {
      id: `ex-manual-${Date.now()}`,
      tradeId: trade.id,
      action: 'undecided',
      orderType: 'stop-loss',
      time: last?.time ?? Date.now(),
    }
    setExecutionRows((prev) => {
      let insertIndex = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].action === 'exit') {
          insertIndex = i
          break
        }
      }
      if (insertIndex < 0) return [...prev, next]
      const rows = [...prev]
      rows.splice(insertIndex, 0, next)
      return rows
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) resetForm()
      }}
    >
      <DialogTrigger render={<Button />}>
        <Pencil data-icon="inline-start" />
        编辑
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑 Trade #{String(trade.seq).padStart(3, '0')}</DialogTitle>
          <DialogDescription>整理基本信息、复盘备注与 executions</DialogDescription>
        </DialogHeader>

        <datalist id="execution-signal-options">
          {SIGNAL_OPTIONS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>

        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="executions">Executions</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-trade-sl">初始止损价</FieldLabel>
                <Input
                  id="edit-trade-sl"
                  type="number"
                  inputMode="decimal"
                  placeholder="未设置"
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                />
                <FieldDescription>R 倍数的计算基准；留空表示未设置（该笔不参与 R 统计）</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-trade-tp">初始止盈价</FieldLabel>
                <Input
                  id="edit-trade-tp"
                  type="number"
                  inputMode="decimal"
                  placeholder="未设置"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel>标签</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {tagDefs.map((def) => {
                    const active = selectedTags.some((tag) => tagNamesEqual(tag, def.name))
                    return (
                      <button key={def.id} type="button" onClick={() => toggleTag(def.name)} className="rounded-full">
                        <Badge
                          className={cn(
                            'cursor-pointer border font-normal transition-all',
                            active
                              ? cn('border-transparent', tagColorClasses[def.color])
                              : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {active && <Check className="size-3" aria-hidden="true" />}
                          {def.name}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="新建标签…"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                        e.preventDefault()
                        handleCreateTag()
                      }
                    }}
                    className="h-8 flex-1"
                  />
                  <div className="flex items-center gap-1" role="radiogroup" aria-label="标签颜色">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={newTagColor === c}
                        aria-label={tagColorNames[c]}
                        onClick={() => setNewTagColor(c)}
                        className={cn(
                          'size-5 rounded-full transition-transform',
                          tagDotClasses[c],
                          newTagColor === c ? 'scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background' : 'opacity-50 hover:opacity-90',
                        )}
                      />
                    ))}
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={handleCreateTag} disabled={!normalizedNewTagName}>
                    <Plus data-icon="inline-start" />
                    添加
                  </Button>
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-trade-note">复盘备注</FieldLabel>
                <Textarea
                  id="edit-trade-note"
                  rows={5}
                  placeholder="这笔交易的执行、情绪与教训…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onPaste={(event) => {
                    const start = event.currentTarget.selectionStart
                    const end = event.currentTarget.selectionEnd
                    void readPastedImage(event).then((dataUrl) => {
                      if (dataUrl) setNote((prev) => insertAtCursor(prev, `[[image:${dataUrl}]]`, start, end))
                    })
                  }}
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="executions">
            <Field>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <FieldLabel>Executions</FieldLabel>
                  <FieldDescription>日期、5m bar 和时间会互相换算；保存时仍写入 UTC 时间。</FieldDescription>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={addExecution}>
                  <Plus data-icon="inline-start" />
                  添加
                </Button>
              </div>
              <div className="mt-3 flex max-h-[48vh] flex-col gap-2 overflow-y-auto rounded-lg border p-2">
                {executionRows.map((execution, index) => {
                  const expanded = expandedExecutionIds.has(execution.id)
                  const actionLabel = execution.action === 'stop' ? stopLabelForIndex(index) : (executionActionLabel[execution.action] ?? execution.action)
                  const currentOrderTypeLabel = orderTypeLabel[execution.orderType] ?? execution.orderType
                  const isPositionAction = isPositionExecutionAction(execution.action)
                  const isManagementAction = isManagementExecutionAction(execution.action)
                  const priceLabel = isManagementAction ? '目标价' : '价格'
                  const summaryPrice = execution.price == null ? '—' : fmtPrice(execution.price)
                  const summary = isPositionAction
                    ? `${actionLabel} · ${execution.quantity ?? '—'} @ ${summaryPrice}`
                    : `${actionLabel} · ${summaryPrice}${execution.anchorPrice == null ? '' : ` · anchor ${fmtPrice(execution.anchorPrice)}`}`
                  return (
                    <div
                      key={execution.id}
                      data-execution-id={execution.id}
                      className={cn(
                        'rounded-md border bg-muted/20 transition-[opacity,background-color]',
                        execution.action === 'undecided' && 'border-yellow-400/50 bg-yellow-400/15',
                        draggingExecutionId === execution.id && 'bg-muted/50 opacity-60',
                      )}
                    >
                      <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 p-2">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label="拖拽排序"
                          className="flex size-8 touch-none cursor-grab select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
                          onPointerDown={(event) => startExecutionDrag(event, execution.id)}
                          onPointerMove={moveExecutionDrag}
                          onPointerUp={endExecutionDrag}
                          onPointerCancel={endExecutionDrag}
                        >
                          <GripVertical className="size-4" />
                        </div>
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-2 text-left"
                          onClick={() => toggleExecution(execution.id)}
                        >
                          {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                          <span className="min-w-0 truncate text-sm font-medium">{summary}</span>
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {currentOrderTypeLabel}
                            {execution.signal ? ` · ${execution.signal}` : ''}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="删除 execution"
                          className="text-muted-foreground"
                          onClick={() => {
                            setExecutionRows((prev) => prev.filter((_, i) => i !== index))
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>

                      {expanded && (
                        <div className="grid grid-cols-2 gap-2 border-t p-2">
                          <div className="col-span-2 grid grid-cols-[1fr_5rem_7rem] gap-2">
                            <Field>
                              <FieldLabel htmlFor={`execution-date-${execution.id}`}>日期</FieldLabel>
                              <Input
                                id={`execution-date-${execution.id}`}
                                type="date"
                                value={fmtUtcDate(execution.time)}
                                onChange={(event) => updateExecutionDate(index, event.target.value)}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`execution-bar-${execution.id}`}>Bar</FieldLabel>
                              <Input
                                id={`execution-bar-${execution.id}`}
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={barsPerDay(EXECUTION_TIMEFRAME_MINUTES) - 1}
                                value={timeToBarIndex(execution.time, EXECUTION_TIMEFRAME_MINUTES)}
                                onChange={(event) => updateExecutionBar(index, event.target.value)}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`execution-clock-${execution.id}`}>时间</FieldLabel>
                              <Input
                                id={`execution-clock-${execution.id}`}
                                type="time"
                                step={EXECUTION_TIMEFRAME_MINUTES * 60}
                                value={fmtUtcTime(execution.time)}
                                onChange={(event) => updateExecutionClock(index, event.target.value)}
                              />
                            </Field>
                          </div>
                          <Field>
                            <FieldLabel htmlFor={`execution-action-${execution.id}`}>Type</FieldLabel>
                            <select
                              id={`execution-action-${execution.id}`}
                              value={execution.action}
                              onChange={(event) => updateExecutionAction(index, event.target.value as ExecutionAction)}
                              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            >
                              {EXECUTION_ACTION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`execution-order-${execution.id}`}>Order</FieldLabel>
                            <select
                              id={`execution-order-${execution.id}`}
                              value={execution.orderType}
                              onChange={(event) => updateExecution(index, { orderType: event.target.value as OrderType })}
                              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            >
                              {ORDER_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`execution-price-${execution.id}`}>{priceLabel}</FieldLabel>
                            <Input
                              id={`execution-price-${execution.id}`}
                              type="number"
                              inputMode="decimal"
                              value={execution.price ?? ''}
                              onChange={(event) => updateExecution(index, { price: optionalNumber(event.target.value) })}
                              placeholder={isManagementAction ? 'Stop / target / order price' : '价格'}
                            />
                          </Field>
                          {isPositionAction ? (
                            <Field>
                              <FieldLabel htmlFor={`execution-quantity-${execution.id}`}>数量</FieldLabel>
                              <Input
                                id={`execution-quantity-${execution.id}`}
                                type="number"
                                inputMode="decimal"
                                value={execution.quantity ?? ''}
                                onChange={(event) => updateExecution(index, { quantity: optionalNumber(event.target.value) })}
                                placeholder="数量"
                              />
                            </Field>
                          ) : (
                            <Field>
                              <FieldLabel htmlFor={`execution-anchor-${execution.id}`}>Anchor price</FieldLabel>
                              <Input
                                id={`execution-anchor-${execution.id}`}
                                type="number"
                                inputMode="decimal"
                                value={execution.anchorPrice ?? ''}
                                onChange={(event) => updateExecution(index, { anchorPrice: optionalNumber(event.target.value) })}
                                placeholder="手动 anchor"
                              />
                            </Field>
                          )}
                          <Field className="col-span-2">
                            <FieldLabel htmlFor={`execution-signal-${execution.id}`}>Signal</FieldLabel>
                            <Input
                              id={`execution-signal-${execution.id}`}
                              list="execution-signal-options"
                              value={execution.signal ?? ''}
                              onChange={(event) => updateExecution(index, { signal: event.target.value || undefined })}
                              placeholder="选择常用 signal 或直接输入"
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Field>
          </TabsContent>
        </Tabs>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="destructive"
              onClick={() => {
                if (window.confirm(`删除 Trade #${trade.seq}？`)) {
                  deleteTrade(trade.id)
                  setOpen(false)
                }
              }}
            >
              <Trash2 data-icon="inline-start" />
              删除
            </Button>
            {trade.status === 'closed' && (
              <Button type="button" variant="outline" onClick={() => setStatus('open')} disabled={status === 'open'}>
                <RotateCcw data-icon="inline-start" />
                {status === 'open' ? '保存后重新打开' : '重新打开'}
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
