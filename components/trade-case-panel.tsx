'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Link2, Plus, Unlink } from 'lucide-react'

import { CaseTagBadge } from '@/components/case-tag-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CASE_PHASE_OPTIONS,
  CASE_PROVENANCE_OPTIONS,
  caseEntryDecisionLabel,
  casePhaseLabel,
  caseProvenanceLabel,
  caseStatusLabel,
  displayPhaseForCaseCard,
} from '@/lib/cases'
import { fmtUtcDateTime } from '@/lib/format'
import { useCairn } from '@/lib/store'
import type { CaseCardPhase, CaseProvenance, Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

const PHASE_TONES: Record<CaseCardPhase, string> = {
  'pre-entry': 'border-blue-500/25 bg-blue-500/5',
  entry: 'border-emerald-500/25 bg-emerald-500/5',
  intermediate: 'border-amber-500/25 bg-amber-500/5',
  closing: 'border-rose-500/25 bg-rose-500/5',
  reflection: 'border-violet-500/25 bg-violet-500/5',
}

export function TradeCaseSummaryCard({ trade, onOpenCaseTab }: { trade: Trade; onOpenCaseTab: () => void }) {
  const { cases, caseCards, caseBindings } = useCairn()
  const binding = caseBindings.find((item) => item.tradeId === trade.id)
  const caseRecord = binding ? cases.find((item) => item.id === binding.caseId) : undefined
  const cards = caseRecord ? caseCards.filter((item) => item.caseId === caseRecord.id) : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Case</CardTitle>
          <Button variant="ghost" size="sm" onClick={onOpenCaseTab}>
            查看 <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {caseRecord ? (
          <div className="flex flex-col gap-3">
            <div>
              <Link to={`/cases/${caseRecord.id}`} className="font-medium hover:text-primary">{caseRecord.title}</Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {caseStatusLabel[caseRecord.status]} · {caseProvenanceLabel[caseRecord.provenance]} · {cards.length} Cards
              </p>
            </div>
            {caseRecord.tagIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {caseRecord.tagIds.map((tagId) => <CaseTagBadge key={tagId} tagId={tagId} />)}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {cards.filter((card) => card.barRef != null).map((card) => <Badge key={card.id} variant="outline">BAR {card.barRef}</Badge>)}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">尚未关联 Case</p>
        )}
      </CardContent>
    </Card>
  )
}

export function TradeCasePanel({ trade, targetCardId }: { trade: Trade; targetCardId?: string }) {
  const {
    cases,
    caseCards,
    caseBindings,
    createCase,
    createCaseBinding,
    deleteCaseBinding,
  } = useCairn()
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
  const groupedCards = useMemo(() => {
    const groups: Record<CaseCardPhase, typeof cards> = {
      'pre-entry': [],
      entry: [],
      intermediate: [],
      closing: [],
      reflection: [],
    }
    for (const card of cards) groups[displayPhaseForCaseCard(card)].push(card)
    return groups
  }, [cards])

  useEffect(() => {
    if (!availableCases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(availableCases[0]?.id ?? '')
  }, [availableCases, selectedCaseId])

  useEffect(() => {
    if (!targetCardId || !caseRecord) return
    requestAnimationFrame(() => {
      document.getElementById(`trade-case-card-${targetCardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [caseRecord, targetCardId])

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
    if (!window.confirm(`解除 Trade #${String(trade.seq).padStart(3, '0')} 与 Case「${caseRecord.title}」的关联？`)) return
    setBusy(true)
    setError('')
    try {
      await deleteCaseBinding(binding.id)
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
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>{caseRecord.title}</CardTitle>
              <CardDescription className="mt-1">
                {caseStatusLabel[caseRecord.status]} · {caseProvenanceLabel[caseRecord.provenance]} · {cards.length} Cards
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" nativeButton={false} render={<Link to={`/cases/${caseRecord.id}`} />}>打开 Case 页面</Button>
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() => void unbindCase()}
              >
                <Unlink data-icon="inline-start" />解除关联
              </Button>
            </div>
          </div>
        </CardHeader>
        {caseRecord.tagIds.length > 0 && (
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {caseRecord.tagIds.map((tagId) => <CaseTagBadge key={tagId} tagId={tagId} />)}
          </CardContent>
        )}
        {error && <p className="px-6 pb-4 text-sm text-destructive" role="alert">{error}</p>}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">心路历程</CardTitle>
          <CardDescription>与 Case 页面使用同一组原始 Cards；文字修正通过新增说明保存。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {cards.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">这个 Case 还没有 Card。</div>
          ) : CASE_PHASE_OPTIONS.map((option) => {
            const phaseCards = groupedCards[option.value]
            if (phaseCards.length === 0) return null
            return (
              <section key={option.value} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{option.label}</h2>
                  <Badge variant="outline">{phaseCards.length}</Badge>
                </div>
                {phaseCards.map((card) => (
                  <article
                    id={`trade-case-card-${card.id}`}
                    key={card.id}
                    className={cn(
                      'scroll-mt-28 rounded-lg border p-4 transition-shadow',
                      PHASE_TONES[option.value],
                      targetCardId === card.id && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{casePhaseLabel[card.phase]}</Badge>
                        {card.entryDecision && <Badge variant="secondary">{caseEntryDecisionLabel[card.entryDecision]}</Badge>}
                        {card.phase !== option.value && <span className="text-xs text-muted-foreground">展示于 {option.label}</span>}
                        {card.barRef != null && <Badge variant="outline">BAR {card.barRef}</Badge>}
                      </div>
                      <time className="font-mono text-xs text-muted-foreground">{fmtUtcDateTime(card.createdAt)}</time>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{card.rawText}</p>
                  </article>
                ))}
              </section>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
