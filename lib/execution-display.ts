import { hasPositionFill } from './executions'
import type { ChartBar, Execution } from './types'

const DEFAULT_BAR_INTERVAL_MS = 5 * 60_000

export interface DisplayExecution extends Execution {
  aggregateCount: number
  aggregateExecutionIds: string[]
  aggregateOriginals: Execution[]
}

function executionBucket(time: number, barIntervalMs: number) {
  return Math.floor(time / barIntervalMs) * barIntervalMs
}

function canAggregateExit(execution: Execution) {
  return hasPositionFill(execution) && (execution.action === 'scale-out' || execution.action === 'exit')
}

function aggregateGroup(group: Execution[]): DisplayExecution {
  if (group.length === 1) {
    return {
      ...group[0],
      aggregateCount: 1,
      aggregateExecutionIds: [group[0].id],
      aggregateOriginals: group,
    }
  }

  const quantity = group.reduce((sum, execution) => sum + (execution.quantity ?? 0), 0)
  const weightedPrice = quantity > 0
    ? group.reduce((sum, execution) => sum + (execution.quantity ?? 0) * (execution.price ?? 0), 0) / quantity
    : group[0].price
  const signals = [...new Set(group.map((execution) => execution.signal).filter(Boolean))]
  const notes = [...new Set(group.map((execution) => execution.note).filter(Boolean))]

  return {
    ...group[0],
    action: group.some((execution) => execution.action === 'exit') ? 'exit' : 'scale-out',
    time: Math.min(...group.map((execution) => execution.time)),
    price: weightedPrice,
    quantity,
    signal: signals.length > 0 ? signals.join(', ') : group[0].signal,
    note: notes.length > 0 ? notes.join(' | ') : group[0].note,
    aggregateCount: group.length,
    aggregateExecutionIds: group.map((execution) => execution.id),
    aggregateOriginals: group,
  }
}

export function aggregateDisplayExecutions(executions: Execution[], barIntervalMs = DEFAULT_BAR_INTERVAL_MS): DisplayExecution[] {
  const groups = new Map<string, Execution[]>()
  const passthrough: DisplayExecution[] = []

  for (const execution of executions) {
    if (!canAggregateExit(execution)) {
      passthrough.push({
        ...execution,
        aggregateCount: 1,
        aggregateExecutionIds: [execution.id],
        aggregateOriginals: [execution],
      })
      continue
    }

    const key = [
      executionBucket(execution.time, barIntervalMs),
      execution.price,
    ].join(':')
    groups.set(key, [...(groups.get(key) ?? []), execution])
  }

  const aggregated = [...groups.values()].map((group) =>
    aggregateGroup([...group].sort((a, b) => a.time - b.time)),
  )
  return [...passthrough, ...aggregated].sort((a, b) => a.time - b.time)
}

export function inferChartBarIntervalMs(bars: ChartBar[]) {
  if (bars.length < 2) return DEFAULT_BAR_INTERVAL_MS
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const firstGap = sorted[1].time - sorted[0].time
  return Number.isFinite(firstGap) && firstGap > 0 ? firstGap : DEFAULT_BAR_INTERVAL_MS
}
