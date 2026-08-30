/**
 * 导入时的 Case↔Trade 匹配（0.3.3 按生产绑定样本重做）：
 *
 * 生产数据结论：回放/复盘工作流下，卡片 createdAt 是录音墙钟时间（例如 8 月录音、
 * 回放 1 月行情），Trade 成交是图表时间——单靠墙钟窗口永远匹配不上（0.3.2 及之前
 * 六对生产绑定全部只靠手动）。现在按两条时间轴 + 价格佐证打分：
 * - 图表轴（主）：Entry/Closing 卡的 barRef 锚定到 Trade 首笔成交所在 UTC 日
 *   （与 Trade 页展示同一套 resolveCaseCardTimesForTrade 机械规则），换算成图表
 *   时间与成交时间比对。卡片不记 timeframe，按 1/5/15/30/60 分钟逐个扫描取最吻合的。
 * - 墙钟轴（兜底）：当场内实时记录时卡片 createdAt ≈ 成交时间，沿用旧容差窗口。
 * - 价格佐证：Entry 卡 memo 的止损/止盈/入场价与 Trade 的 initialStopLoss/
 *   initialTakeProfit/开仓均价按相对容差比对（生产样本多对逐位一致，如 90364、
 *   90966.12、91208、91065）。
 * - 方向冲突（memo direction ≠ Trade direction）→ 降级为建议，绝不自动绑定。
 *
 * 精确（绿）：入场时间命中且（离场时间命中或有价格佐证），方向不冲突。
 * 疑问（黄）：只有入场命中 / 只有价格命中 / 墙钟区间重叠。
 * 无匹配（红）：找不到任何候选 Case。
 *
 * 注意：Case/卡片不记录 symbol，匹配仅用账户 + 时间 + 价格；symbol 一致性由
 * 结果页展示的双方摘要供人确认。
 */

import { barNumberToTime, isValidBarNumber, utcDayStart } from './bar-time'
import { computeTradeMetrics } from './metrics'
import { firstPlausibleNumberIn } from './process-score'
import type { CaseCard, CaseTradeBinding, Trade, TradeCase } from './types'

/** 墙钟轴：Entry/Closing 卡与成交时间的匹配容差（场内实时记录场景） */
export const IMPORT_MATCH_TOLERANCE_MS = 15 * 60_000
/** 墙钟轴弱匹配：Case 任意卡片落在 Trade 持仓区间前后各 60 分钟内 */
export const IMPORT_MATCH_WEAK_WINDOW_MS = 60 * 60_000
/** 价格佐证相对容差（0.2%：生产样本计划止损 vs 导出初始止损最大偏差约 0.07%） */
export const IMPORT_MATCH_PRICE_TOLERANCE = 0.002

/** 图表轴候选 timeframe（分钟）；卡片不记周期，扫描取最吻合的 */
const CHART_TIMEFRAMES = [5, 1, 15, 30, 60] as const
/** Entry 卡（挂单/决策）允许领先首笔成交的最长时间 */
const ENTRY_LEAD_MAX_MS = 30 * 60_000
/** Closing 卡与末笔离场时间的容差（按 bar 数 × timeframe） */
const CLOSING_TOLERANCE_BARS = 2
/** 宽松解析容忍的 barRef 小回退（语音录入顺序误差）；超过视为跨 UTC 日 */
const LOOSE_BACKTRACK_MS = 30 * 60_000

export type ImportMatchLevel = 'exact' | 'suggest' | 'none'

export interface ImportMatchCandidate {
  caseId: string
  /** 入场命中（图表轴或墙钟轴的 Entry 卡时间窗） */
  entryMatched: boolean
  /** Closing 卡命中离场时间窗 */
  closingMatched: boolean
}

export interface ImportMatchResult {
  tradeId: string
  level: ImportMatchLevel
  candidates: ImportMatchCandidate[]
}

/** 一对 Case↔Trade 的匹配信号（导入匹配与 AI 找 Case/Trade 预筛共用） */
export interface CaseTradeMatchSignals {
  entryTimeHit: boolean
  closingTimeHit: boolean
  /** memo 止损/止盈/入场价任一与 Trade 事实吻合 */
  priceHit: boolean
  /** memo direction 与 Trade direction 冲突（人工确认前不自动绑定） */
  directionMismatch: boolean
  /** 图表轴 Entry 卡与首笔成交的最小距离（ms）；卡片无可用 barRef 时为 null */
  chartDistanceMs: number | null
  /** 精确匹配：入场时间命中且（离场命中或有价格佐证），方向不冲突 */
  strong: boolean
}

