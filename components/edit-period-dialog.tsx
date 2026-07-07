'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'

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
import { useCairn } from '@/lib/store'
import type { Period } from '@/lib/types'

/** ms → yyyy-MM-dd（UTC） */
function toDateInput(ms?: number) {
  if (ms == null) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/** yyyy-MM-dd → UTC ms（endOfDay 时取当天 23:59:59） */
function fromDateInput(v: string, endOfDay = false): number | undefined {
  if (!v) return undefined
  const ms = Date.parse(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}Z`)
  return Number.isFinite(ms) ? ms : undefined
}

export function EditPeriodDialog({
  period,
  size = 'default',
}: {
  period: Period
  size?: 'default' | 'icon-sm'
}) {
  const { updatePeriod, deletePeriod } = useCairn()
  const [open, setOpen] = useState(false)

  const [name, setName] = useState(period.name)
  const [chartStart, setChartStart] = useState(toDateInput(period.chartStart))
  const [chartEnd, setChartEnd] = useState(toDateInput(period.chartEnd))
  const [realStart, setRealStart] = useState(toDateInput(period.realStart))
  const [realEnd, setRealEnd] = useState(toDateInput(period.realEnd))
  const [note, setNote] = useState(period.note ?? '')

  function resetForm() {
    setName(period.name)
    setChartStart(toDateInput(period.chartStart))
    setChartEnd(toDateInput(period.chartEnd))
    setRealStart(toDateInput(period.realStart))
    setRealEnd(toDateInput(period.realEnd))
    setNote(period.note ?? '')
  }

  function handleSave() {
    updatePeriod(period.id, {
      name: name.trim() || period.name,
      chartStart: fromDateInput(chartStart) ?? period.chartStart,
      chartEnd: fromDateInput(chartEnd, true) ?? period.chartEnd,
      realStart: fromDateInput(realStart),
      realEnd: fromDateInput(realEnd, true),
      note: note.trim() === '' ? undefined : note.trim(),
    })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) resetForm()
      }}
    >
      <DialogTrigger
        render={
          size === 'icon-sm' ? (
            <Button variant="ghost" size="icon-sm" aria-label={`编辑 Period ${period.name}`} />
          ) : (
            <Button variant="outline" />
          )
        }
      >
        <Pencil data-icon={size === 'icon-sm' ? undefined : 'inline-start'} />
        {size !== 'icon-sm' && '编辑 Period'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑 Period</DialogTitle>
          <DialogDescription>图表时间为 K 线所处的历史区间，真实时间为实际操作日期</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-per-name">名称</FieldLabel>
            <Input id="edit-per-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="edit-per-cs">图表开始</FieldLabel>
              <Input id="edit-per-cs" type="date" value={chartStart} onChange={(e) => setChartStart(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-per-ce">图表结束</FieldLabel>
              <Input id="edit-per-ce" type="date" value={chartEnd} onChange={(e) => setChartEnd(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="edit-per-rs">真实开始</FieldLabel>
              <Input id="edit-per-rs" type="date" value={realStart} onChange={(e) => setRealStart(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-per-re">真实结束</FieldLabel>
              <Input id="edit-per-re" type="date" value={realEnd} onChange={(e) => setRealEnd(e.target.value)} />
            </Field>
          </div>
          <FieldDescription>真实时间可留空（例如纯回放场景不关心操作日期）</FieldDescription>

          <Field>
            <FieldLabel htmlFor="edit-per-note">备注</FieldLabel>
            <Textarea id="edit-per-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => {
              if (window.confirm(`删除 Period「${period.name}」？相关 Trade 也会删除。`)) {
                deletePeriod(period.id)
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
