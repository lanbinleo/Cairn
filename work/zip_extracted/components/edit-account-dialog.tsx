'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'

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
import type { Account, AccountKind } from '@/lib/types'

export function EditAccountDialog({
  account,
  size = 'default',
}: {
  account: Account
  size?: 'default' | 'icon-sm'
}) {
  const { updateAccount } = useCairn()
  const [open, setOpen] = useState(false)

  const [name, setName] = useState(account.name)
  const [kind, setKind] = useState<AccountKind>(account.kind)
  const [balance, setBalance] = useState(String(account.initialBalance))
  const [currency, setCurrency] = useState(account.currency)
  const [note, setNote] = useState(account.note ?? '')

  function resetForm() {
    setName(account.name)
    setKind(account.kind)
    setBalance(String(account.initialBalance))
    setCurrency(account.currency)
    setNote(account.note ?? '')
  }

  function handleSave() {
    const parsed = Number(balance)
    updateAccount(account.id, {
      name: name.trim() || account.name,
      kind,
      initialBalance: Number.isFinite(parsed) && parsed > 0 ? parsed : account.initialBalance,
      currency: currency.trim().toUpperCase() || account.currency,
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
            <Button variant="ghost" size="icon-sm" aria-label={`编辑账户 ${account.name}`} />
          ) : (
            <Button variant="outline" />
          )
        }
      >
        <Pencil data-icon={size === 'icon-sm' ? undefined : 'inline-start'} />
        {size !== 'icon-sm' && '编辑账户'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑账户</DialogTitle>
          <DialogDescription>账户是一个独立的交易环境 / 账本</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-acc-name">名称</FieldLabel>
            <Input id="edit-acc-name" value={name} onChange={(e) => setName(e.target.value)} />
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
              <FieldLabel htmlFor="edit-acc-balance">初始资金</FieldLabel>
              <Input
                id="edit-acc-balance"
                type="number"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-acc-currency">货币</FieldLabel>
              <Input id="edit-acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
          </div>
          <FieldDescription>修改初始资金会重算所有统计与资金曲线</FieldDescription>

          <Field>
            <FieldLabel htmlFor="edit-acc-note">备注</FieldLabel>
            <Textarea id="edit-acc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
