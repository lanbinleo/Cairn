/**
 * Case 自动收尾推导：满足条件且仍为「记录中」的 Case 自动置为「已完成」。
 * 只在数据变更事件后判断一次，用户手动重开「记录中」不会被立即再次收尾。
 */

import { hasPositionFill, isEntryExecution } from './executions'
import type { CaseCard, CaseTradeBinding, Trade, TradeCase } from './types'

const EPS = 1e-9

/** Trade 是否已完全平仓（离场数量 ≥ 入场数量） */
export function isTradeFullyClosed(trade: Trade): boolean {
  let entryQty = 0
  let exitQty = 0
  for (const execution of trade.executions) {
    if (!hasPositionFill(execution)) continue
    if (isEntryExecution(execution)) entryQty += execution.quantity
    else exitQty += execution.quantity
  }
  return entryQty > EPS && exitQty >= entryQty - EPS
}

export interface AutoCloseCandidate {
  caseId: string
  reason: 'trade-closed' | 'no-trade-reflection'
}

/**
 * 收尾条件（满足其一）：
 * - 绑定的 Trade 已完全平仓，且 Case 存在 Closing 卡（Reflection 可后补，不阻塞）
 * - 无绑定 Trade（未执行/继续观察/纯复盘），且存在 Reflection 卡
 *
 * Trade 已平仓但没写 Closing 卡的保持「记录中」——开着的 Case 就是补离场记录的提醒。
 */
export function deriveAutoCloseCases(
  cases: TradeCase[],
  caseCards: CaseCard[],
  caseBindings: CaseTradeBinding[],
  trades: Trade[],
): AutoCloseCandidate[] {
  const candidates: AutoCloseCandidate[] = []
  for (const caseRecord of cases) {
    if (caseRecord.status !== 'active') continue
    const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
    const binding = caseBindings.find((item) => item.caseId === caseRecord.id)
    if (binding) {
      const trade = trades.find((item) => item.id === binding.tradeId)
      if (trade && isTradeFullyClosed(trade) && cards.some((card) => card.phase === 'closing')) {
        candidates.push({ caseId: caseRecord.id, reason: 'trade-closed' })
      }
    } else if (cards.some((card) => card.phase === 'reflection')) {
      candidates.push({ caseId: caseRecord.id, reason: 'no-trade-reflection' })
    }
  }
  return candidates
}
