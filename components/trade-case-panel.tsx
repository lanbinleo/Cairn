'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Link2, Plus, Unlink } from 'lucide-react'

import { CaseCardTimeline } from '@/components/case-card-timeline'
import { CaseExecutionSuggestions } from '@/components/case-execution-suggestions'
import { CaseSummaryCard } from '@/components/case-summary-card'
import { CaseTagSuggestions } from '@/components/case-tag-suggestions'
import { BindingSuggestForTrade } from '@/components/binding-suggestions'
import { useConfirm } from '@/components/confirm-dialog-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_PROVENANCE_OPTIONS, caseStatusLabel } from '@/lib/cases'
import { useCairn } from '@/lib/store'
import type { CaseProvenance, Execution, Trade } from '@/lib/types'

/** 复盘侧栏的 Case 单行链接：标题（跳 Case 页）+ 状态；细节都在案例 tab 和时间线里。 */
export function TradeCaseSummaryCard({ trade, onOpenCaseTab }: { trade: Trade; onOpenCaseTab: () => void }) {
  const { cases, caseBindings } = useCairn()
  const binding = caseBindings.find((item) => item.tradeId === trade.id)
  const caseRecord = binding ? cases.find((item) => item.id === binding.caseId) : undefined

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-card px-4 py-2.5 ring-1 ring-foreground/10">
      {caseRecord ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Case</span>
            <Link to={`/cases/${caseRecord.id}`} className="min-w-0 truncate text-sm font-medium transition-colors hover:text-primary">
              {caseRecord.title}
            </Link>
          </div>
          <Badge variant="secondary" className="shrink-0">{caseStatusLabel[caseRecord.status]}</Badge>
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">尚未关联 Case</span>
          <Button variant="ghost" size="sm" onClick={onOpenCaseTab}>
            查看 <ArrowRight data-icon="inline-end" />
          </Button>
        </>
      )}
    </div>
  )
}

