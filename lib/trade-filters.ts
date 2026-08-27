/**
 * 交易列表高级筛选：条件模型、匹配与预设持久化（localStorage，设备级偏好）。
 */

import { computeTradeMetrics } from './metrics'
import { savedProcessScoreTotal } from './process-score'
import type { Trade } from './types'

export interface TradeFilterConditions {
  status?: 'open' | 'closed'
  rMin?: number
  rMax?: number
  scoreMin?: number
  scoreMax?: number
  /** 只看未评分（勾选时排除已评分，忽略分数区间） */
  flagUnscored?: boolean
  /** 出场未按计划（保存的 exitPerPlan = 0） */
  flagExitOffPlan?: boolean
  /** 止损存在放宽（保存的快照 stopOnlyTightened = false） */
  flagStopWidened?: boolean
  /** 缺初始止损（无法计算 R） */
  flagNoInitialStop?: boolean
}

export const EMPTY_TRADE_FILTER: TradeFilterConditions = {}

export function isTradeFilterEmpty(conditions: TradeFilterConditions): boolean {
  return (
    conditions.status == null &&
    conditions.rMin == null &&
    conditions.rMax == null &&
    conditions.scoreMin == null &&
    conditions.scoreMax == null &&
    !conditions.flagUnscored &&
    !conditions.flagExitOffPlan &&
    !conditions.flagStopWidened &&
    !conditions.flagNoInitialStop
  )
}

/** 条件 → chip 文案（key 用于逐项移除） */
export function tradeFilterChips(conditions: TradeFilterConditions): Array<{ key: keyof TradeFilterConditions; label: string }> {
  const chips: Array<{ key: keyof TradeFilterConditions; label: string }> = []
  if (conditions.status != null) chips.push({ key: 'status', label: conditions.status === 'closed' ? '已平仓' : '持仓中' })
  if (conditions.rMin != null) chips.push({ key: 'rMin', label: `R ≥ ${conditions.rMin}` })
  if (conditions.rMax != null) chips.push({ key: 'rMax', label: `R ≤ ${conditions.rMax}` })
  if (conditions.scoreMin != null) chips.push({ key: 'scoreMin', label: `过程分 ≥ ${conditions.scoreMin}` })
  if (conditions.scoreMax != null) chips.push({ key: 'scoreMax', label: `过程分 ≤ ${conditions.scoreMax}` })
  if (conditions.flagUnscored) chips.push({ key: 'flagUnscored', label: '未评分' })
  if (conditions.flagExitOffPlan) chips.push({ key: 'flagExitOffPlan', label: '出场未按计划' })
  if (conditions.flagStopWidened) chips.push({ key: 'flagStopWidened', label: '止损有放宽' })
  if (conditions.flagNoInitialStop) chips.push({ key: 'flagNoInitialStop', label: '缺初始止损' })
  return chips
}

export function matchesTradeFilter(trade: Trade, conditions: TradeFilterConditions): boolean {
  if (conditions.status != null && trade.status !== conditions.status) return false

  if (conditions.rMin != null || conditions.rMax != null) {
    const { rMultiple } = computeTradeMetrics(trade)
    if (rMultiple == null) return false
    if (conditions.rMin != null && rMultiple < conditions.rMin) return false
    if (conditions.rMax != null && rMultiple > conditions.rMax) return false
  }

  const score = savedProcessScoreTotal(trade.processScore)
  if (conditions.flagUnscored) {
    if (score != null) return false
  } else if (conditions.scoreMin != null || conditions.scoreMax != null) {
    if (score == null) return false
    if (conditions.scoreMin != null && score < conditions.scoreMin) return false
    if (conditions.scoreMax != null && score > conditions.scoreMax) return false
  }

  if (conditions.flagExitOffPlan && trade.processScore?.exitPerPlan !== 0) return false
  if (conditions.flagStopWidened && trade.processScore?.computed?.stopOnlyTightened !== false) return false
  if (conditions.flagNoInitialStop && trade.initialStopLoss != null) return false

  return true
}

export function removeTradeFilterKey(conditions: TradeFilterConditions, key: keyof TradeFilterConditions): TradeFilterConditions {
  const next = { ...conditions }
  delete next[key]
  return next
}

/* ---------- 预设（localStorage，设备级） ---------- */

export interface TradeFilterPreset {
  id: string
  name: string
  conditions: TradeFilterConditions
  createdAt: number
}

const PRESET_STORAGE_KEY = 'cairn.tradeFilterPresets.v1'

export function loadTradeFilterPresets(): TradeFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTradeFilterPresets(presets: TradeFilterPreset[]) {
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // 存储不可用时静默降级为会话内预设
  }
}
