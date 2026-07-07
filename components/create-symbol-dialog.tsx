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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCairn } from '@/lib/store'
import type { SymbolCategory } from '@/lib/types'

export function CreateSymbolDialog() {
  const { createSymbol } = useCairn()
  const [open, setOpen] = useState(false)
  const [exchange, setExchange] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SymbolCategory>('crypto')
  const [pricePrecision, setPricePrecision] = useState('2')

  function resetForm() {
    setExchange('')
    setCode('')
    setName('')
    setCategory('crypto')
    setPricePrecision('2')
  }

  function handleSave() {
    const precision = Number(pricePrecision)
    createSymbol({
      exchange: exchange.trim().toUpperCase() || 'CUSTOM',
      code: code.trim().toUpperCase() || 'SYMBOL',
      name: name.trim() || code.trim().toUpperCase() || '新建品种',
      category,
      pricePrecision: Number.isFinite(precision) && precision >= 0 ? precision : 2,
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
      <DialogTrigger render={<Button className="ml-auto" size="sm" />}>
        <Plus data-icon="inline-start" />
        新建品种
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建品种</DialogTitle>
          <DialogDescription>品种以「交易所:代码」唯一标识</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-symbol-exchange">交易所</FieldLabel>
              <Input id="new-symbol-exchange" value={exchange} onChange={(e) => setExchange(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-symbol-code">代码</FieldLabel>
              <Input id="new-symbol-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="new-symbol-name">名称</FieldLabel>
            <Input id="new-symbol-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-symbol-category">类别</FieldLabel>
              <Select
                items={[
                  { value: 'crypto', label: '加密货币' },
                  { value: 'forex', label: '外汇' },
                  { value: 'futures', label: '期货' },
                  { value: 'stock', label: '股票' },
                ]}
                value={category}
                onValueChange={(v) => setCategory(v as SymbolCategory)}
              >
                <SelectTrigger id="new-symbol-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="crypto">加密货币</SelectItem>
                    <SelectItem value="forex">外汇</SelectItem>
                    <SelectItem value="futures">期货</SelectItem>
                    <SelectItem value="stock">股票</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-symbol-precision">价格精度</FieldLabel>
              <Input id="new-symbol-precision" type="number" value={pricePrecision} onChange={(e) => setPricePrecision(e.target.value)} />
            </Field>
          </div>
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
