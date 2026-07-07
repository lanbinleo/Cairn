'use client'

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { TradesTable } from '@/components/trades-table'
import { ManageTagsDialog } from '@/components/manage-tags-dialog'
import { tagColorClasses, tagDotClasses } from '@/components/tag-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

const ALL = 'all'

export default function TradesPage() {
  const { accounts, periods, trades, tagDefs, symbols } = useCairn()
  const [accountId, setAccountId] = useState(ALL)
  const [periodId, setPeriodId] = useState(ALL)
  const [symbolId, setSymbolId] = useState(ALL)
  const [direction, setDirection] = useState(ALL)
  const [activeTags, setActiveTags] = useState<string[]>([])

  const periodOptions = useMemo(
    () => (accountId === ALL ? periods : periods.filter((p) => p.accountId === accountId)),
    [accountId, periods],
  )

  function toggleTag(name: string) {
    setActiveTags((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const filtered = useMemo(
    () =>
      trades.filter(
        (t) =>
          (accountId === ALL || t.accountId === accountId) &&
          (periodId === ALL || t.periodId === periodId) &&
          (symbolId === ALL || t.symbolId === symbolId) &&
          (direction === ALL || t.direction === direction) &&
          (activeTags.length === 0 || activeTags.every((tag) => t.tags.includes(tag))),
      ),
    [trades, accountId, periodId, symbolId, direction, activeTags],
  )

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="交易"
        description="全部账户的交易记录，可筛选后逐笔进入复盘"
        actions={
          <div className="flex items-center gap-2">
            <ManageTagsDialog />
            <Button>
              <Plus data-icon="inline-start" />
              手动录入
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={[
            { value: ALL, label: '全部账户' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          value={accountId}
          onValueChange={(v) => {
            setAccountId(v as string)
            setPeriodId(ALL)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="账户" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部账户</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '全部 Period' },
            ...periodOptions.map((p) => ({ value: p.id, label: p.name })),
          ]}
          value={periodId}
          onValueChange={(v) => setPeriodId(v as string)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部 Period</SelectItem>
              {periodOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '全部品种' },
            ...symbols.map((s) => ({ value: s.id, label: `${s.exchange}:${s.code}` })),
          ]}
          value={symbolId}
          onValueChange={(v) => setSymbolId(v as string)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="品种" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部品种</SelectItem>
              {symbols.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.exchange}:{s.code}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '多空' },
            { value: 'long', label: '仅多' },
            { value: 'short', label: '仅空' },
          ]}
          value={direction}
          onValueChange={(v) => setDirection(v as string)}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="方向" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>多空</SelectItem>
              <SelectItem value="long">仅多</SelectItem>
              <SelectItem value="short">仅空</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} 笔交易</span>
      </div>

      {tagDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按标签筛选">
          {tagDefs.map((tag) => {
            const active = activeTags.includes(tag.name)
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag.name)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                  active
                    ? cn(tagColorClasses[tag.color], 'ring-1 ring-current/30')
                    : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', tagDotClasses[tag.color])} aria-hidden="true" />
                {tag.name}
              </button>
            )
          })}
          {activeTags.length > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setActiveTags([])}>
              <X data-icon="inline-start" />
              清除
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent>
          <TradesTable trades={filtered} showContext />
        </CardContent>
      </Card>
    </div>
  )
}
