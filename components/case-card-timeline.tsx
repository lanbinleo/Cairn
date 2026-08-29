'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, ChevronDown, ChevronRight, MoreHorizontal, Pencil, Sparkles, Trash2 } from 'lucide-react'

import { CaseCardAnalysisView, EditableHighlightedCaseCardText, HighlightedCaseCardText } from '@/components/case-card-analysis'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CASE_PHASE_OPTIONS, caseCardDigest, caseEntryDecisionLabel, casePhaseLabel, displayPhaseForCaseCard, isCaseCardAnalysisStale } from '@/lib/cases'
import { useCairn } from '@/lib/store'
import type { CaseCard, CaseCardPhase } from '@/lib/types'
import { cn } from '@/lib/utils'

const PHASE_TONES: Record<CaseCardPhase, string> = {
  'pre-entry': 'border-blue-500/25 bg-blue-500/5',
  entry: 'border-emerald-500/25 bg-emerald-500/5',
  intermediate: 'border-amber-500/25 bg-amber-500/5',
  closing: 'border-rose-500/25 bg-rose-500/5',
  reflection: 'border-violet-500/25 bg-violet-500/5',
}

/** BAR 合法区间：bar 序号按 UTC 日重置，最小周期 1 分钟 → 一天最多 1440 根。 */
const MAX_BAR_NUMBER = 1440

/** 折叠行文字：优先用未过期的 AI digest，否则回退原文首行。 */
function summaryLine(card: CaseCard): string {
  const digest = caseCardDigest(card)
  if (digest) return digest.length > 72 ? `${digest.slice(0, 72)}…` : digest
  const first = card.rawText.split('\n').find((line) => line.trim()) ?? ''
  return first.length > 72 ? `${first.slice(0, 72)}…` : first
}

interface CaseCardTimelineProps {
  cards: CaseCard[]
  /** 允许「移动到其他 Case」（Case 详情页开，Trade 页关）。 */
  showMoveToCase?: boolean
  /** 顶部「全部识别」按钮（Trade 页可关）。 */
  showBatchAnalyze?: boolean
  /** 图表/时间线跳转定位目标：展开并滚动到该卡片。 */
  targetCardId?: string
}

/**
 * 心路历程时间线：Case 详情页与 Trade 详情 Case Tab 共用同一份可编辑视图
 * （错字修正、AI 识别、BAR 修正、标签整理、memo 修正、过期忽略、折叠展开）。
 * 排列按展示阶段分组、组内按创建顺序。
 */
