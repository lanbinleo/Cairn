/**
 * 导入时的 Case↔Trade 匹配：
 * - 精确（绿）：同账户下，Trade 首笔入场时间 ≈ 已执行 Entry 卡记录时间，
 *   且末笔离场时间 ≈ Closing 卡记录时间（±容差），Case 未绑定 → 自动关联。
 * - 疑问（黄）：只有入场匹配 / 时间区间重叠但不确定 → 列候选人工确认。
 * - 无匹配（红）：找不到任何候选 Case。
 *
 * 注意：Case/卡片目前不记录 symbol（widget 只传文本），匹配仅用账户 + 时间窗；
 * symbol 一致性由结果页展示的双方摘要供人确认。
 */

import { computeTradeMetrics } from './metrics'
import type { CaseCard, CaseTradeBinding, Trade, TradeCase } from './types'

/** Entry/Closing 卡与成交时间的匹配容差 */
export const IMPORT_MATCH_TOLERANCE_MS = 15 * 60_000
/** 弱匹配：Case 任意卡片落在 Trade 持仓区间前后各 60 分钟内 */
export const IMPORT_MATCH_WEAK_WINDOW_MS = 60 * 60_000

export type ImportMatchLevel = 'exact' | 'suggest' | 'none'

export interface ImportMatchCandidate {
  caseId: string
  /** Entry 卡命中入场时间窗 */
  entryMatched: boolean
  /** Closing 卡命中离场时间窗 */
  closingMatched: boolean
}

export interface ImportMatchResult {
  tradeId: string
  level: ImportMatchLevel
  candidates: ImportMatchCandidate[]
}

function entryCardsFor(cards: CaseCard[]): CaseCard[] {
  return cards.filter((card) => card.phase === 'entry' && card.entryDecision !== 'continue-observing')
}

function closingCardsFor(cards: CaseCard[]): CaseCard[] {
  return cards.filter((card) => card.phase === 'closing')
}

/**
 * 对一批刚导入的 Trade 推导匹配结果。excludedCaseIds 用于顺序自动绑定时
 * 消费掉已用掉的 Case（避免两个 Trade 抢同一个 Case）。
 */
export function matchTradesToCases(
  importedTrades: Trade[],
  cases: TradeCase[],
  caseCards: CaseCard[],
  caseBindings: CaseTradeBinding[],
  excludedCaseIds: Set<string> = new Set(),
): ImportMatchResult[] {
  const boundCaseIds = new Set(caseBindings.map((binding) => binding.caseId))
  const available = cases.filter(
    (caseRecord) => !boundCaseIds.has(caseRecord.id) && !excludedCaseIds.has(caseRecord.id),
  )

  return importedTrades.map((trade) => {
    const { entryTime, exitTime } = computeTradeMetrics(trade)
    const candidates: ImportMatchCandidate[] = []
    const weakCandidates: ImportMatchCandidate[] = []

    for (const caseRecord of available) {
      if (caseRecord.accountId !== trade.accountId) continue
      const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
      const entryHit = entryCardsFor(cards).some(
        (card) => Math.abs(card.createdAt - entryTime) <= IMPORT_MATCH_TOLERANCE_MS,
      )
      const closingHit = closingCardsFor(cards).some(
        (card) => Math.abs(card.createdAt - exitTime) <= IMPORT_MATCH_TOLERANCE_MS,
      )
      if (entryHit) {
        candidates.push({ caseId: caseRecord.id, entryMatched: true, closingMatched: closingHit })
      } else {
        const overlap = cards.some(
          (card) =>
            card.createdAt >= entryTime - IMPORT_MATCH_WEAK_WINDOW_MS &&
            card.createdAt <= exitTime + IMPORT_MATCH_WEAK_WINDOW_MS,
        )
        if (overlap) weakCandidates.push({ caseId: caseRecord.id, entryMatched: false, closingMatched: false })
      }
    }

    const exact = candidates.filter((candidate) => candidate.closingMatched)
    if (exact.length === 1) return { tradeId: trade.id, level: 'exact', candidates: [exact[0]] }
    if (exact.length > 1) return { tradeId: trade.id, level: 'suggest', candidates: exact }
    if (candidates.length > 0) return { tradeId: trade.id, level: 'suggest', candidates }
    if (weakCandidates.length > 0) return { tradeId: trade.id, level: 'suggest', candidates: weakCandidates }
    return { tradeId: trade.id, level: 'none', candidates: [] }
  })
}
