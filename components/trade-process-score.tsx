'use client'

import { useEffect, useMemo, useState } from 'react'
import { Save } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CASE_MEMO_FIELD_LABEL } from '@/lib/cases'
import { PROCESS_RR_THRESHOLD, deriveProcessFacts } from '@/lib/process-score'
import { useCairn } from '@/lib/store'
import type { Trade, TradeProcessScore } from '@/lib/types'

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Number(value.toFixed(4)))
}

function ScoreSelect({ value, max, onChange }: { value: number | undefined; max: number; onChange: (next: number | undefined) => void }) {
  const items = [
    { value: 'unset', label: '未评' },
    ...Array.from({ length: max + 1 }, (_, score) => ({ value: String(score), label: String(score) })),
  ]
  return (
    <Select
      items={items}
      value={value == null ? 'unset' : String(value)}
      onValueChange={(next) => onChange(next === 'unset' || next == null ? undefined : Number(next))}
    >
      <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  )
}

function ScoreRow({ title, hint, evidence, control, score, max }: {
  title: string
  hint: string
  evidence?: string
  control: React.ReactNode
  score: number | null | undefined
  max: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {evidence && <div className="mt-1 font-mono text-xs text-muted-foreground">{evidence}</div>}
      </div>
      <div className="flex items-center gap-3">
        {control}
        <span className="w-10 text-right font-mono text-sm">{score == null ? `—/${max}` : `${score}/${max}`}</span>
      </div>
    </div>
  )
}

/**
 * 过程分十分制：机械项（memo 完整、盈亏比、止损只收紧）实时推导，
 * 判断项（结构成立、入场纪律、出场按计划、计划外动作）人工填写；
 * 保存时把推导依据快照进 computed，评分锚定决策时刻。
 */
