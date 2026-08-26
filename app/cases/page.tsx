'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Link2, X } from 'lucide-react'

import { CreateCaseDialog } from '@/components/create-case-dialog'
import { ManageCaseTagsDialog } from '@/components/manage-case-tags-dialog'
import { PageHeader } from '@/components/page-header'
import { tagColorClasses, tagDotClasses } from '@/components/tag-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_PROVENANCE_OPTIONS, CASE_STATUS_OPTIONS, caseProvenanceLabel, caseStatusLabel } from '@/lib/cases'
import { fmtUtcDateTime } from '@/lib/format'
import { useCairn } from '@/lib/store'
import { sortTagDefsByColor } from '@/lib/tags'
import type { CaseProvenance, CaseStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const ALL = 'all'

export default function CasesPage() {
  const navigate = useNavigate()
  const { accounts, periods, cases, caseCards, caseBindings, caseTagDefs, trades } = useCairn()
  const [accountId, setAccountId] = useState(ALL)
  const [periodId, setPeriodId] = useState(ALL)
  const [status, setStatus] = useState<CaseStatus | typeof ALL>(ALL)
  const [provenance, setProvenance] = useState<CaseProvenance | typeof ALL>(ALL)
  const [bindingState, setBindingState] = useState<'all' | 'bound' | 'unbound'>('all')
  const [activeTagIds, setActiveTagIds] = useState<string[]>([])

  const periodOptions = useMemo(
    () => accountId === ALL ? periods : periods.filter((period) => period.accountId === accountId),
    [accountId, periods],
  )
  const boundCaseIds = useMemo(() => new Set(caseBindings.map((binding) => binding.caseId)), [caseBindings])
  const sortedTagDefs = useMemo(
    () => sortTagDefsByColor(caseTagDefs),
    [caseTagDefs],
  )

  useEffect(() => {
    const available = new Set(caseTagDefs.map((tag) => tag.id))
    setActiveTagIds((prev) => prev.filter((id) => available.has(id)))
  }, [caseTagDefs])

  const filtered = useMemo(
    () => cases
      .filter((caseRecord) => {
        const isBound = boundCaseIds.has(caseRecord.id)
        return (
          (accountId === ALL || caseRecord.accountId === accountId) &&
          (periodId === ALL || caseRecord.periodId === periodId) &&
          (status === ALL || caseRecord.status === status) &&
          (provenance === ALL || caseRecord.provenance === provenance) &&
          (bindingState === 'all' || (bindingState === 'bound' ? isBound : !isBound)) &&
          (activeTagIds.length === 0 || activeTagIds.every((tagId) => caseRecord.tagIds.includes(tagId)))
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [accountId, activeTagIds, bindingState, boundCaseIds, cases, periodId, provenance, status],
  )

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="Cases"
        description="记录交易发生前后连续的观察、判断、计划和复盘"
        actions={<div className="flex items-center gap-2"><ManageCaseTagsDialog /><CreateCaseDialog /></div>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={[{ value: ALL, label: '全部账户' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          value={accountId}
          onValueChange={(value) => {
            setAccountId(value as string)
            setPeriodId(ALL)
          }}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value={ALL}>全部账户</SelectItem>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select
          items={[{ value: ALL, label: '全部 Period' }, ...periodOptions.map((period) => ({ value: period.id, label: period.name }))]}
          value={periodId}
          onValueChange={(value) => setPeriodId(value as string)}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value={ALL}>全部 Period</SelectItem>{periodOptions.map((period) => <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select
          items={[{ value: ALL, label: '全部状态' }, ...CASE_STATUS_OPTIONS]}
          value={status}
          onValueChange={(value) => setStatus(value as CaseStatus | typeof ALL)}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value={ALL}>全部状态</SelectItem>{CASE_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select
          items={[{ value: ALL, label: '全部记录方式' }, ...CASE_PROVENANCE_OPTIONS]}
          value={provenance}
          onValueChange={(value) => setProvenance(value as CaseProvenance | typeof ALL)}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value={ALL}>全部记录方式</SelectItem>{CASE_PROVENANCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select
          items={[{ value: 'all', label: '全部关联状态' }, { value: 'bound', label: '已关联 Trade' }, { value: 'unbound', label: '未关联' }]}
          value={bindingState}
          onValueChange={(value) => setBindingState(value as typeof bindingState)}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">全部关联状态</SelectItem><SelectItem value="bound">已关联 Trade</SelectItem><SelectItem value="unbound">未关联</SelectItem></SelectGroup></SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} 个 Case</span>
      </div>

      {caseTagDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按 Case 标签筛选">
          {sortedTagDefs.map((tag) => {
            const active = activeTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTagIds((prev) => active ? prev.filter((id) => id !== tag.id) : [...prev, tag.id])}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                  active ? cn(tagColorClasses[tag.color], 'ring-1 ring-current/30') : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', tagDotClasses[tag.color])} />
                {tag.name}
              </button>
            )
          })}
          {activeTagIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => setActiveTagIds([])}><X data-icon="inline-start" />清除</Button>}
        </div>
      )}

      {accounts.length === 0 || periods.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">创建 Case 前需要先建立 Account 和 Period。</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">当前筛选下没有 Case。</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((caseRecord) => {
            const account = accounts.find((item) => item.id === caseRecord.accountId)
            const period = periods.find((item) => item.id === caseRecord.periodId)
            const binding = caseBindings.find((item) => item.caseId === caseRecord.id)
            const cardCount = caseCards.filter((card) => card.caseId === caseRecord.id).length
            return (
              <Card key={caseRecord.id} className="transition-colors hover:border-primary/40">
                <CardContent
                  className="flex cursor-pointer flex-wrap items-center gap-4 py-3"
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/cases/${caseRecord.id}`)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/cases/${caseRecord.id}`) } }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/cases/${caseRecord.id}`} className="font-medium hover:text-primary">{caseRecord.title}</Link>
                      <Badge variant="outline">{caseStatusLabel[caseRecord.status]}</Badge>
                      <Badge variant={caseRecord.provenance === 'forward' ? 'secondary' : 'outline'}>{caseProvenanceLabel[caseRecord.provenance]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{account?.name ?? '未知账户'} · {period?.name ?? '未知 Period'} · 更新于 {fmtUtcDateTime(caseRecord.updatedAt)}</p>
                    {caseRecord.tagIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {caseRecord.tagIds.map((tagId) => {
                          const tag = caseTagDefs.find((item) => item.id === tagId)
                          return tag ? <span key={tag.id} className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', tagColorClasses[tag.color])}>{tag.name}</span> : null
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span>{cardCount} Cards</span>
                    {binding ? (() => {
                      const trade = trades.find((item) => item.id === binding.tradeId)
                      return <Link to={`/trades/${binding.tradeId}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300" title={trade ? `打开 Trade #${trade.seq}` : '打开已关联 Trade'}><CheckCircle2 className="size-3.5" />已关联 Trade</Link>
                    })() : <span className="inline-flex items-center gap-1.5 rounded-full border border-muted-foreground/25 bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground"><Link2 className="size-3.5" />未关联 Trade</span>}
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
