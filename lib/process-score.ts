/**
 * 过程分（十分制）推导：只使用决策时刻可得的信息。
 * 机械项从 Execution 与绑定 Case 的 Entry memo（AI 整理产物）计算；
 * 判断项（结构成立、入场纪律、出场按计划）留给人，锚定入场 BAR 冻结图评估。
 * R 只记录，绝不参与评分（避免 resulting）。
 */

import { isPositionExecutionAction } from './executions'
import type { CaseCard, Trade } from './types'

/** 计划盈亏比过线阈值（过程分「盈亏比过线」项的判定线） */
export const PROCESS_RR_THRESHOLD = 2

export interface ProcessScoreComputed {
  entryPrice: number | null
  exitPrice: number | null
  stopPrice: number | null
  targetPrice: number | null
  /** 计划盈亏比；三价缺一为 null */
  plannedRR: number | null
  /** Entry Card AI 整理缺失的 memo 字段；未整理/无卡为 null */
  memoMissing: string[] | null
  /** memo 完整得分（2 - 缺失数，下限 0）；未整理为 null */
  memoScore: number | null
  /** 止损只收紧不放宽；无止损动作视为 true */
  stopOnlyTightened: boolean
  /** 止损价序列快照（含 initialStopLoss） */
  stopSequence: number[]
}

/** 从 memo 值字符串里取第一个数字（"区间上沿上方 41650" → 41650）。 */
export function firstNumberIn(text?: string | number): number | null {
  if (text == null) return null
  const match = String(text).match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function deriveProcessFacts(trade: Trade, cards: CaseCard[]): ProcessScoreComputed {
  const fills = [...trade.executions]
    .filter((execution) => isPositionExecutionAction(execution.action) && execution.price != null)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
  const entry = fills.find((execution) => execution.action === 'entry') ?? fills[0]
  const exit = [...fills].reverse().find((execution) => execution.action === 'exit' || execution.action === 'scale-out')
  const entryPrice = entry?.price ?? null
  const exitPrice = exit?.price ?? null

  const entryCard = cards.find((card) => card.phase === 'entry')
  const memo = entryCard?.aiAnalysis?.memo
  const memoMissing = entryCard?.aiAnalysis?.missingFields ?? null
  const memoScore = memoMissing == null ? null : Math.max(0, 2 - memoMissing.length)

  const stopFromMemo = memo?.stopLoss ? firstNumberIn(memo.stopLoss.value) : null
  const targetFromMemo = memo?.target ? firstNumberIn(memo.target.value) : null
  const stopPrice = trade.initialStopLoss ?? stopFromMemo
  const targetPrice = trade.initialTakeProfit ?? targetFromMemo

  let plannedRR: number | null = null
  if (entryPrice != null && stopPrice != null && targetPrice != null) {
    const risk = Math.abs(entryPrice - stopPrice)
    const reward = Math.abs(targetPrice - entryPrice)
    if (risk > 0) plannedRR = Number((reward / risk).toFixed(2))
  }

  const stopSequence = [
    ...(trade.initialStopLoss != null ? [trade.initialStopLoss] : []),
    ...trade.executions
      .filter((execution) => (execution.action === 'stop' || execution.action === 'stop-moved' || execution.action === 'stop-set') && execution.price != null)
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
      .map((execution) => execution.price as number),
  ]
  let stopOnlyTightened = true
  for (let index = 1; index < stopSequence.length; index += 1) {
    const delta = stopSequence[index] - stopSequence[index - 1]
    if (trade.direction === 'long' ? delta < -1e-9 : delta > 1e-9) {
      stopOnlyTightened = false
      break
    }
  }

  return { entryPrice, exitPrice, stopPrice, targetPrice, plannedRR, memoMissing, memoScore, stopOnlyTightened, stopSequence }
}
