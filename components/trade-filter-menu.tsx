'use client'

import { useEffect, useState } from 'react'
import { Filter, SlidersHorizontal, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  EMPTY_TRADE_FILTER,
  isTradeFilterEmpty,
  removeTradeFilterKey,
  tradeFilterChips,
  type TradeFilterConditions,
  type TradeFilterPreset,
} from '@/lib/trade-filters'
import { cn } from '@/lib/utils'

const FLAG_ITEMS: Array<{ key: keyof TradeFilterConditions; label: string }> = [
  { key: 'flagUnscored', label: '未评分' },
  { key: 'flagScored', label: '已评分' },
  { key: 'flagExitOffPlan', label: '出场未按计划' },
  { key: 'flagStopWidened', label: '止损有放宽' },
  { key: 'flagNoInitialStop', label: '缺初始止损' },
]

function NumberField({ label, value, onChange, placeholder }: {
  label: string
  value: number | undefined
  onChange: (next: number | undefined) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="h-8 w-24"
        inputMode="decimal"
        value={value == null ? '' : String(value)}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value.trim()
          if (text === '') return onChange(undefined)
          const parsed = Number(text)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </div>
  )
}

/**
 * 交易列表高级筛选：下拉菜单（快捷开关 + 预设）+ 条件编辑 / 预设管理对话框。
 * 预设是设备级偏好（localStorage），条件模型见 lib/trade-filters.ts。
 */
export function TradeFilterMenu({ conditions, onChange, presets, onSavePreset, onDeletePreset }: {
  conditions: TradeFilterConditions
  onChange: (next: TradeFilterConditions) => void
  presets: TradeFilterPreset[]
  onSavePreset: (name: string, conditions: TradeFilterConditions) => void
  onDeletePreset: (id: string) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [draft, setDraft] = useState<TradeFilterConditions>(conditions)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    if (editOpen) setDraft(conditions)
  }, [editOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = tradeFilterChips(conditions).length

  function toggleFlag(key: keyof TradeFilterConditions, checked: boolean) {
    const next = { ...conditions }
    if (checked) (next as Record<string, unknown>)[key] = true
    else delete (next as Record<string, unknown>)[key]
    onChange(next)
  }

  function setStatus(status: 'open' | 'closed', checked: boolean) {
    const next = { ...conditions }
    if (checked) next.status = status
    else if (next.status === status) delete next.status
    onChange(next)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" className={cn(activeCount > 0 && 'border-ring/60 text-foreground')}>
              <Filter data-icon="inline-start" />
              高级筛选{activeCount > 0 ? ` · ${activeCount}` : ''}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          {presets.length > 0 && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>筛选预设</DropdownMenuLabel>
                {presets.map((preset) => (
                  <DropdownMenuItem key={preset.id} onClick={() => onChange(preset.conditions)}>
                    {preset.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuLabel>快捷条件</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={conditions.status === 'closed'} onCheckedChange={(checked) => setStatus('closed', checked === true)}>
              仅已平仓
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={conditions.status === 'open'} onCheckedChange={(checked) => setStatus('open', checked === true)}>
              仅持仓中
            </DropdownMenuCheckboxItem>
            {FLAG_ITEMS.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.key}
                checked={conditions[item.key] === true}
                onCheckedChange={(checked) => toggleFlag(item.key, checked === true)}
              >
                {item.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <SlidersHorizontal data-icon="inline-start" />
            编辑条件…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setManageOpen(true)}>管理筛选预设…</DropdownMenuItem>
          {!isTradeFilterEmpty(conditions) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onChange(EMPTY_TRADE_FILTER)}>清除高级筛选</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>高级筛选条件</DialogTitle>
            <DialogDescription>R 与过程分按区间过滤；缺数据的交易会被区间条件排除。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <NumberField label="R ≥" value={draft.rMin} onChange={(rMin) => setDraft((prev) => ({ ...prev, rMin }))} placeholder="如 -1" />
              <NumberField label="R ≤" value={draft.rMax} onChange={(rMax) => setDraft((prev) => ({ ...prev, rMax }))} placeholder="如 3" />
              <NumberField label="过程分 ≥" value={draft.scoreMin} onChange={(scoreMin) => setDraft((prev) => ({ ...prev, scoreMin }))} placeholder="0-10" />
              <NumberField label="过程分 ≤" value={draft.scoreMax} onChange={(scoreMax) => setDraft((prev) => ({ ...prev, scoreMax }))} placeholder="0-10" />
            </div>
            <div className="flex flex-col gap-2.5 rounded-lg border p-3">
              {FLAG_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{item.label}</span>
                  <Switch
                    checked={draft[item.key] === true}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => {
                        const next = { ...prev }
                        if (checked) (next as Record<string, unknown>)[item.key] = true
                        else delete (next as Record<string, unknown>)[item.key]
                        return next
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 flex-1"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="预设名称，如「过程分 ≥ 8」"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isTradeFilterEmpty(draft) || presetName.trim() === ''}
                onClick={() => {
                  onSavePreset(presetName.trim(), draft)
                  setPresetName('')
                }}
              >
                存为预设
              </Button>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
            <Button onClick={() => { onChange(draft); setEditOpen(false) }}>应用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>管理筛选预设</DialogTitle>
            <DialogDescription>预设保存在本机（localStorage），不随备份同步。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有预设。在「编辑条件」里保存当前条件为预设。</p>
            ) : (
              presets.map((preset) => (
                <div key={preset.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{preset.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tradeFilterChips(preset.conditions).map((chip) => chip.label).join(' · ') || '无条件'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onChange(preset.conditions)
                        setManageOpen(false)
                      }}
                    >
                      应用
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`删除预设 ${preset.name}`} onClick={() => onDeletePreset(preset.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 已激活条件 chips：逐项移除 + 一键清除 */
export function TradeFilterChips({ conditions, onChange }: {
  conditions: TradeFilterConditions
  onChange: (next: TradeFilterConditions) => void
}) {
  const chips = tradeFilterChips(conditions)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border bg-muted/60 py-0.5 pr-1 pl-2.5 text-xs">
          {chip.label}
          <button
            type="button"
            aria-label={`移除条件 ${chip.label}`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={() => onChange(removeTradeFilterKey(conditions, chip.key))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button type="button" className="px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => onChange(EMPTY_TRADE_FILTER)}>
        清除全部
      </button>
    </div>
  )
}