export function CaseCardTimeline({ cards, showMoveToCase = true, showBatchAnalyze = true, targetCardId }: CaseCardTimelineProps) {
  const { cases, analyzeCaseCard, updateCaseCardText, updateCaseCardBarRef, deleteCaseCard, updateCaseCardAnalysis, moveCaseCard } = useCairn()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editingBarCardId, setEditingBarCardId] = useState<string | null>(null)
  const [barDraft, setBarDraft] = useState('')
  const [movingCardId, setMovingCardId] = useState<string | null>(null)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [organizingCardIds, setOrganizingCardIds] = useState<Set<string>>(new Set())
  const [analyzingCardIds, setAnalyzingCardIds] = useState<Set<string>>(new Set())
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({})
  const [batchAnalyzing, setBatchAnalyzing] = useState(false)
  const highlightRef = useRef<HTMLDivElement | null>(null)

  const groupedCards = useMemo(() => {
    const groups: Record<CaseCardPhase, CaseCard[]> = {
      'pre-entry': [],
      entry: [],
      intermediate: [],
      closing: [],
      reflection: [],
    }
    for (const card of cards) groups[displayPhaseForCaseCard(card)].push(card)
    return groups
  }, [cards])
  const missingBarCount = useMemo(() => cards.filter((card) => card.barRef == null).length, [cards])
  const staleCount = useMemo(() => cards.filter(isCaseCardAnalysisStale).length, [cards])
  const otherCases = useMemo(
    () => cases.filter((item) => cards.length === 0 || item.id !== cards[0]?.caseId).sort((a, b) => b.createdAt - a.createdAt),
    [cases, cards],
  )

  useEffect(() => {
    if (!targetCardId) return
    setExpandedIds((prev) => new Set(prev).add(targetCardId))
    const article = highlightRef.current?.querySelector(`[data-card-id="${targetCardId}"]`)
    if (article) {
      article.scrollIntoView({ behavior: 'smooth', block: 'center' })
      article.classList.add('ring-2', 'ring-amber-500/60')
      window.setTimeout(() => article.classList.remove('ring-2', 'ring-amber-500/60'), 2000)
    }
  }, [targetCardId])

  function toggleExpanded(cardId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  function expandAll() {
    setExpandedIds(new Set(cards.map((card) => card.id)))
  }

  async function runAnalysis(cardId: string, instruction?: string) {
    const card = cards.find((item) => item.id === cardId)
    if (card?.aiAnalysis?.userAdjusted && !instruction) {
      if (!window.confirm('重新识别会覆盖你手动调整过的标签与 memo，继续？')) return
    }
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

  /** 批量整理限流并发：整 Case 几十张卡同时打 provider 容易触发 429（4xx 不在重试白名单） */
  async function analyzeAllCards() {
    if (!cards.length) return
    setBatchAnalyzing(true)
    const queue = cards.map((card) => card.id)
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const cardId = queue.shift()
        if (cardId == null) return
        await runAnalysis(cardId)
      }
    })
    await Promise.all(workers)
    setBatchAnalyzing(false)
  }

  function saveBarEdit(cardId: string) {
    const trimmed = barDraft.trim()
    if (trimmed === '') {
      updateCaseCardBarRef(cardId, null)
    } else {
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BAR_NUMBER) return
      updateCaseCardBarRef(cardId, parsed)
    }
    setEditingBarCardId(null)
    setBarDraft('')
  }

  const allExpanded = cards.length > 0 && cards.every((card) => expandedIds.has(card.id))

  return (
    <Card ref={highlightRef}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">心路历程</CardTitle>
          {(missingBarCount > 0 || staleCount > 0) && (
            <CardDescription>
              {missingBarCount > 0 && <span className="text-amber-600 dark:text-amber-400">{missingBarCount} 张缺 BAR</span>}
              {missingBarCount > 0 && staleCount > 0 && ' · '}
              {staleCount > 0 && <span className="text-amber-600 dark:text-amber-400">{staleCount} 张需重新识别</span>}
            </CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={allExpanded ? () => setExpandedIds(new Set()) : expandAll}>
            {allExpanded ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
            {allExpanded ? '全部收起' : '全部展开'}
          </Button>
          {showBatchAnalyze && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={batchAnalyzing || analyzingCardIds.size > 0 || cards.length === 0}
              onClick={analyzeAllCards}
            >
              <Sparkles className={cn('size-3.5', batchAnalyzing && 'animate-pulse')} data-icon="inline-start" />
              {batchAnalyzing ? '识别中…' : '全部识别'}
            </Button>
          )}
        </div>
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
              {phaseCards.map((card) => {
                const expanded = expandedIds.has(card.id)
                return (
                  <article
                    key={card.id}
                    data-card-id={card.id}
                    className={cn('rounded-lg border', expanded ? 'p-4' : 'px-3 py-2', PHASE_TONES[option.value])}
                  >
                    {expanded ? (
                      <>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{casePhaseLabel[card.phase]}</Badge>
                            {card.entryDecision && <Badge variant="secondary">{caseEntryDecisionLabel[card.entryDecision]}</Badge>}
                            {card.phase !== option.value && <span className="text-xs text-muted-foreground">展示于 {option.label}</span>}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn('h-6 gap-1 px-1.5 text-xs', card.barRef == null ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}
                              title={card.barRef == null ? '这张卡没有 BAR 引用，点击补填' : '点击修正 BAR（语音误识别或填错时）'}
                              onClick={() => {
                                setEditingBarCardId((prev) => (prev === card.id ? null : card.id))
                                setBarDraft(card.barRef != null ? String(card.barRef) : '')
                              }}
                            >
                              {card.barRef != null ? `BAR ${card.barRef}` : '缺 BAR'}
                            </Button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span
                              className="text-xs text-muted-foreground"
                              title={card.rawTextHistory && card.rawTextHistory.length > 0
                                ? `已修正 ${card.rawTextHistory.length} 次：\n${card.rawTextHistory.join('\n──\n')}`
                                : undefined}
                            >
                              <RelativeTime ms={card.createdAt} />
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-muted-foreground"
                              disabled={analyzingCardIds.has(card.id)}
                              onClick={() => runAnalysis(card.id)}
                            >
                              <Sparkles className={cn('size-3.5', analyzingCardIds.has(card.id) && 'animate-pulse')} />
                              {analyzingCardIds.has(card.id) ? '识别中…' : card.aiAnalysis ? '重新识别' : 'AI 识别'}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" aria-label="更多操作">
                                    <MoreHorizontal className="size-3.5" />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    if (editingCardId === card.id) {
                                      setEditingCardId(null)
                                    } else {
                                      setEditingCardId(card.id)
                                      setEditText(card.rawText)
                                    }
                                  }}
                                >
                                  <Pencil />
                                  修正原文错字
                                </DropdownMenuItem>
                                {showMoveToCase && otherCases.length > 0 && (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setMovingCardId((prev) => (prev === card.id ? null : card.id))
                                      setMoveTargetId('')
                                    }}
                                  >
                                    <ArrowRightLeft />
                                    移动到其他 Case
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => {
                                    if (window.confirm('删除这张卡片？原文与 AI 分析一起移除（软删除，可从备份恢复）。')) {
                                      deleteCaseCard(card.id)
                                    }
                                  }}
                                >
                                  <Trash2 />
                                  删除这张卡
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {editingBarCardId === card.id && (
                          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-background/70 p-2">
                            <Input
                              className="h-8 w-28"
                              type="number"
                              min="1"
                              step="1"
                              max={MAX_BAR_NUMBER}
                              value={barDraft}
                              placeholder="BAR 序号"
                              onChange={(event) => setBarDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') saveBarEdit(card.id)
                                if (event.key === 'Escape') setEditingBarCardId(null)
                              }}
                            />
                            <Button size="sm" className="h-8" onClick={() => saveBarEdit(card.id)}>保存</Button>
                            {card.barRef != null && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-muted-foreground"
                                title="清除 BAR 引用（这张卡按创建顺序放置）"
                                onClick={() => {
                                  updateCaseCardBarRef(card.id, null)
                                  setEditingBarCardId(null)
                                }}
                              >
                                清除
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditingBarCardId(null)}>取消</Button>
                          </div>
                        )}
                        {editingCardId === card.id ? (
                          <div className="flex flex-col gap-2">
                            <Textarea rows={5} value={editText} onChange={(event) => setEditText(event.target.value)} />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setEditingCardId(null)}>取消</Button>
                              <Button size="sm" disabled={!editText.trim()} onClick={() => {
                                const trimmed = editText.trim()
                                if (trimmed) updateCaseCardText(card.id, trimmed)
                                setEditingCardId(null)
                                setEditText('')
                              }}>保存修正</Button>
                            </div>
                          </div>
                        ) : card.aiAnalysis && card.aiAnalysis.labels.length > 0 ? (
                          organizingCardIds.has(card.id) ? (
                            <EditableHighlightedCaseCardText
                              text={card.rawText}
                              labels={card.aiAnalysis.labels}
                              onLabelsChange={(labels) => updateCaseCardAnalysis(card.id, (prev) => ({ ...prev, labels }))}
                            />
                          ) : (
                            <div className="group">
                              <HighlightedCaseCardText text={card.rawText} labels={card.aiAnalysis.labels} />
                              <button
                                type="button"
                                className="mt-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                                onClick={() => setOrganizingCardIds((prev) => new Set(prev).add(card.id))}
                              >
                                编辑标签
                              </button>
                            </div>
                          )
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
                          onEditAnalysis={(updater) => updateCaseCardAnalysis(card.id, updater)}
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
                            <Button size="sm" className="h-8" disabled={!moveTargetId} onClick={() => {
                              if (!moveTargetId) return
                              moveCaseCard(card.id, moveTargetId)
                              setMovingCardId(null)
                              setMoveTargetId('')
                            }}>移动</Button>
                            <Button variant="ghost" size="sm" className="h-8" onClick={() => setMovingCardId(null)}>取消</Button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="mt-2 flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => toggleExpanded(card.id)}
                        >
                          <ChevronDown className="size-3.5" />收起
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => toggleExpanded(card.id)}
                        aria-expanded={expanded}
                      >
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        <Badge variant="outline" className="shrink-0">{casePhaseLabel[card.phase]}</Badge>
                        {card.entryDecision && <Badge variant="secondary" className="shrink-0">{caseEntryDecisionLabel[card.entryDecision]}</Badge>}
                        <span
                          className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-xs', card.barRef == null
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground')}
                        >
                          {card.barRef != null ? `BAR ${card.barRef}` : '缺 BAR'}
                        </span>
                        {isCaseCardAnalysisStale(card) && <span className="shrink-0 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">过期</span>}
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summaryLine(card)}</span>
                        <RelativeTime ms={card.createdAt} className="shrink-0 text-xs text-muted-foreground" />
                      </button>
                    )}
                  </article>
                )
              })}
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}
