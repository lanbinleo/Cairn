import type { Trade } from './types'

function positionSignature(trade: Trade) {
  return trade.executions
    .filter((execution) => ['entry', 'scale-in', 'scale-out', 'exit'].includes(execution.action))
    .map((execution) => ({
      action: execution.action,
      time: execution.time,
      quantity: execution.quantity ?? null,
    }))
    .sort((a, b) => a.time - b.time)
}

function samePositionSignature(a: ReturnType<typeof positionSignature>, b: ReturnType<typeof positionSignature>) {
  return (
    a.length > 0 &&
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]
      return (
        item.action === other.action &&
        item.time === other.time &&
        item.quantity === other.quantity
      )
    })
  )
}

export interface DuplicateTradeMatch {
  trade: Trade
  reasons: string[]
}

export function getPossibleDuplicateTrade(candidate: Trade, existingTrades: Trade[]): DuplicateTradeMatch | null {
  const candidateSignature = positionSignature(candidate)
  for (const trade of existingTrades) {
    if (trade.id === candidate.id) continue
    const existingSignature = positionSignature(trade)
    if (!samePositionSignature(candidateSignature, existingSignature)) continue

    return {
      trade,
      reasons: [
        `仓位 execution 数量一致：${candidateSignature.length}`,
        '每条入场/出场 execution 的 action、UTC 时间、仓位数量完全一致',
      ],
    }
  }
  return null
}

export function findPossibleDuplicateTrade(candidate: Trade, existingTrades: Trade[]): Trade | null {
  return getPossibleDuplicateTrade(candidate, existingTrades)?.trade ?? null
}
