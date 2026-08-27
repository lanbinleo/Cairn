import type { Execution, ExecutionAction, OrderType } from './types'

export const POSITION_EXECUTION_ACTIONS: ExecutionAction[] = ['entry', 'scale-in', 'scale-out', 'exit']
export const MANAGEMENT_EXECUTION_ACTIONS: ExecutionAction[] = ['stop', 'stop-set', 'stop-moved', 'target-set', 'target-moved', 'order-edit']

export const EXECUTION_ACTION_OPTIONS: Array<{ value: ExecutionAction; label: string }> = [
  { value: 'undecided', label: 'Undecided' },
  { value: 'entry', label: 'Entry' },
  { value: 'scale-in', label: 'Scale in' },
  { value: 'scale-out', label: 'Scale out' },
  { value: 'exit', label: 'Exit' },
  { value: 'stop', label: 'Move stop' },
  { value: 'target-moved', label: 'Move target' },
  { value: 'order-edit', label: 'Add / edit order' },
]

export const ORDER_TYPE_OPTIONS: Array<{ value: OrderType; label: string }> = [
  { value: 'market', label: 'Market' },
  { value: 'limit', label: 'Limit' },
  { value: 'stop', label: 'Stop' },
  { value: 'stop-limit', label: 'Stop limit' },
  { value: 'stop-loss', label: 'Stop loss' },
  { value: 'take-profit', label: 'Take profit' },
  { value: 'trailing-stop', label: 'Trailing stop' },
]

export const executionActionLabel: Record<ExecutionAction, string> = Object.fromEntries(
  [
    ...EXECUTION_ACTION_OPTIONS,
    { value: 'stop-set' as const, label: 'Set stop' },
    { value: 'stop-moved' as const, label: 'Move stop' },
    { value: 'target-set' as const, label: 'Set target' },
  ].map((option) => [option.value, option.label]),
) as Record<ExecutionAction, string>

export const orderTypeLabel: Record<OrderType, string> = Object.fromEntries(
  ORDER_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<OrderType, string>

export function isPositionExecutionAction(action: ExecutionAction) {
  return POSITION_EXECUTION_ACTIONS.includes(action)
}

export function isManagementExecutionAction(action: ExecutionAction) {
  return MANAGEMENT_EXECUTION_ACTIONS.includes(action)
}

export function isEntryExecution(execution: Pick<Execution, 'action'>) {
  return execution.action === 'entry' || execution.action === 'scale-in'
}

export function isExitExecution(execution: Pick<Execution, 'action'>) {
  return execution.action === 'scale-out' || execution.action === 'exit'
}

export function hasPositionFill(execution: Execution): execution is Execution & { price: number; quantity: number } {
  return isPositionExecutionAction(execution.action) && Number.isFinite(execution.price) && Number.isFinite(execution.quantity) && (execution.quantity ?? 0) > 0
}