export function TradeCasePanel({
  trade,
  targetCardId,
  cardTimes,
  onJumpCard,
  onSuggestEditPrefill,
}: {
  trade: Trade
  targetCardId?: string
  /** 卡片 → 换算时间（Trade 页的 resolveCaseCardTimesForTrade 结果），供建议区显示时间 */
  cardTimes?: Map<string, { time: number; invalid: boolean }>
  /** 建议证据跳卡（Case Tab 内定位） */
  onJumpCard?: (cardId: string) => void
  /** 建议的「修改后添加」：由 Trade 页打开 EditTradeDialog 并预填草稿 */
  onSuggestEditPrefill?: (draft: Execution) => void
}) {
  const {
    cases,
    caseCards,
    caseBindings,
    createCase,
    createCaseBinding,
    deleteCaseBinding,
  } = useCairn()
  const confirm = useConfirm()
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [newTitle, setNewTitle] = useState(`Trade #${String(trade.seq).padStart(3, '0')} Case`)
  const [provenance, setProvenance] = useState<CaseProvenance>('forward')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const binding = caseBindings.find((item) => item.tradeId === trade.id)
  const caseRecord = binding ? cases.find((item) => item.id === binding.caseId) : undefined
  const cards = caseRecord ? caseCards.filter((item) => item.caseId === caseRecord.id) : []
  const relatedCases = useMemo(
    () => cases.filter((item) => item.accountId === trade.accountId && item.periodId === trade.periodId),
    [cases, trade.accountId, trade.periodId],
  )
  const occupiedCaseIds = useMemo(() => new Set(caseBindings.map((item) => item.caseId)), [caseBindings])
  const availableCases = useMemo(
    () => relatedCases.filter((item) => !occupiedCaseIds.has(item.id)).sort((a, b) => b.updatedAt - a.updatedAt),
    [occupiedCaseIds, relatedCases],
  )
  const occupiedCount = relatedCases.length - availableCases.length

  useEffect(() => {
    if (!availableCases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(availableCases[0]?.id ?? '')
  }, [availableCases, selectedCaseId])

  async function bindExistingCase() {
    if (!selectedCaseId) return
    setBusy(true)
    setError('')
    try {
      await createCaseBinding(selectedCaseId, trade.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function createAndBindCase() {
    setBusy(true)
    setError('')
    try {
      const created = createCase({
        accountId: trade.accountId,
        periodId: trade.periodId,
        title: newTitle,
        status: 'active',
        provenance,
        tagIds: [],
      })
      await createCaseBinding(created.id, trade.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function unbindCase() {
    if (!binding || !caseRecord) return
    const ok = await confirm({
      title: `解除 Trade #${String(trade.seq).padStart(3, '0')} 与 Case「${caseRecord.title}」的关联？`,
      confirmText: '解除关联',
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await deleteCaseBinding(binding.id)
      toast.success('已解除关联')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!binding || !caseRecord) {
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">关联已有 Case</CardTitle>
            <CardDescription>只显示当前 Account 和 Period 中尚未被其他 Trade 占用的 Case。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {availableCases.length > 0 ? (
              <>
                <Field>
                  <FieldLabel>Case</FieldLabel>
                  <Select
                    items={availableCases.map((item) => ({ value: item.id, label: item.title }))}
                    value={selectedCaseId}
                    onValueChange={(value) => setSelectedCaseId(value as string)}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableCases.map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {occupiedCount > 0 && <FieldDescription>{occupiedCount} 个 Case 已被其他 Trade 占用。</FieldDescription>}
                </Field>
                <Button disabled={!selectedCaseId || busy} onClick={() => void bindExistingCase()}>
                  <Link2 data-icon="inline-start" />关联已有 Case
                </Button>
                <BindingSuggestForTrade trade={trade} />
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                当前 Account 和 Period 中没有可关联的 Case。
                {occupiedCount > 0 && <span className="mt-1 block">已有的 {occupiedCount} 个 Case 均被其他 Trade 占用。</span>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">新建并关联 Case</CardTitle>
            <CardDescription>新 Case 自动使用当前 Trade 的 Account 和 Period。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="trade-new-case-title">标题</FieldLabel>
              <Input id="trade-new-case-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>记录方式</FieldLabel>
              <Select items={CASE_PROVENANCE_OPTIONS} value={provenance} onValueChange={(value) => setProvenance(value as CaseProvenance)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CASE_PROVENANCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Button disabled={busy} onClick={() => void createAndBindCase()}>
              <Plus data-icon="inline-start" />新建并关联
            </Button>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
            <span className="min-w-0 truncate">{caseRecord.title}</span>
            <Badge variant="secondary">{caseStatusLabel[caseRecord.status]}</Badge>
            <Badge variant="outline">{cards.length} Cards</Badge>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/cases/${caseRecord.id}`} />}>打开 Case 页面</Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => void unbindCase()}
            >
              <Unlink data-icon="inline-start" />解除关联
            </Button>
          </div>
        </CardHeader>
        {error && <p className="px-6 pb-4 text-sm text-destructive" role="alert">{error}</p>}
      </Card>

      <CaseSummaryCard caseRecord={caseRecord} cards={cards} variant="full" trade={trade} />

      <CaseExecutionSuggestions
        trade={trade}
        caseRecord={caseRecord}
        cards={cards}
        cardTimes={cardTimes ?? new Map()}
        onJumpCard={(cardId) => onJumpCard?.(cardId)}
        onEditPrefill={(_suggestion, draft) => onSuggestEditPrefill?.(draft)}
      />

      <CaseTagSuggestions
        trade={trade}
        caseRecord={caseRecord}
        onJumpCard={(cardId) => onJumpCard?.(cardId)}
      />

      <CaseCardTimeline cards={cards} showMoveToCase={false} targetCardId={targetCardId} />
    </div>
  )
}
