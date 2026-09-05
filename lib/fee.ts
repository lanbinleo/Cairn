/**
 * 手续费：账户级 Taker/Maker 费率，事后按成交额逐笔计提（开平双边）。
 * 费率是配置而非记录——导入/录单时不写死，改费率即追溯重算全部历史统计；
 * 仅 Execution.feeOverride（导入文件的 Commission/手续费 列）是真实记录，优先于推算。
 * 这一层逻辑与 UI 无关，与 metrics 同级。
 */

import { isPositionExecutionAction } from './executions'
import type { Account, Execution, OrderType } from './types'

export interface FeeRates {
  /** Taker 费率（百分比数值：0.05 = 0.05%）；0 = 不计 */
  takerPct: number
  /** Maker 费率（百分比数值：0.02 = 0.02%）；0 = 不计 */
  makerPct: number
}

export const ZERO_FEE_RATES: FeeRates = { takerPct: 0, makerPct: 0 }

export function feeRatesForAccount(account: Pick<Account, 'takerFeePct' | 'makerFeePct'>): FeeRates {
  return {
    takerPct: account.takerFeePct ?? 0,
    makerPct: account.makerFeePct ?? 0,
  }
}

/** 混合账户集合的费率 resolver：dashboard / 交易列表等跨账户面用 */
export function feeRatesResolverFor(
  accounts: Array<Pick<Account, 'id' | 'takerFeePct' | 'makerFeePct'>>,
): (trade: { accountId: string }) => FeeRates | undefined {
  const byId = new Map(accounts.map((account) => [account.id, feeRatesForAccount(account)]))
  return (trade) => byId.get(trade.accountId)
}

export function hasFeeRates(rates: FeeRates): boolean {
  return rates.takerPct > 0 || rates.makerPct > 0
}

/** 费率输入框文本 → 百分比数值；空 / 非法 / ≤0 → undefined（不计费） */
export function parseFeePctInput(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const MAKER_ORDER_TYPES: readonly OrderType[] = ['limit', 'take-profit']

/** 市价/触发类订单按 Taker 计费；限价与止盈限价按 Maker 计费 */
export function isTakerOrder(orderType: OrderType): boolean {
  return !MAKER_ORDER_TYPES.includes(orderType)
}

/**
 * 单笔 fill 的手续费（账户货币）。非仓位类动作不计费；feeOverride 为导入的真实记录，
 * 直接采用（取绝对值）；费率推算 = |成交价| × 数量 × 费率。数据层不取整。
 */
export function executionFee(
  execution: Pick<Execution, 'action' | 'orderType' | 'price' | 'quantity' | 'feeOverride'>,
  rates: FeeRates,
): number {
  if (execution.feeOverride != null) return Math.abs(execution.feeOverride)
  if (!isPositionExecutionAction(execution.action)) return 0
  const price = execution.price
  const quantity = execution.quantity
  if (price == null || quantity == null) return 0
  const pct = isTakerOrder(execution.orderType) ? rates.takerPct : rates.makerPct
  return Math.abs(price) * quantity * (pct / 100)
}
