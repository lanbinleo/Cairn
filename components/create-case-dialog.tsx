'use client'

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_PROVENANCE_OPTIONS } from '@/lib/cases'
import { useCairn } from '@/lib/store'
import type { CaseProvenance } from '@/lib/types'

export function CreateCaseDialog() {
  const navigate = useNavigate()
  const { accounts, periods, createCase } = useCairn()
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const periodOptions = useMemo(() => periods.filter((period) => period.accountId === accountId), [accountId, periods])
  const [periodId, setPeriodId] = useState(periodOptions[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [provenance, setProvenance] = useState<CaseProvenance>('forward')
  const canCreate = Boolean(accountId && periodId)

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
  }, [accountId, accounts])

  useEffect(() => {
    if (!periodOptions.some((period) => period.id === periodId)) setPeriodId(periodOptions[0]?.id ?? '')
  }, [periodId, periodOptions])

  function resetForm() {
    const nextAccountId = accounts[0]?.id ?? ''
    setAccountId(nextAccountId)
    setPeriodId(periods.find((period) => period.accountId === nextAccountId)?.id ?? '')
    setTitle('')
    setProvenance('forward')
  }

  function handleCreate() {
    if (!canCreate) return
    const created = createCase({
      accountId,
      periodId,
      title: title.trim() || `Case ${new Date().toLocaleDateString('zh-CN')}`,
      status: 'active',
      provenance,
      tagIds: [],
    })
    setOpen(false)
    navigate(`/cases/${created.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) resetForm()
      }}
    >
      <DialogTrigger render={<Button disabled={accounts.length === 0 || periods.length === 0} />}>
        <Plus data-icon="inline-start" />
        新建 Case
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Case</DialogTitle>
          <DialogDescription>Case 可以先记录，之后再与一个 Trade 建立一对一关联。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Account</FieldLabel>
            <Select
              items={accounts.map((account) => ({ value: account.id, label: account.name }))}
              value={accountId}
              onValueChange={(value) => {
                const nextAccountId = value as string
                setAccountId(nextAccountId)
                setPeriodId(periods.find((period) => period.accountId === nextAccountId)?.id ?? '')
              }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Period</FieldLabel>
            <Select
              items={periodOptions.map((period) => ({ value: period.id, label: period.name }))}
              value={periodId}
              onValueChange={(value) => setPeriodId(value as string)}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{periodOptions.map((period) => <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-case-title">标题</FieldLabel>
            <Input id="new-case-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：开盘区间后的二次入场" />
          </Field>
          <Field>
            <FieldLabel>记录方式</FieldLabel>
            <Select items={CASE_PROVENANCE_OPTIONS} value={provenance} onValueChange={(value) => setProvenance(value as CaseProvenance)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{CASE_PROVENANCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button disabled={!canCreate} onClick={handleCreate}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