function entryCardsFor(cards: CaseCard[]): CaseCard[] {
  return cards.filter((card) => card.phase === 'entry' && card.entryDecision !== 'continue-observing')
}

function closingCardsFor(cards: CaseCard[]): CaseCard[] {
  return cards.filter((card) => card.phase === 'closing')
}

function nearEnough(a: number | null, b: number | null, rel = IMPORT_MATCH_PRICE_TOLERANCE): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false
  return Math.abs(a - b) / b <= rel
}

function memoValue(field: { value: string | number } | undefined): string | undefined {
  const value = field?.value
  return value == null ? undefined : String(value)
}

/**
 * 匹配专用的宽松解析：与展示规则 resolveCaseCardTimesForTrade 相同的锚定与
 * 越界拒绝，但 barRef 小回退（≤30 分钟，语音录入顺序误差——生产样本 153 后录 152）
 * 不跨 UTC 日、紧跟上一张放置。跨日 day-bump 会把后续所有卡片都推到下一天，
 * 一次口误就足以让 Closing 卡全部解析错位（生产样本真实出现过）。展示用的严格
 * 规则（创建顺序优先）不受影响。
 */
function resolveCaseCardTimesLoose(
  cards: CaseCard[],
  timeframeMinutes: number,
  window: { anchor: number; start: number; end: number },
): Map<string, { time: number; valid: boolean }> {
  const resolved = new Map<string, { time: number; valid: boolean }>()
  let prevTime: number | null = null
  let prevDay = utcDayStart(window.anchor)
  const ordered = [...cards].sort((a, b) => a.createdAt - b.createdAt)
  for (const card of ordered) {
    if (card.barRef == null || !isValidBarNumber(card.barRef, timeframeMinutes)) {
      const time: number = prevTime == null ? window.start : prevTime + 1
      resolved.set(card.id, { time, valid: false })
      prevTime = time
      continue
    }
    let day = prevDay
    let time: number = barNumberToTime(day, card.barRef, timeframeMinutes)
    let clamped = false
    while (prevTime != null && time < prevTime) {
      if (prevTime - time <= LOOSE_BACKTRACK_MS) {
        time = prevTime + 1
        clamped = true
        break
      }
      day += 24 * 60 * 60_000
      time = barNumberToTime(day, card.barRef, timeframeMinutes)
    }
    if (time > window.end) {
      const fallback: number = prevTime == null ? window.start : prevTime + 1
      resolved.set(card.id, { time: fallback, valid: false })
      prevTime = fallback
      continue
    }
    resolved.set(card.id, { time, valid: !clamped })
    prevTime = time
    if (!clamped) prevDay = day
  }
  return resolved
}

/** 图表轴：把带 barRef 的卡片换算到 Trade 图表时间轴（宽松解析）。 */
function chartAxisDistance(
  cards: CaseCard[],
  timeframeMinutes: number,
  window: { anchor: number; start: number; end: number },
): Map<string, { time: number; lead: number }> {
  const resolved = resolveCaseCardTimesLoose(cards, timeframeMinutes, window)
  const out = new Map<string, { time: number; lead: number }>()
  for (const [id, item] of resolved) {
    if (!item.valid) continue
    out.set(id, { time: item.time, lead: window.anchor - item.time })
  }
  return out
}

/**
 * 机械评估一对 Case↔Trade 的匹配信号。纯函数、不碰 AI——AI 关联推荐
 * （binding-suggestions）也只把它当预筛排序依据，绑定永远由用户确认。
 */
