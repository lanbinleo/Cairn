/**
 * 交易表格一键复制（0.3.7）：当前表格视图 + 元数据（导出时间 / 笔数 / 账户 /
 * 进场时间范围）组成 TSV。粘进 Excel 是纯表格（# 行是注释），粘给 AI review
 * 自带上下文。数值列用裸数字（两位小数），可被表格软件直接解析。
 */

import { feeRatesResolverFor } from './fee'
import { fmtDuration, fmtUtcDateTime } from './format'
import { computeTradeMetrics } from './metrics'
import { sortTagNamesByColor } from './tags'
import type { Account, Period, TagDef, Trade, TradingSymbol } from './types'

const HEADER = ['交易', '品种', '方向', '账户 / Period', '标签', '进场时间（UTC）', '持仓', 'PnL', 'PnL%', 'R', '状态']

/** TSV 单元格清洗：账户/Period 名等用户输入可能带 tab/换行，会错位整行 */
function cell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ')
}

export interface TradesTableCopyInput {
  trades: Trade[]
  accounts: Account[]
  periods: Period[]
  symbols: TradingSymbol[]
  tagDefs: TagDef[]
  /** PnL% 分母（入场前权益），与表格同源 */
  equityBefore: Map<string, number>
}

export function buildTradesTableCopy(input: TradesTableCopyInput, now = Date.now()): string {
  const { trades, accounts, periods, symbols, tagDefs, equityBefore } = input
  const ratesFor = feeRatesResolverFor(accounts)
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const periodById = new Map(periods.map((period) => [period.id, period]))
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]))

  const ordered = [...trades].sort(
    (a, b) => computeTradeMetrics(b).entryTime - computeTradeMetrics(a).entryTime,
  )

  const rows = ordered.map((trade) => {
    const m = computeTradeMetrics(trade, ratesFor(trade))
    const account = accountById.get(trade.accountId)
    const period = periodById.get(trade.periodId)
    const symbol = symbolById.get(trade.symbolId)
    const base = equityBefore.get(trade.id)
    const pnlPct = trade.status === 'closed' && base ? (m.pnl / base) * 100 : null
    return [
      cell(`Trade #${String(trade.seq).padStart(3, '0')}`),
      cell(symbol ? `${symbol.exchange}:${symbol.code}` : trade.symbolId),
      trade.direction === 'long' ? '多' : '空',
      cell(`${account?.name ?? '未知账户'} · ${period?.name ?? '未知 Period'}`),
      cell(sortTagNamesByColor(trade.tags, tagDefs).join('、')),
      fmtUtcDateTime(m.entryTime, false),
      trade.status === 'closed' ? fmtDuration(m.durationMs) : '',
      trade.status === 'closed' ? m.pnl.toFixed(2) : '',
      pnlPct == null ? '' : pnlPct.toFixed(2),
      m.rMultiple == null ? '' : m.rMultiple.toFixed(2),
      trade.status === 'closed' ? '已平仓' : '持仓中',
    ].join('\t')
  })

  const meta: string[] = [`# Cairn 交易记录 · 复制于 ${fmtUtcDateTime(now)}`]
  meta.push(`# ${ordered.length} 笔`)
  if (ordered.length > 0) {
    const accountNames = [...new Set(ordered.map((trade) => accountById.get(trade.accountId)?.name).filter(Boolean))]
    if (accountNames.length > 0) meta.push(cell(`# 账户：${accountNames.join('、')}`))
    const entryTimes = ordered.map((trade) => computeTradeMetrics(trade).entryTime)
    meta.push(`# 进场范围 ${fmtUtcDateTime(Math.min(...entryTimes), false)} – ${fmtUtcDateTime(Math.max(...entryTimes), false)} UTC`)
  }

  return [...meta, HEADER.join('\t'), ...rows].join('\n')
}
