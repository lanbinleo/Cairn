import { describe, expect, it } from 'vitest'

import { aggregateDisplayExecutions } from './execution-display'
import type { Execution } from './types'

let seq = 0
function execution(action: Execution['action'], time: number, price: number, quantity: number): Execution {
  seq += 1
  return {
    id: `e${seq}`,
    tradeId: 't1',
    action,
    orderType: 'market',
    time,
    price,
    quantity,
  }
}

const T = Date.UTC(2026, 0, 10, 22, 30)
const BAR = 5 * 60_000

describe('aggregateDisplayExecutions', () => {
  it('同 bar 同价的同时入场 fill 聚合为一笔 entry（冰山拆单）', () => {
    const out = aggregateDisplayExecutions([
      execution('entry', T, 90491.93, 4),
      execution('scale-in', T + 1000, 90491.93, 4.1928),
    ], BAR)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('entry')
    expect(out[0].quantity).toBeCloseTo(8.1928, 6)
    expect(out[0].price).toBeCloseTo(90491.93, 6)
    expect(out[0].aggregateCount).toBe(2)
    expect(out[0].aggregateOriginals).toHaveLength(2)
  })

  it('同 bar 同价的同时离场 fill 聚合为一笔 exit', () => {
    const out = aggregateDisplayExecutions([
      execution('exit', T, 90618.86, 4.1928),
      execution('scale-out', T + 500, 90618.86, 4),
    ], BAR)
    expect(out).toHaveLength(1)
    expect(out[0].action).toBe('exit')
    expect(out[0].aggregateCount).toBe(2)
  })

  it('入场与离场即使同 bar 同价也不互相合并', () => {
    const out = aggregateDisplayExecutions([
      execution('entry', T, 90000, 1),
      execution('exit', T, 90000, 1),
    ], BAR)
    expect(out).toHaveLength(2)
    expect(out[0].action).toBe('entry')
    expect(out[1].action).toBe('exit')
  })

  it('同 bar 不同价不合并；不同 bar 同价不合并', () => {
    expect(
      aggregateDisplayExecutions([
        execution('entry', T, 90000, 1),
        execution('entry', T, 90001, 1),
      ], BAR),
    ).toHaveLength(2)
    expect(
      aggregateDisplayExecutions([
        execution('entry', T, 90000, 1),
        execution('entry', T + BAR, 90000, 1),
      ], BAR),
    ).toHaveLength(2)
  })

  it('管理类 Execution 原样透传', () => {
    seq += 1
    const stop: Execution = {
      id: `e${seq}`,
      tradeId: 't1',
      action: 'stop',
      orderType: 'stop-loss',
      time: T,
      price: 90364,
    }
    const out = aggregateDisplayExecutions([stop], BAR)
    expect(out).toHaveLength(1)
    expect(out[0].aggregateCount).toBe(1)
    expect(out[0].action).toBe('stop')
  })
})
