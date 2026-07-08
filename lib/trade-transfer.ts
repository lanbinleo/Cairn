import type { Execution, Trade, TradeEvent, TradingSymbol } from './types'

export interface TradeTransferPayload {
  kind: 'cairn.trade'
  version: 1
  exportedAt: number
  includeChartData: boolean
  symbol?: Pick<TradingSymbol, 'exchange' | 'code' | 'name' | 'category' | 'pricePrecision'>
  trade: Omit<Trade, 'id' | 'seq' | 'accountId' | 'periodId' | 'symbolId' | 'importBatchId' | 'referenceImages' | 'createdAt' | 'executions' | 'events'> & {
    executions: Array<Omit<Execution, 'id' | 'tradeId'>>
    events: Array<Omit<TradeEvent, 'id' | 'tradeId'>>
  }
}

export function createTradeTransferPayload(
  trade: Trade,
  symbol: TradingSymbol | undefined,
  includeChartData: boolean,
): TradeTransferPayload {
  const { id: _id, seq: _seq, accountId: _accountId, periodId: _periodId, symbolId: _symbolId, importBatchId: _importBatchId, referenceImages: _referenceImages, createdAt: _createdAt, ...rest } = trade
  const { chartBars, chartData, executions, events, ...tradeRest } = rest
  return {
    kind: 'cairn.trade',
    version: 1,
    exportedAt: Date.now(),
    includeChartData,
    symbol: symbol
      ? {
          exchange: symbol.exchange,
          code: symbol.code,
          name: symbol.name,
          category: symbol.category,
          pricePrecision: symbol.pricePrecision,
        }
      : undefined,
    trade: {
      ...tradeRest,
      ...(includeChartData ? { chartBars, chartData } : {}),
      executions: executions.map(({ id: _execId, tradeId: _execTradeId, ...execution }) => execution),
      events: events.map(({ id: _eventId, tradeId: _eventTradeId, ...event }) => event),
    },
  }
}

export function stringifyTradeTransfer(payload: TradeTransferPayload) {
  return JSON.stringify(payload, null, 2)
}

export function parseTradeTransferPayload(text: string): TradeTransferPayload {
  const parsed = JSON.parse(text) as Partial<TradeTransferPayload>
  if (parsed.kind !== 'cairn.trade' || parsed.version !== 1 || !parsed.trade) {
    throw new Error('不是有效的 CAIRN Trade JSON。')
  }
  if (!Array.isArray(parsed.trade.executions)) {
    throw new Error('Trade JSON 缺少 executions。')
  }
  return parsed as TradeTransferPayload
}
