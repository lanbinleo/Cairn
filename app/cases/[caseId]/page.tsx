'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, ArrowRightLeft, Link2, Pencil, Plus, Sparkles, Trash2, WandSparkles } from 'lucide-react'

import { CaseTagBadge } from '@/components/case-tag-badge'
import { CaseCardAnalysisView, HighlightedCaseCardText } from '@/components/case-card-analysis'
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
  caseEntryDecisionLabel,
  casePhaseLabel,
  caseProvenanceLabel,
  caseStatusLabel,
  displayPhaseForCaseCard,
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
    moveCaseCard,
    updateCaseCardText,
    analyzeCaseCard,
  } = useCairn()
  const caseRecord = getCase(caseId)
  const [titleDraft, setTitleDraft] = useState('')
  const [phase, setPhase] = useState<CaseCardPhase>('pre-entry')
  const [entryDecision, setEntryDecision] = useState<CaseEntryDecision>('pending')
  const [barNumber, setBarNumber] = useState('')
  const [rawText, setRawText] = useState('')
  const [movingCardId, setMovingCardId] = useState<string | null>(null)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [analyzingCardIds, setAnalyzingCardIds] = useState<Set<string>>(new Set())
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({})
  const [batchAnalyzing, setBatchAnalyzing] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [titleDrafting, setTitleDrafting] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const cards = getCaseCards(caseId)
  const otherCases = useMemo(
    () => cases.filter((item) => item.id !== caseId).sort((a, b) => b.createdAt - a.createdAt),
    [cases, caseId],
  )
  const sortedCaseTagDefs = useMemo(() => sortTagDefsByColor(caseTagDefs), [caseTagDefs])
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
    setTitleDraft(caseRecord?.title ?? '')
  }, [caseRecord?.id, caseRecord?.title])
  if (!caseRecord) return <Navigate to="/cases" replace />
  const activeCase = caseRecord
  const binding = getCaseBinding(activeCase.id)
  const boundTrade = binding ? trades.find((trade) => trade.id === binding.tradeId) : undefined
  const account = accounts.find((item) => item.id === activeCase.accountId)
  const period = periods.find((item) => item.id === activeCase.periodId)

  function submitCard() {
    const parsedBar = Number(barNumber)
    if (!rawText.trim() || !Number.isInteger(parsedBar) || parsedBar < 1) return
    createCaseCard({
      caseId: activeCase.id,
      phase,
      rawText,
      barRef: parsedBar,
      entryDecision: phase === 'entry' ? entryDecision : undefined,
    })
    setRawText('')
    setBarNumber('')
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

  function startMoveCard(cardId: string) {
    setMovingCardId(cardId)
    setMoveTargetId('')
  }

  function confirmMoveCard(cardId: string) {
    if (!moveTargetId) return
    moveCaseCard(cardId, moveTargetId)
    setMovingCardId(null)
    setMoveTargetId('')
  }

  async function runAnalysis(cardId: string, instruction?: string) {
    setAnalysisErrors((prev) => {
      if (!prev[cardId]) return prev
      const next = { ...prev }
      delete next[cardId]
      return next
    })
    setAnalyzingCardIds((prev) => new Set(prev).add(cardId))
    try {
      await analyzeCaseCard(cardId, instruction)
    } catch (error) {
      setAnalysisErrors((prev) => ({ ...prev, [cardId]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setAnalyzingCardIds((prev) => {
        const next = new Set(prev)
        next.delete(cardId)
        return next
      })
    }
  }

  async function analyzeAllCards() {
    if (!cards.length) return
    setBatchAnalyzing(true)
    await Promise.allSettled(cards.map((card) => runAnalysis(card.id)))
    setBatchAnalyzing(false)
  }

  function startEditCard(cardId: string, rawText: string) {
    setEditingCardId(cardId)
    setEditText(rawText)
  }

  function saveEditCard(cardId: string) {
    const trimmed = editText.trim()
    if (trimmed) updateCaseCardText(cardId, trimmed)
    setEditingCardId(null)
    setEditText('')
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
              <CardTitle className="text-base">新增 Card</CardTitle>
              <CardDescription>提交后的原文保持只读；后续更正通过新的 Card 记录。</CardDescription>
            </CardHeader>
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
                <FieldLabel htmlFor="case-card-bar">BAR</FieldLabel>
                <Input id="case-card-bar" type="number" min="1" step="1" value={barNumber} onChange={(event) => setBarNumber(event.target.value)} placeholder="例如 201" />
                <FieldDescription>一张 Card 只对应一个 BAR；Closing 和 Reflection 也请填写对应的复盘 BAR。</FieldDescription>
              </Field>
              <Textarea
                rows={7}
                value={rawText}
                onChange={(event) => setRawText(event.target.value)}
                placeholder="可以直接使用系统语音输入法。例：现在是 BAR38，我看到……"
              />
              <div className="flex justify-end">
                <Button disabled={!rawText.trim() || !barNumber} onClick={submitCard}><Plus data-icon="inline-start" />保存 Card</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-1.5">
                <CardTitle className="text-base">心路历程</CardTitle>
                <CardDescription>{cards.length} 张原始 Card，按展示阶段和创建顺序排列</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={batchAnalyzing || analyzingCardIds.size > 0 || cards.length === 0}
                onClick={analyzeAllCards}
              >
                <Sparkles className={cn('size-3.5', batchAnalyzing && 'animate-pulse')} data-icon="inline-start" />
                {batchAnalyzing ? '整理中…' : '全部 AI 整理'}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {cards.length === 0 ? (
                <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">还没有 Card。</div>
              ) : CASE_PHASE_OPTIONS.map((option) => {
                const phaseCards = groupedCards[option.value]
                if (phaseCards.length === 0) return null
                return (
                  <section key={option.value} className="flex flex-col gap-3">
                    <div className="flex items-center gap-2"><h2 className="font-medium">{option.label}</h2><Badge variant="outline">{phaseCards.length}</Badge></div>
                    {phaseCards.map((card) => (
                      <article key={card.id} className={cn('rounded-lg border p-4', PHASE_TONES[option.value])}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{casePhaseLabel[card.phase]}</Badge>
                            {card.entryDecision && <Badge variant="secondary">{caseEntryDecisionLabel[card.entryDecision]}</Badge>}
                            {card.phase !== option.value && <span className="text-xs text-muted-foreground">展示于 {option.label}</span>}
                            {card.barRef != null && <Badge variant="outline">BAR {card.barRef}</Badge>}
                            {card.rawTextHistory && card.rawTextHistory.length > 0 && (
                              <span className="text-xs text-muted-foreground" title={card.rawTextHistory.join('\n──\n')}>
                                已修正 {card.rawTextHistory.length} 次
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <RelativeTime ms={card.createdAt} className="text-xs text-muted-foreground" />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground"
                              title="修正原文错字（保留历史版本）"
                              onClick={() => (editingCardId === card.id ? setEditingCardId(null) : startEditCard(card.id, card.rawText))}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-muted-foreground"
                              disabled={analyzingCardIds.has(card.id)}
                              onClick={() => runAnalysis(card.id)}
                            >
                              <Sparkles className={cn('size-3.5', analyzingCardIds.has(card.id) && 'animate-pulse')} />
                              {analyzingCardIds.has(card.id) ? '整理中…' : card.aiAnalysis ? '重新识别' : 'AI 整理'}
                            </Button>
                            {otherCases.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground"
                                title="移动到其他 Case"
                                onClick={() => (movingCardId === card.id ? setMovingCardId(null) : startMoveCard(card.id))}
                              >
                                <ArrowRightLeft className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {editingCardId === card.id ? (
                          <div className="flex flex-col gap-2">
                            <Textarea rows={5} value={editText} onChange={(event) => setEditText(event.target.value)} />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setEditingCardId(null)}>取消</Button>
                              <Button size="sm" disabled={!editText.trim()} onClick={() => saveEditCard(card.id)}>保存修正</Button>
                            </div>
                          </div>
                        ) : card.aiAnalysis && card.aiAnalysis.labels.length > 0 ? (
                          <HighlightedCaseCardText text={card.rawText} labels={card.aiAnalysis.labels} />
                        ) : (
                          <p className="whitespace-pre-wrap text-sm leading-6">{card.rawText}</p>
                        )}
                        {analysisErrors[card.id] && (
                          <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{analysisErrors[card.id]}</p>
                        )}
                        <CaseCardAnalysisView
                          card={card}
                          busy={analyzingCardIds.has(card.id)}
                          onRetry={(instruction) => runAnalysis(card.id, instruction)}
                        />
                        {movingCardId === card.id && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-background/70 p-2">
                            <Select
                              items={otherCases.map((item) => ({ value: item.id, label: item.title }))}
                              value={moveTargetId || undefined}
                              onValueChange={(value) => setMoveTargetId(value ?? '')}
                            >
                              <SelectTrigger className="h-8 w-56"><SelectValue placeholder="选择目标 Case" /></SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {otherCases.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <Button size="sm" className="h-8" disabled={!moveTargetId} onClick={() => confirmMoveCard(card.id)}>移动</Button>
                            <Button variant="ghost" size="sm" className="h-8" onClick={() => setMovingCardId(null)}>取消</Button>
                          </div>
                        )}
                      </article>
                    ))}
                  </section>
                )
              })}
            </CardContent>
          </Card>
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
              <Separator />
              <div className="text-sm"><span className="text-muted-foreground">状态：</span>{caseStatusLabel[caseRecord.status]}</div>
              <div className="text-sm"><span className="text-muted-foreground">来源：</span>{caseProvenanceLabel[caseRecord.provenance]}</div>
              <div className="text-sm"><span className="text-muted-foreground">更新：</span><RelativeTime ms={caseRecord.updatedAt} /></div>
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
                  <span>尚未关联 Trade。可在 Trade 详情页的 Case 面板中选择本 Case 建立关联。</span>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
