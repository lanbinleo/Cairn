'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

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

function toDateInput(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

function fromDateInput(v: string, endOfDay = false): number {
  const ms = Date.parse(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}Z`)
  return Number.isFinite(ms) ? ms : Date.now()
}

export function CreatePeriodDialog({ accountId }: { accountId: string }) {
  const { createPeriod } = useCairn()
  const now = Date.now()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [chartStart, setChartStart] = useState(toDateInput(now))
  const [chartEnd, setChartEnd] = useState(toDateInput(now))
  const [note, setNote] = useState('')

  function resetForm() {
    setName('')
    setChartStart(toDateInput(Date.now()))
    setChartEnd(toDateInput(Date.now()))
    setNote('')
  }

  function handleSave() {
    createPeriod({
      accountId,
      name: name.trim() || '新建 Period',
      chartStart: fromDateInput(chartStart),
      chartEnd: fromDateInput(chartEnd, true),
      symbolIds: [],
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
      <DialogTrigger render={<Button />}>
        <Plus data-icon="inline-start" />
        新建 Period
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Period</DialogTitle>
          <DialogDescription>Period 是一批交易的集合</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-per-name">名称</FieldLabel>
            <Input id="new-per-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-per-cs">图表开始</FieldLabel>
              <Input id="new-per-cs" type="date" value={chartStart} onChange={(e) => setChartStart(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-per-ce">图表结束</FieldLabel>
              <Input id="new-per-ce" type="date" value={chartEnd} onChange={(e) => setChartEnd(e.target.value)} />
            </Field>
          </div>
          <FieldDescription>品种可在导入交易后自动关联，或之后编辑数据补齐</FieldDescription>

          <Field>
            <FieldLabel htmlFor="new-per-note">备注</FieldLabel>
            <Textarea id="new-per-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