export function analyzeCaseTradeMatch(trade: Trade, caseCards: CaseCard[]): CaseTradeMatchSignals {
  const m = computeTradeMetrics(trade)
  const entryCards = entryCardsFor(caseCards)
  const closingCards = closingCardsFor(caseCards)

  // ---- 价格佐证（与时间轴独立，任何一张 Entry 卡的 memo 都算数） ----
  let stopHit = false
  let targetHit = false
  let entryPriceHit = false
  let directionMismatch = false
  for (const card of entryCards) {
    const memo = card.aiAnalysis?.memo
    if (!memo) continue
    if (memo.direction?.value && memo.direction.value !== trade.direction) directionMismatch = true
    const refPrice = m.firstEntryPrice > 0 ? m.firstEntryPrice : m.avgEntry
    const memoStop = firstPlausibleNumberIn(memoValue(memo.stopLoss), trade.initialStopLoss ?? refPrice)
    if (nearEnough(memoStop, trade.initialStopLoss ?? null)) stopHit = true
    const memoTarget = firstPlausibleNumberIn(
      memoValue(memo.target),
      trade.initialTakeProfit ?? (m.avgExit > 0 ? m.avgExit : refPrice),
    )
    if (
      nearEnough(memoTarget, trade.initialTakeProfit ?? null) ||
      (m.exitTime > 0 && nearEnough(memoTarget, m.avgExit))
    ) {
      targetHit = true
    }
    const memoEntry = firstPlausibleNumberIn(memoValue(memo.entryPrice), refPrice)
    if (nearEnough(memoEntry, refPrice)) entryPriceHit = true
  }

  // ---- 图表轴：barRef 锚定 Trade 首笔成交日，扫描 timeframe 取最吻合 ----
  let chartEntryHit = false
  let chartClosingHit = false
  let chartDistanceMs: number | null = null
  if (m.entryTime > 0) {
    const window = {
      anchor: m.entryTime,
      start: m.entryTime,
      end: (m.exitTime > 0 ? m.exitTime : m.entryTime) + 24 * 60 * 60_000,
    }
    for (const timeframe of CHART_TIMEFRAMES) {
      const barMs = timeframe * 60_000
      const times = chartAxisDistance(caseCards, timeframe, window)
      for (const card of entryCards) {
        // 图表轴只认带 barRef 的卡片：无 barRef 的卡解析时兜底放在 anchor 上，
        // 恰好 lead=0 会造成假命中
        if (card.barRef == null) continue
        const item = times.get(card.id)
        if (!item) continue
        chartDistanceMs = chartDistanceMs == null ? Math.abs(item.lead) : Math.min(chartDistanceMs, Math.abs(item.lead))
        // Entry 卡是决策/挂单时刻：不晚于成交（容一根 K 线），最多领先 30 分钟
        if (item.lead >= -barMs && item.lead <= ENTRY_LEAD_MAX_MS) chartEntryHit = true
      }
      if (m.exitTime > 0) {
        for (const card of closingCards) {
          if (card.barRef == null) continue
          const item = times.get(card.id)
          if (item && Math.abs(item.time - m.exitTime) <= CLOSING_TOLERANCE_BARS * barMs) chartClosingHit = true
        }
      }
    }
  }

  // ---- 墙钟轴兜底：场内实时记录时卡片 createdAt ≈ 成交时间 ----
  const clockEntryHit =
    m.entryTime > 0 && entryCards.some((card) => Math.abs(card.createdAt - m.entryTime) <= IMPORT_MATCH_TOLERANCE_MS)
  const clockClosingHit =
    m.exitTime > 0 &&
    closingCards.some((card) => Math.abs(card.createdAt - m.exitTime) <= IMPORT_MATCH_TOLERANCE_MS)
  const clockWeak =
    m.entryTime > 0 &&
    caseCards.some(
      (card) =>
        card.createdAt >= m.entryTime - IMPORT_MATCH_WEAK_WINDOW_MS &&
        card.createdAt <= (m.exitTime > 0 ? m.exitTime : m.entryTime) + IMPORT_MATCH_WEAK_WINDOW_MS,
    )

  const entryTimeHit = chartEntryHit || clockEntryHit
  const closingTimeHit = chartClosingHit || clockClosingHit
  const priceHit = stopHit || targetHit || entryPriceHit
  const strong = entryTimeHit && (closingTimeHit || priceHit) && !directionMismatch

  return {
    entryTimeHit,
    closingTimeHit,
    priceHit,
    directionMismatch,
    chartDistanceMs,
    strong,
  }
}

