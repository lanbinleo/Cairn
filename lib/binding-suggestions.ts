/**
 * Case↔Trade AI 关联推荐：候选池机械预筛（同账户、未绑定、按时间距离排序取前 6），
 * AI 只负责排序和给理由，绑定动作永远由用户确认。
 */

import { caseCardDigest } from './cases'
import { computeTradeMetrics } from './metrics'
import { fmtUtcDateTime } from './format'
import type { CaseCard, CaseTradeBinding, Trade, TradeCase } from './types'

export interface BindingMatch {
  candidateIndex: number
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

export interface BindingSuggestion<T> {
  candidate: T
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

const MAX_CANDIDATES = 6

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

const PHASE_NAME: Record<CaseCard['phase'], string> = {
  'pre-entry': '观察',
  entry: '入场',
  intermediate: '过程',
  closing: '离场',
  reflection: '复盘',
}

function cardLines(cards: CaseCard[], perCardLimit: number, maxCards: number): string[] {
  return cards.slice(0, maxCards).map((card) => {
    const bar = card.barRef != null ? ` BAR${card.barRef}` : ''
    return `- [${PHASE_NAME[card.phase]}]${bar} ${truncate(card.rawText, perCardLimit)}`
  })
}

function tradeFactLine(trade: Trade): string {
  const m = computeTradeMetrics(trade)
  const direction = trade.direction === 'long' ? '做多' : '做空'
  const status = trade.status === 'closed' ? '已平仓' : '持仓中'
  const parts = [
    `#${trade.seq} ${direction} ${status}`,
    `开仓 ${fmtUtcDateTime(m.entryTime)} @ ${m.avgEntry} ×${m.totalQuantity}`,
  ]
  if (m.exitTime > 0) parts.push(`平仓 ${fmtUtcDateTime(m.exitTime)} @ ${m.avgExit}`)
  if (trade.initialStopLoss != null) parts.push(`初始止损 ${trade.initialStopLoss}`)
  if (trade.initialTakeProfit != null) parts.push(`初始止盈 ${trade.initialTakeProfit}`)
  return parts.join('，')
}

/** 为 Case 找 Trade：返回上下文与候选 Trade（与 matches 的 candidateIndex 一一对应）。 */
export function bindingContextForCase(
  caseRecord: TradeCase,
  cards: CaseCard[],
  trades: Trade[],
  bindings: CaseTradeBinding[],
): { context: string; candidates: Trade[] } {
  const boundTradeIds = new Set(bindings.map((binding) => binding.tradeId))
  const candidates = trades
    .filter((trade) => trade.accountId === caseRecord.accountId && !boundTradeIds.has(trade.id))
    .map((trade) => ({ trade, distance: Math.abs(computeTradeMetrics(trade).entryTime - caseRecord.createdAt) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES)
    .map((item) => item.trade)

  const lines = [
    `目标：为下面的 Case 找匹配的 Trade（交易所成交记录）。`,
    `Case「${caseRecord.title}」，创建于 ${fmtUtcDateTime(caseRecord.createdAt)}（UTC），共 ${cards.length} 张卡片。`,
  ]
  if (cards.length > 0) {
    lines.push('卡片内容（口语原文节选，注意里面的方向、价格和时间线索）：')
    lines.push(...cardLines(cards, 200, 12))
  }
  lines.push('候选 Trade（编号. 事实）：')
  candidates.forEach((trade, index) => {
    lines.push(`${index + 1}. ${tradeFactLine(trade)}`)
  })
  return { context: lines.join('\n'), candidates }
}

/** 为 Trade 找 Case：返回上下文与候选 Case。 */
export function bindingContextForTrade(
  trade: Trade,
  cases: TradeCase[],
  caseCards: CaseCard[],
  bindings: CaseTradeBinding[],
): { context: string; cases: TradeCase[] } {
  const boundCaseIds = new Set(bindings.map((binding) => binding.caseId))
  const entryTime = computeTradeMetrics(trade).entryTime
  const candidates = cases
    .filter((caseRecord) => caseRecord.accountId === trade.accountId && !boundCaseIds.has(caseRecord.id))
    .map((caseRecord) => ({ caseRecord, distance: Math.abs(caseRecord.createdAt - entryTime) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES)
    .map((item) => item.caseRecord)

  const lines = [
    `目标：为下面的 Trade 找匹配的 Case（口语记录集合）。`,
    `Trade ${tradeFactLine(trade)}。`,
    '候选 Case（编号. 标题、创建时间与卡片提要）：',
  ]
  candidates.forEach((caseRecord, index) => {
    const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
    const digests = cards
      .slice(0, 6)
      .map((card) => `[${PHASE_NAME[card.phase]}]${caseCardDigest(card) ?? truncate(card.rawText.split('\n')[0] ?? '', 30)}`)
      .join('；')
    lines.push(`${index + 1}. 「${caseRecord.title}」，创建于 ${fmtUtcDateTime(caseRecord.createdAt)}（UTC），${cards.length} 张卡片${digests ? `：${digests}` : ''}`)
  })
  return { context: lines.join('\n'), cases: candidates }
}

/** matches（1 基编号）→ 候选对象 + 理由。 */
export function zipBindingSuggestions<T>(candidates: T[], matches: BindingMatch[]): BindingSuggestion<T>[] {
  const out: BindingSuggestion<T>[] = []
  for (const match of matches) {
    const candidate = candidates[match.candidateIndex - 1]
    if (candidate === undefined) continue
    out.push({ candidate, reason: match.reason, confidence: match.confidence })
  }
  return out
}