export function TradeProcessScoreCard({ trade, rMultiple }: { trade: Trade; rMultiple: number | null }) {
  const { caseBindings, caseCards, updateTrade } = useCairn()
  const saved = trade.processScore

  const [structureValid, setStructureValid] = useState<number | undefined>(saved?.structureValid)
  const [riskRewardPass, setRiskRewardPass] = useState<number | undefined>(saved?.riskRewardPass)
  const [entryDiscipline, setEntryDiscipline] = useState<number | undefined>(saved?.entryDiscipline)
  const [unplannedText, setUnplannedText] = useState(saved?.unplannedActions == null ? '' : String(saved.unplannedActions))
  const [exitPerPlan, setExitPerPlan] = useState<number | undefined>(saved?.exitPerPlan)

  useEffect(() => {
    setStructureValid(trade.processScore?.structureValid)
    setRiskRewardPass(trade.processScore?.riskRewardPass)
    setEntryDiscipline(trade.processScore?.entryDiscipline)
    setUnplannedText(trade.processScore?.unplannedActions == null ? '' : String(trade.processScore.unplannedActions))
    setExitPerPlan(trade.processScore?.exitPerPlan)
  }, [trade.id, trade.processScore?.updatedAt])

  const binding = caseBindings.find((item) => item.tradeId === trade.id)
  const boundCards = useMemo(
    () => (binding ? caseCards.filter((card) => card.caseId === binding.caseId) : []),
    [binding, caseCards],
  )
  const facts = useMemo(() => deriveProcessFacts(trade, boundCards), [trade, boundCards])

  const unplannedCount = unplannedText.trim() === '' ? null : Math.max(0, Math.floor(Number(unplannedText)))
  const derivedRRPass = facts.plannedRR == null ? null : facts.plannedRR >= PROCESS_RR_THRESHOLD ? 1 : 0
  const rrPass = riskRewardPass ?? derivedRRPass
  const improvScore = unplannedCount == null || !Number.isFinite(unplannedCount) ? null : Math.max(0, 2 - unplannedCount)

  const rows: Array<{ score: number | null; max: number }> = [
    { score: structureValid ?? null, max: 2 },
    { score: facts.memoScore, max: 2 },
    { score: rrPass, max: 1 },
    { score: entryDiscipline ?? null, max: 1 },
    { score: improvScore, max: 2 },
    { score: facts.stopOnlyTightened ? 1 : 0, max: 1 },
    { score: exitPerPlan ?? null, max: 1 },
  ]
  const total = rows.reduce((sum, row) => sum + (row.score ?? 0), 0)
  const scored = rows.filter((row) => row.score != null).length

  const memoHint = !binding
    ? '未绑定 Case；在 Trade 的 Case 面板绑定后自动推导'
    : facts.memoMissing == null
      ? '入场卡尚未 AI 整理；去 Case 页整理后自动推导'
      : facts.memoMissing.length === 0
        ? '六字段齐全'
        : `缺：${facts.memoMissing.map((key) => CASE_MEMO_FIELD_LABEL[key] ?? key).join('、')}`
  const rrEvidence = facts.plannedRR != null
    ? `entry ${fmtPrice(facts.entryPrice)} · stop ${fmtPrice(facts.stopPrice)} · target ${fmtPrice(facts.targetPrice)} → RR ${facts.plannedRR}（阈值 ${PROCESS_RR_THRESHOLD}）`
    : facts.entryPrice != null || facts.stopPrice != null
      ? '入场/止损/目标价不全（可在 Trade 上补 initialStopLoss/initialTakeProfit）'
      : '缺价格数据，可人工判定'
  const stopEvidence = facts.stopSequence.length > 1
    ? `止损序列 ${facts.stopSequence.map(fmtPrice).join(' → ')}`
    : facts.stopSequence.length === 1
      ? `止损 ${fmtPrice(facts.stopSequence[0])}，无放宽动作`
      : '无止损动作记录'

  function save() {
    const next: TradeProcessScore = {
      structureValid,
      riskRewardPass: riskRewardPass ?? derivedRRPass ?? undefined,
      entryDiscipline,
      unplannedActions: unplannedCount ?? undefined,
      exitPerPlan,
      computed: {
        entryPrice: facts.entryPrice,
        exitPrice: facts.exitPrice,
        stopPrice: facts.stopPrice,
        targetPrice: facts.targetPrice,
        plannedRR: facts.plannedRR,
        memoMissing: facts.memoMissing,
        stopOnlyTightened: facts.stopOnlyTightened,
      },
      updatedAt: Date.now(),
    }
    updateTrade(trade.id, { processScore: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">过程分</CardTitle>
        <CardDescription>
          只用决策时刻可得的信息评分；R（{rMultiple == null ? '—' : `${rMultiple.toFixed(2)}R`}）只记录，不进标签。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <ScoreRow
            title="结构成立"
            hint="判断项 · 对着入场 BAR 冻结图按定义复查（防 hindsight）"
            control={<ScoreSelect value={structureValid} max={2} onChange={setStructureValid} />}
            score={structureValid ?? null}
            max={2}
          />
          <ScoreRow
            title="memo 完整"
            hint={`自动项 · 六字段缺一扣一 · ${memoHint}`}
            control={<Badge variant={facts.memoScore == null ? 'outline' : 'secondary'}>{facts.memoScore == null ? '自动' : '自动'}</Badge>}
            score={facts.memoScore}
            max={2}
          />
          <ScoreRow
            title="计划盈亏比过线"
            hint={`自动判定（可改）· ${rrEvidence}`}
            control={<ScoreSelect value={riskRewardPass ?? derivedRRPass ?? undefined} max={1} onChange={setRiskRewardPass} />}
            score={rrPass}
            max={1}
          />
          <ScoreRow
            title="入场纪律"
            hint="判断项 · 计划区域内，非追单"
            control={<ScoreSelect value={entryDiscipline} max={1} onChange={setEntryDiscipline} />}
            score={entryDiscipline ?? null}
            max={1}
          />
          <ScoreRow
            title="持仓零即兴"
            hint="人记次数 · 每个 unplanned 动作扣 1"
            evidence={unplannedCount != null ? `计划外动作 ${unplannedCount} 次` : undefined}
            control={
              <Input
                className="h-8 w-20 text-center"
                inputMode="numeric"
                min={0}
                value={unplannedText}
                onChange={(event) => setUnplannedText(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="次数"
              />
            }
            score={improvScore}
            max={2}
          />
          <ScoreRow
            title="止损只收紧不放宽"
            hint={`自动项 · ${stopEvidence}`}
            control={<Badge variant={facts.stopOnlyTightened ? 'secondary' : 'destructive'}>{facts.stopOnlyTightened ? '通过' : '存在放宽'}</Badge>}
            score={facts.stopOnlyTightened ? 1 : 0}
            max={1}
          />
          <ScoreRow
            title="出场按计划"
            hint={`判断项 · 非心慌点掉 · 离场 ${fmtPrice(facts.exitPrice)}${facts.targetPrice != null ? ` · 计划目标 ${fmtPrice(facts.targetPrice)}` : ''}${facts.stopPrice != null ? ` · 计划止损 ${fmtPrice(facts.stopPrice)}` : ''}`}
            control={<ScoreSelect value={exitPerPlan} max={1} onChange={setExitPerPlan} />}
            score={exitPerPlan ?? null}
            max={1}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            合计 <span className="font-mono text-lg font-semibold text-foreground">{total}</span>/10 · 已评 {scored}/7 项
            {saved?.updatedAt && <span className="ml-2 text-xs">上次保存 {new Date(saved.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>}
          </div>
          <Button size="sm" onClick={save}><Save data-icon="inline-start" />保存评分</Button>
        </div>
      </CardContent>
    </Card>
  )
}
