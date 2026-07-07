'use client'

import { useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'

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
import { Textarea } from '@/components/ui/textarea'
import { insertAtCursor, readPastedImage } from '@/lib/clipboard-images'
import { useCairn } from '@/lib/store'
import type { Execution, ExecutionAction, OrderType, TagColor, Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

export function EditTradeDialog({ trade }: { trade: Trade }) {
  const { updateTrade, deleteTrade, tagDefs, createTag } = useCairn()
  const [open, setOpen] = useState(false)

  /* 表单状态：打开时从 trade 初始化 */
  const [note, setNote] = useState(trade.note ?? '')
  const [sl, setSl] = useState(trade.initialStopLoss?.toString() ?? '')
  const [executionRows, setExecutionRows] = useState<Execution[]>(trade.executions)
  const [selectedTags, setSelectedTags] = useState<string[]>(trade.tags)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState<TagColor>('blue')

  function resetForm() {
    setNote(trade.note ?? '')
    setSl(trade.initialStopLoss?.toString() ?? '')
    setExecutionRows(trade.executions.map((execution) => ({ ...execution })))
    setSelectedTags(trade.tags)
    setNewTagName('')
    setNewTagColor('blue')
  }

  function toggleTag(name: string) {
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  function handleCreateTag() {
    const def = createTag(newTagName, newTagColor)
    if (def) {
      setSelectedTags((prev) => [...prev, def.name])
      setNewTagName('')
    }
  }

  function handleSave() {
    const parsedSl = sl.trim() === '' ? undefined : Number(sl)
    updateTrade(trade.id, {
      note: note.trim() === '' ? undefined : note.trim(),
      initialStopLoss: parsedSl != null && Number.isFinite(parsedSl) ? parsedSl : undefined,
      executions: executionRows
        .map((execution) => ({
          ...execution,
          tradeId: trade.id,
          price: Number(execution.price),
          quantity: Number(execution.quantity),
        }))
        .filter((execution) => Number.isFinite(execution.time) && Number.isFinite(execution.price) && Number.isFinite(execution.quantity) && execution.quantity > 0),
      tags: selectedTags,
    })
    setOpen(false)
  }

  function updateExecution(index: number, patch: Partial<Execution>) {
    setExecutionRows((prev) => prev.map((execution, i) => (i === index ? { ...execution, ...patch } : execution)))
  }

  function addExecution() {
    const last = executionRows[executionRows.length - 1]
    setExecutionRows((prev) => [
      ...prev,
      {
        id: `ex-manual-${Date.now()}`,
        tradeId: trade.id,
        action: last?.action ?? 'entry',
        orderType: 'market',
        time: last?.time ?? Date.now(),
        price: last?.price ?? 0,
        quantity: last?.quantity ?? 1,
      },
    ])
  }

  function toDateTimeLocal(ms: number) {
    const date = new Date(ms)
    const offsetMs = date.getTimezoneOffset() * 60_000
    return new Date(ms - offsetMs).toISOString().slice(0, 16)
  }

  function fromDateTimeLocal(value: string) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : Date.now()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) resetForm()
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Pencil data-icon="inline-start" />
        编辑
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑 Trade #{String(trade.seq).padStart(3, '0')}</DialogTitle>
          <DialogDescription>补录初始止损、整理标签与复盘备注</DialogDescription>
        </DialogHeader>

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
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Executions</FieldLabel>
              <Button type="button" variant="secondary" size="sm" onClick={addExecution}>
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
            <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
              {executionRows.map((execution, index) => (
                <div key={execution.id} className="grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-2">
                  <Input
                    type="datetime-local"
                    value={toDateTimeLocal(execution.time)}
                    onChange={(event) => updateExecution(index, { time: fromDateTimeLocal(event.target.value) })}
                    className="col-span-2"
                  />
                  <select
                    value={execution.action}
                    onChange={(event) => updateExecution(index, { action: event.target.value as ExecutionAction })}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="entry">entry</option>
                    <option value="scale-in">scale-in</option>
                    <option value="scale-out">scale-out</option>
                    <option value="exit">exit</option>
                  </select>
                  <select
                    value={execution.orderType}
                    onChange={(event) => updateExecution(index, { orderType: event.target.value as OrderType })}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    <option value="market">market</option>
                    <option value="limit">limit</option>
                    <option value="stop">stop</option>
                    <option value="stop-limit">stop-limit</option>
                    <option value="stop-loss">stop-loss</option>
                    <option value="take-profit">take-profit</option>
                    <option value="trailing-stop">trailing-stop</option>
                  </select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={execution.price}
                    onChange={(event) => updateExecution(index, { price: Number(event.target.value) })}
                    placeholder="价格"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={execution.quantity}
                    onChange={(event) => updateExecution(index, { quantity: Number(event.target.value) })}
                    placeholder="数量"
                  />
                  <Input
                    value={execution.signal ?? ''}
                    onChange={(event) => updateExecution(index, { signal: event.target.value || undefined })}
                    placeholder="Signal"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setExecutionRows((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                </div>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel>标签</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {tagDefs.map((def) => {
                const active = selectedTags.includes(def.name)
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
              <Button type="button" variant="secondary" size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-trade-note">复盘备注</FieldLabel>
            <Textarea
              id="edit-trade-note"
              rows={4}
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

        <DialogFooter>
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
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
