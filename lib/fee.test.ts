import { describe, expect, it } from 'vitest'

import { executionFee, feeRatesForAccount, hasFeeRates, isTakerOrder } from './fee'
import type { Execution, ExecutionAction, OrderType } from './types'

function exec(partial: Partial<Execution> & { action?: ExecutionAction; orderType?: OrderType }): Execution {
  return {
    id: 'ex1',
    tradeId: 't1',
    action: 'entry',
    orderType: 'market',
    time: 0,
    ...partial,
  }
}

describe('isTakerOrder', () => {
  it('市价/触发类为 taker，限价/止盈为 maker', () => {
    expect(isTakerOrder('market')).toBe(true)
    expect(isTakerOrder('stop')).toBe(true)
    expect(isTakerOrder('stop-loss')).toBe(true)
    expect(isTakerOrder('stop-limit')).toBe(true)
    expect(isTakerOrder('trailing-stop')).toBe(true)
    expect(isTakerOrder('limit')).toBe(false)
    expect(isTakerOrder('take-profit')).toBe(false)
  })
})

describe('feeRatesForAccount', () => {
  it('缺省字段归零，hasFeeRates 判定', () => {
    expect(feeRatesForAccount({})).toEqual({ takerPct: 0, makerPct: 0 })
    expect(hasFeeRates(feeRatesForAccount({}))).toBe(false)
    expect(hasFeeRates(feeRatesForAccount({ takerFeePct: 0.05 }))).toBe(true)
    expect(hasFeeRates(feeRatesForAccount({ makerFeePct: 0.02 }))).toBe(true)
  })
})

describe('executionFee', () => {
  const rates = { takerPct: 0.05, makerPct: 0.02 }

  it('taker/maker 按成交额百分比计提', () => {
    expect(executionFee(exec({ price: 65200, quantity: 0.5, orderType: 'market' }), rates)).toBeCloseTo(16.3, 10)
    expect(executionFee(exec({ price: 65800, quantity: 0.5, orderType: 'limit' }), rates)).toBeCloseTo(6.58, 10)
    expect(executionFee(exec({ price: 100, quantity: 10, orderType: 'take-profit' }), rates)).toBeCloseTo(0.2, 10)
  })

  it('管理类动作不计费', () => {
    expect(executionFee(exec({ action: 'stop', price: 100, quantity: 10 }), rates)).toBe(0)
    expect(executionFee(exec({ action: 'target-moved', price: 100, quantity: 10 }), rates)).toBe(0)
  })

  it('feeOverride 是真实记录，直接采用（绝对值）', () => {
    expect(executionFee(exec({ price: 65200, quantity: 0.5, feeOverride: -16.3 }), rates)).toBe(16.3)
    expect(executionFee(exec({ action: 'stop', feeOverride: 2 }), rates)).toBe(2)
  })

  it('缺价格/数量或零费率时为 0', () => {
    expect(executionFee(exec({ orderType: 'market' }), rates)).toBe(0)
    expect(executionFee(exec({ price: 100, quantity: 10, orderType: 'market' }), { takerPct: 0, makerPct: 0 })).toBe(0)
  })
})
