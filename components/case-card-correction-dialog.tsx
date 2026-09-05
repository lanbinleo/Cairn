'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CaseCardCorrection } from '@/lib/local-db'
import { applyCorrectionPairs } from '@/lib/case-card-corrections'
import type { CaseCard } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface CaseCardProofreadDraft {
  card: CaseCard
  corrections: CaseCardCorrection[]
}

/**
 * AI 校对预览（0.3.7）：替换对候选逐条勾选 + 手动补一对 + 套用后全文实时预览。
 * 「套用」= 一次正常的文本修正（原表述进 rawTextHistory，AI 识别标过期）——
 * 对话框本身就是确认，无需二次 confirm。
 */
export function CaseCardCorrectionDialog({
  draft,
  onClose,
  onApply,
}: {
  draft: CaseCardProofreadDraft | null
  onClose: () => void
  onApply: (cardId: string, nextText: string, count: number) => void
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [manual, setManual] = useState<{ oldText: string; newText: string }[]>([])
  const [oldDraft, setOldDraft] = useState('')
  const [newDraft, setNewDraft] = useState('')

  // 换一张卡时重置勾选与手动对（默认全勾）
  useEffect(() => {
    if (!draft) return
    setChecked(new Set(draft.corrections.map((_, index) => index)))
    setManual([])
    setOldDraft('')
    setNewDraft('')
  }, [draft?.card.id, draft?.corrections, draft])

  const preview = useMemo(() => {
    if (!draft) return null
    const pairs = [
      ...draft.corrections.filter((_, index) => checked.has(index)),
      ...manual,
    ]
    return applyCorrectionPairs(draft.card.rawText, pairs)
  }, [draft, checked, manual])

  if (!draft || !preview) return null

  // results 顺序 = 勾选的建议对在前、手动对在后——用勾选索引把结果映射回建议行
  const checkedIndexes = draft.corrections.map((_, index) => index).filter((index) => checked.has(index))
  const suggestionResults = preview.results.slice(0, checkedIndexes.length)
  const manualResults = preview.results.slice(checkedIndexes.length)
  const failedSuggestionIndexes = new Set(
    suggestionResults.flatMap((item, resultIndex) => (item.ok ? [] : [checkedIndexes[resultIndex]])),
  )
  const manualBlocked = manualResults.some((item) => !item.ok)
  const applyCount = preview.results.filter((item) => item.ok).length

  function addManualPair() {
    const oldText = oldDraft.trim()
    const newText = newDraft.trim()
    if (!oldText || !newText) return
    setManual((prev) => [...prev, { oldText, newText }])
    setOldDraft('')
    setNewDraft('')
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI 校对 · {draft.corrections.length} 处疑似修正</DialogTitle>
          <DialogDescription>
            逐条勾选后一次套用；原表述自动进历史存档，AI 识别会标记过期、可一键重跑。AI 只提建议，落笔永远是你。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
          {draft.corrections.map((item, index) => (
            <label
              key={index}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                failedSuggestionIndexes.has(index) ? 'opacity-60' : 'hover:border-ring/40',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-foreground"
                checked={checked.has(index)}
                onChange={(event) => setChecked((prev) => {
                  const next = new Set(prev)
                  if (event.target.checked) next.add(index)
                  else next.delete(index)
                  return next
                })}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-1.5 text-sm leading-6">
                  <span className="text-muted-foreground line-through decoration-destructive/60">{item.oldText}</span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <span className="font-medium">{item.newText}</span>
                </span>
                {failedSuggestionIndexes.has(index) ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">原文中找不到这段（可能已被前一处替换覆盖），不会套用</span>
                ) : (
                  item.reason && <span className="text-xs text-muted-foreground">{item.reason}</span>
                )}
              </span>
            </label>
          ))}

          <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center gap-2">
              <Input
                className="h-8"
                placeholder="原文片段（保留错误写法）"
                value={oldDraft}
                onChange={(event) => setOldDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addManualPair() }}
              />
              <Input
                className="h-8"
                placeholder="改为"
                value={newDraft}
                onChange={(event) => setNewDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addManualPair() }}
              />
              <Button variant="outline" size="sm" className="h-8 shrink-0" disabled={!oldDraft.trim() || !newDraft.trim()} onClick={addManualPair}>
                <Plus className="size-3.5" data-icon="inline-start" />
                添加
              </Button>
            </div>
            {manual.map((pair, index) => {
              const ok = manualResults[index]?.ok
              return (
                <div key={index} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                  <span className={cn('min-w-0 flex-1 truncate', ok === false && 'line-through decoration-destructive/60')}>
                    {pair.oldText} → {pair.newText}
                  </span>
                  {ok === false && <span className="shrink-0 text-xs text-destructive">原文中找不到</span>}
                  <button
                    type="button"
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="移除这一对"
                    onClick={() => setManual((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="rounded-lg bg-muted/40 p-3">
            <p className="mb-1 text-xs text-muted-foreground">套用后全文（{applyCount} 处）：</p>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{preview.text}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            disabled={applyCount === 0 || manualBlocked}
            onClick={() => onApply(draft.card.id, preview.text, applyCount)}
          >
            套用 {applyCount} 处修正
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
