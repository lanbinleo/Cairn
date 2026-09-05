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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCairn } from '@/lib/store'
import { parseFeePctInput } from '@/lib/fee'
import type { AccountKind } from '@/lib/types'

export function CreateAccountDialog() {
  const { createAccount } = useCairn()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('backtest')
  const [balance, setBalance] = useState('100000')
  const [currency, setCurrency] = useState('USD')
  const [takerFee, setTakerFee] = useState('')
  const [makerFee, setMakerFee] = useState('')
  const [note, setNote] = useState('')

  function resetForm() {
    setName('')
    setKind('backtest')
    setBalance('100000')
    setCurrency('USD')
    setTakerFee('')
    setMakerFee('')
    setNote('')
  }

  function handleSave() {
    const parsed = Number(balance)
    createAccount({
      name: name.trim() || '新建账户',
      kind,
      initialBalance: Number.isFinite(parsed) && parsed > 0 ? parsed : 100000,
      currency: currency.trim().toUpperCase() || 'USD',
      takerFeePct: parseFeePctInput(takerFee),
      makerFeePct: parseFeePctInput(makerFee),
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
        新建账户
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建账户</DialogTitle>
          <DialogDescription>账户是一个独立的交易环境 / 账本</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-acc-name">名称</FieldLabel>
            <Input id="new-acc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field>
            <FieldLabel>类型</FieldLabel>
            <ToggleGroup
              value={[kind]}
              onValueChange={(v: string[]) => {
                if (v[0]) setKind(v[0] as AccountKind)
              }}
              className="w-fit"
            >
              <ToggleGroupItem value="backtest">回测</ToggleGroupItem>
              <ToggleGroupItem value="live">实盘</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-acc-balance">初始资金</FieldLabel>
              <Input id="new-acc-balance" type="number" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-acc-currency">货币</FieldLabel>
              <Input id="new-acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-acc-taker-fee">Taker 费率 %</FieldLabel>
              <Input id="new-acc-taker-fee" type="number" inputMode="decimal" placeholder="如 0.05" value={takerFee} onChange={(e) => setTakerFee(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-acc-maker-fee">Maker 费率 %</FieldLabel>
              <Input id="new-acc-maker-fee" type="number" inputMode="decimal" placeholder="如 0.02" value={makerFee} onChange={(e) => setMakerFee(e.target.value)} />
            </Field>
          </div>
          <FieldDescription>按成交额逐笔计提（开平双边），PnL 与统计按净额；留空不计</FieldDescription>
          <FieldDescription>创建后会立即写入本地数据库</FieldDescription>

          <Field>
            <FieldLabel htmlFor="new-acc-note">备注</FieldLabel>
            <Textarea id="new-acc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