/** 弱匹配（墙钟区间重叠）单独判断：suggest 级兜底信号。 */
export function caseOverlapsTradeOnClock(trade: Trade, caseCards: CaseCard[]): boolean {
  const m = computeTradeMetrics(trade)
  if (m.entryTime <= 0) return false
  const end = m.exitTime > 0 ? m.exitTime : m.entryTime
  return caseCards.some(
    (card) =>
      card.createdAt >= m.entryTime - IMPORT_MATCH_WEAK_WINDOW_MS &&
      card.createdAt <= end + IMPORT_MATCH_WEAK_WINDOW_MS,
  )
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

  const scoredByTrade: Array<Array<{ caseId: string; signals: CaseTradeMatchSignals }>> = []
  for (const trade of importedTrades) {
    const scored: Array<{ caseId: string; signals: CaseTradeMatchSignals }> = []
    for (const caseRecord of available) {
      if (caseRecord.accountId !== trade.accountId) continue
      const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
      const signals = analyzeCaseTradeMatch(trade, cards)
      if (signals.entryTimeHit || signals.priceHit) scored.push({ caseId: caseRecord.id, signals })
    }
    scoredByTrade.push(scored)
  }

  // 全局唯一分配：临近 Trade 的计划价格可能相近（生产样本两笔空单止损只差
  // 0.07%），多对同时 strong 时按质量（离场命中 > 价格佐证 > 图表距离）贪心
  // 消费，保证每个 Trade 自动绑定到最像的 Case，其余降级为建议人工确认。
  const pairs = scoredByTrade.flatMap((scored, tradeIndex) =>
    scored
      .filter((item) => item.signals.strong)
      .map((item) => ({
        tradeIndex,
        caseId: item.caseId,
        quality: (item.signals.closingTimeHit ? 2 : 0) + (item.signals.priceHit ? 1 : 0),
        distance: item.signals.chartDistanceMs ?? Number.MAX_SAFE_INTEGER,
      })),
  )
  pairs.sort((a, b) => b.quality - a.quality || a.distance - b.distance)
  // 完全并列（质量与图表距离都打平）的 strong 候选不做自动绑定——
  // 同信号下任选一个和猜没区别，留给人工确认
  const byTrade = new Map<number, typeof pairs>()
  for (const pair of pairs) {
    const list = byTrade.get(pair.tradeIndex)
    if (list) list.push(pair)
    else byTrade.set(pair.tradeIndex, [pair])
  }
  const tieTradeIndexes = new Set<number>()
  for (const list of byTrade.values()) {
    if (list.length >= 2 && list[0].quality === list[1].quality && list[0].distance === list[1].distance) {
      tieTradeIndexes.add(list[0].tradeIndex)
    }
  }
  const usedCaseIds = new Set<string>()
  const usedTradeIndexes = new Set<number>()
  const assigned = new Map<number, string>()
  for (const pair of pairs) {
    if (tieTradeIndexes.has(pair.tradeIndex)) continue
    if (usedCaseIds.has(pair.caseId) || usedTradeIndexes.has(pair.tradeIndex)) continue
    usedCaseIds.add(pair.caseId)
    usedTradeIndexes.add(pair.tradeIndex)
    assigned.set(pair.tradeIndex, pair.caseId)
  }

  return importedTrades.map((trade, tradeIndex) => {
    const scored = scoredByTrade[tradeIndex]
    const candidates: ImportMatchCandidate[] = scored.map((item) => ({
      caseId: item.caseId,
      entryMatched: item.signals.entryTimeHit,
      closingMatched: item.signals.closingTimeHit,
    }))
    const assignedCaseId = assigned.get(tradeIndex)
    if (assignedCaseId) {
      const target = candidates.find((candidate) => candidate.caseId === assignedCaseId)
      return { tradeId: trade.id, level: 'exact', candidates: target ? [target] : [] }
    }
    // 没分配到的 strong 对（被更佳组合抢走）与普通候选一起降级为建议；
    // 方向冲突的候选 strong 已为 false，本来就不会自动绑定
    const strong = candidates.filter((_, index) => scored[index].signals.strong)
    if (strong.length > 0) return { tradeId: trade.id, level: 'suggest', candidates: strong }
    if (candidates.length > 0) return { tradeId: trade.id, level: 'suggest', candidates }
    const weakCandidates: ImportMatchCandidate[] = []
    for (const caseRecord of available) {
      if (caseRecord.accountId !== trade.accountId) continue
      const cards = caseCards.filter((card) => card.caseId === caseRecord.id)
      if (caseOverlapsTradeOnClock(trade, cards)) {
        weakCandidates.push({ caseId: caseRecord.id, entryMatched: false, closingMatched: false })
      }
    }
    if (weakCandidates.length > 0) return { tradeId: trade.id, level: 'suggest', candidates: weakCandidates }
    return { tradeId: trade.id, level: 'none', candidates: [] }
  })
}
