/**
 * 整单 AI 总结的上下文组装（纯函数）：Case 卡片 + 绑定 Trade 的执行事实 + 指标。
 * metrics/计划对比都在 TS 侧计算，Rust 只做 AI 管道；本模块的输出即模型的全部输入。
 * 硬规则在系统提示侧：只描述事实与偏差、不打分、资料里没有的不许编。
 */

import { caseCardDigest } from './cases'
import { computeTradeMetrics } from './metrics'
import { fmtDuration, fmtMoney, fmtNum, fmtQty, fmtR, fmtUtcDateTime } from './format'
import type { Account, CaseCard, Period, Trade, TradeCase, TradingSymbol } from './types'

const PHASE_NAME: Record<CaseCard['phase'], string> = {
  'pre-entry': '观察',
  entry: '入场',
  intermediate: '过程',
  closing: '离场',
  reflection: '复盘',
}

const ACTION_NAME: Record<string, string> = {
  entry: '开仓',
  'scale-in': '加仓',
  'scale-out': '减仓',
  exit: '平仓',
  stop: '移动止损',
  'stop-set': '设置止损',
  'stop-moved': '移动止损',
  'target-set': '设置止盈',
  'target-moved': '移动止盈',
  'order-edit': '修改订单',
  undecided: '未定',
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export interface CaseSummaryContextInput {
  caseRecord: TradeCase
  cards: CaseCard[]
  trade?: Trade | null
  account?: Account | null
  period?: Period | null
  symbol?: TradingSymbol | null
}

export function buildCaseSummaryContext(input: CaseSummaryContextInput): string {
  const { caseRecord, cards, trade, account, period, symbol } = input
  const lines: string[] = []

  const statusName = caseRecord.status === 'active' ? '记录中' : caseRecord.status === 'closed' ? '已完成' : '已归档'
  lines.push(`Case：「${caseRecord.title}」（${statusName}，${caseRecord.provenance === 'forward' ? '当时记录' : '事后记录'}）`)
  const meta: string[] = []
  if (symbol) meta.push(`${symbol.exchange} ${symbol.code}`.trim())
  if (period) meta.push(`Period ${period.name}`)
  if (account) meta.push(`账户 ${account.name}（${account.kind === 'backtest' ? '回测' : '实盘'}）`)
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (trade) {
    const m = computeTradeMetrics(trade)
    // 数字一律格式化后再进上下文：浮点噪声（2.4425999999999997）会被模型原样复述
    const price = (value: number) => fmtNum(value, symbol?.pricePrecision ?? 6)
    const direction = trade.direction === 'long' ? '做多' : '做空'
    const status = trade.status === 'closed' ? '已平仓' : '持仓中'
    lines.push(`Trade #${trade.seq} ${direction} ${status}`)
    if (m.entryTime > 0 && m.exitTime > 0) {
      lines.push(`开仓 ${fmtUtcDateTime(m.entryTime, false)} @ ${price(m.avgEntry)} · 平仓 ${fmtUtcDateTime(m.exitTime, false)} @ ${price(m.avgExit)} · 持仓 ${fmtDuration(m.durationMs)}`)
    }
    lines.push(`总仓位 ${fmtQty(m.totalQuantity)} · 盈亏 ${fmtMoney(m.pnl)} · R（初始风险）${fmtR(m.rMultiple)} · R（实际风险）${fmtR(m.rActual)}`)
    const plan: string[] = []
    if (trade.initialEntryPrice != null) plan.push(`入场 ${price(trade.initialEntryPrice)}`)
    if (trade.initialStopLoss != null) plan.push(`止损 ${price(trade.initialStopLoss)}`)
    if (trade.initialTakeProfit != null) plan.push(`止盈 ${price(trade.initialTakeProfit)}`)
    lines.push(plan.length > 0 ? `初始计划：${plan.join(' · ')}${m.finalStop != null && trade.initialStopLoss != null && m.finalStop !== trade.initialStopLoss ? `（最终止损 ${price(m.finalStop)}，有移动）` : ''}` : '初始计划：未记录')

    const executions = [...trade.executions].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    if (executions.length > 0) {
      lines.push('执行动作时间线（来自交易所导出与手动记录）：')
      for (const execution of executions) {
        const parts = [ACTION_NAME[execution.action] ?? execution.action]
        if (execution.price != null) parts.push(`${price(execution.price)}`)
        if (execution.quantity != null) parts.push(`×${fmtQty(execution.quantity)}`)
        parts.push(`（${fmtUtcDateTime(execution.time, false)}${execution.signal ? `，${execution.signal}` : ''}）`)
        lines.push(`- ${parts.join(' ')}`)
      }
    }
  } else {
    lines.push('未绑定 Trade（纯观察记录，无成交数据）')
  }

  if (cards.length > 0) {
    lines.push('卡片记录（交易者的口语原话，按时间排列）：')
    for (const card of cards) {
      const bar = card.barRef != null ? ` BAR${card.barRef}` : ''
      const digest = caseCardDigest(card)
      const body = truncate(card.rawText, 500)
      lines.push(digest ? `- [${PHASE_NAME[card.phase]}]${bar}（提要：${digest}）${body}` : `- [${PHASE_NAME[card.phase]}]${bar} ${body}`)
    }
  }

  return lines.join('\n')
}
