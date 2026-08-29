'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Link2, Plus, Trash2, WandSparkles } from 'lucide-react'

import { CaseTagBadge } from '@/components/case-tag-badge'
import { CaseCardTimeline } from '@/components/case-card-timeline'
import { CaseSummaryCard } from '@/components/case-summary-card'
import { BindingSuggestForCase } from '@/components/binding-suggestions'
import { ManageCaseTagsDialog } from '@/components/manage-case-tags-dialog'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  CASE_ENTRY_DECISION_OPTIONS,
  CASE_PHASE_OPTIONS,
  CASE_PHASE_PROMPTS,
  CASE_PROVENANCE_OPTIONS,
  CASE_STATUS_OPTIONS,
  casePhaseLabel,
  caseProvenanceLabel,
  caseStatusLabel,
  displayPhaseForCaseCard,
  extractExplicitBarRef,
} from '@/lib/cases'
import { draftCaseTitle } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import { sortTagDefsByColor } from '@/lib/tags'
import type { CaseCardPhase, CaseEntryDecision, CaseProvenance, CaseStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const PHASE_TONES: Record<CaseCardPhase, string> = {
  'pre-entry': 'border-blue-500/25 bg-blue-500/5',
  entry: 'border-emerald-500/25 bg-emerald-500/5',
  intermediate: 'border-amber-500/25 bg-amber-500/5',
  closing: 'border-rose-500/25 bg-rose-500/5',
  reflection: 'border-violet-500/25 bg-violet-500/5',
}

export default function CaseDetailPage() {
  const { caseId = '' } = useParams()
  const navigate = useNavigate()
  const {
    accounts,
    periods,
    trades,
    cases,
    caseTagDefs,
    getCase,
    getCaseCards,
    getCaseBinding,
    updateCase,
    deleteCase,
    createCaseCard,
  } = useCairn()
  const caseRecord = getCase(caseId)
  const [titleDraft, setTitleDraft] = useState('')
  const [phase, setPhase] = useState<CaseCardPhase>('pre-entry')
  const [entryDecision, setEntryDecision] = useState<CaseEntryDecision>('pending')
  const [barNumber, setBarNumber] = useState('')
  const [barError, setBarError] = useState<string | null>(null)
  const [rawText, setRawText] = useState('')
  const [newCardOpen, setNewCardOpen] = useState(false)
  const [titleDrafting, setTitleDrafting] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const cards = getCaseCards(caseId)
  const sortedCaseTagDefs = useMemo(() => sortTagDefsByColor(caseTagDefs), [caseTagDefs])
  const phaseCounts = useMemo(() => {
    const counts: Record<CaseCardPhase, number> = {
      'pre-entry': 0,
      entry: 0,
      intermediate: 0,
      closing: 0,
      reflection: 0,
    }
    for (const card of cards) counts[displayPhaseForCaseCard(card)] += 1
    return counts
  }, [cards])
  useEffect(() => {
    setTitleDraft(caseRecord?.title ?? '')
  }, [caseRecord?.id, caseRecord?.title])
  if (!caseRecord) return <Navigate to="/cases" replace />
  const activeCase = caseRecord
  const binding = getCaseBinding(activeCase.id)
  const boundTrade = binding ? trades.find((trade) => trade.id === binding.tradeId) : undefined
  const account = accounts.find((item) => item.id === activeCase.accountId)
  const period = periods.find((item) => item.id === activeCase.periodId)

  function submitCard() {
    const text = rawText.trim()
    if (!text) return
    const trimmedBar = barNumber.trim()
    let parsedBar: number | null = null
    if (trimmedBar !== '') {
      const parsed = Number(trimmedBar)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
        setBarError('BAR 需为 1–1440 的整数（语音误识别的大数字请核对）')
        return
      }
      setBarError(null)
      parsedBar = parsed
    } else {
      // 留空时从原文机械提取（与浮窗/REST 行为一致）；提取不到就按缺 BAR 保存
      parsedBar = extractExplicitBarRef(text) ?? null
    }
    createCaseCard({
      caseId: activeCase.id,
      phase,
      rawText: text,
      barRef: parsedBar,
      entryDecision: phase === 'entry' ? entryDecision : undefined,
    })
    setRawText('')
    setBarNumber('')
    setBarError(null)
    setEntryDecision('pending')
  }

  async function draftTitle() {
    setTitleError(null)
    setTitleDrafting(true)
    try {
      const title = await draftCaseTitle(activeCase.id)
      if (title && title !== activeCase.title) {
        updateCase(activeCase.id, { title })
        setTitleDraft(title)
      }
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : String(error))
    } finally {
      setTitleDrafting(false)
    }
  }

  function saveTitle() {
    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      setTitleDraft(activeCase.title)
      return
    }
    if (nextTitle !== activeCase.title) updateCase(activeCase.id, { title: nextTitle })
    setTitleDraft(nextTitle)
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Link to="/cases" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Cases</Link>
          <Input
            value={titleDraft}
            aria-label="Case 标题"
            className="h-auto border-0 px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setTitleDraft(activeCase.title)
                event.currentTarget.blur()
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-muted-foreground"
              disabled={titleDrafting || cards.length === 0}
              onClick={draftTitle}
            >
              <WandSparkles className={cn('size-3.5', titleDrafting && 'animate-pulse')} data-icon="inline-start" />
              {titleDrafting ? '拟题中…' : 'AI 拟题'}
            </Button>
            {titleError && <span className="text-xs text-destructive">{titleError}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{account?.name} · {period?.name} · 创建于 <RelativeTime ms={caseRecord.createdAt} /></p>
        </div>
        <div className="flex items-center gap-2">
          <ManageCaseTagsDialog />
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (window.confirm(`删除 Case「${caseRecord.title}」及其全部 Cards？`)) {
                deleteCase(caseRecord.id)
                navigate('/cases')
              }
            }}
          >
            <Trash2 data-icon="inline-start" />删除
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Case 概要</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{caseStatusLabel[caseRecord.status]}</Badge>
              <Badge variant="outline">{caseProvenanceLabel[caseRecord.provenance]}</Badge>
              {boundTrade ? (
                <Button variant="outline" size="sm" className="h-7" nativeButton={false} render={<Link to={`/trades/${boundTrade.id}`} />}>
                  <Link2 className="size-3.5" data-icon="inline-start" />
                  Trade #{String(boundTrade.seq).padStart(3, '0')}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">未关联 Trade</span>
              )}
              <Separator orientation="vertical" className="h-5" />
              {CASE_PHASE_OPTIONS.map((option) => (
                <span key={option.value} className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span className={cn('inline-block size-2 rounded-full border', PHASE_TONES[option.value], 'border-current')} aria-hidden="true" />
                  {option.label} {phaseCounts[option.value]}
                </span>
              ))}
              <Separator orientation="vertical" className="h-5" />
              <span className="text-sm text-muted-foreground">更新 <RelativeTime ms={caseRecord.updatedAt} /></span>
            </CardContent>
          </Card>

          <CaseSummaryCard
            caseRecord={caseRecord}
            cards={cards}
            variant={boundTrade ? 'compact' : 'full'}
            trade={boundTrade}
          />

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-1.5">
                <CardTitle className="text-base">新增 Card</CardTitle>
                <CardDescription>原文可随时修正错字（保留历史版本），也可以删除整张卡。</CardDescription>
              </div>
              <Button variant="outline" size="sm" className="h-8" aria-expanded={newCardOpen} onClick={() => setNewCardOpen((prev) => !prev)}>
                <Plus data-icon="inline-start" />
                {newCardOpen ? '收起表单' : '新增 Card'}
              </Button>
            </CardHeader>
            {newCardOpen && (
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {CASE_PHASE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={phase === option.value}
                      onClick={() => setPhase(option.value)}
                      className={cn('rounded-lg border px-3 py-2 text-left transition-colors', phase === option.value ? PHASE_TONES[option.value] : 'hover:bg-muted')}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    </button>
                  ))}
                </div>
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">记录提示</p>
                  <ul className="space-y-1 text-sm">{CASE_PHASE_PROMPTS[phase].map((prompt) => <li key={prompt}>· {prompt}</li>)}</ul>
                </div>
                {phase === 'entry' && (
                  <Field>
                    <FieldLabel>操作确认</FieldLabel>
                    <Select items={CASE_ENTRY_DECISION_OPTIONS} value={entryDecision} onValueChange={(value) => setEntryDecision(value as CaseEntryDecision)}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{CASE_ENTRY_DECISION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>选择“未执行，继续观察”后，这张 Card 会显示在 Pre-entry 部分，同时保留原始 Entry 身份。</FieldDescription>
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="case-card-bar">BAR（可留空）</FieldLabel>
                  <Input
                    id="case-card-bar"
                    type="number"
                    min="1"
                    step="1"
                    max="1440"
                    value={barNumber}
                    onChange={(event) => {
                      setBarNumber(event.target.value)
                      setBarError(null)
                    }}
                    placeholder="例如 201"
                    aria-invalid={barError != null}
                  />
                  {barError ? (
                    <p className="text-sm text-destructive" role="alert">{barError}</p>
                  ) : (
                    <FieldDescription>留空时自动提取原文里的 BAR（BAR38 / 第 42 根 K 线）；提取不到按缺 BAR 保存，后续可补。</FieldDescription>
                  )}
                </Field>
                <Textarea
                  rows={7}
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  placeholder="可以直接使用系统语音输入法。例：现在是 BAR38，我看到……"
                />
                <div className="flex justify-end">
                  <Button disabled={!rawText.trim()} onClick={submitCard}><Plus data-icon="inline-start" />保存 Card</Button>
                </div>
              </CardContent>
            )}
          </Card>

          <CaseCardTimeline cards={cards} />
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Case 信息</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel>状态</FieldLabel>
                <Select items={CASE_STATUS_OPTIONS} value={caseRecord.status} onValueChange={(value) => updateCase(caseRecord.id, { status: value as CaseStatus })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{CASE_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>记录方式</FieldLabel>
                <Select items={CASE_PROVENANCE_OPTIONS} value={caseRecord.provenance} onValueChange={(value) => updateCase(caseRecord.id, { provenance: value as CaseProvenance })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{CASE_PROVENANCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Case Tags</CardTitle></CardHeader>
            <CardContent>
              {caseTagDefs.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有 Case 标签。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sortedCaseTagDefs.map((tag) => {
                    const active = caseRecord.tagIds.includes(tag.id)
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={active}
                        className={cn('rounded-full transition-opacity', !active && 'opacity-40 hover:opacity-75')}
                        onClick={() => updateCase(caseRecord.id, { tagIds: active ? caseRecord.tagIds.filter((id) => id !== tag.id) : [...caseRecord.tagIds, tag.id] })}
                      >
                        <CaseTagBadge tagId={tag.id} />
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="size-4" />Trade Binding</CardTitle></CardHeader>
            <CardContent>
              {boundTrade ? (
                <div className="flex flex-col gap-2">
                  <span className="text-sm">已关联 Trade #{String(boundTrade.seq).padStart(3, '0')}</span>
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/trades/${boundTrade.id}`} />}>查看 Trade</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <Archive className="size-5" />
                  <span>尚未关联 Trade。可以用下方 AI 找 Trade，或到 Trade 详情页手动选择本 Case。</span>
                  <BindingSuggestForCase caseRecord={caseRecord} />
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
