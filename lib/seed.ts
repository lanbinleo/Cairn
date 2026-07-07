import type { Account, Period, Trade, TagDef, TagColor } from './types'

const T0 = Date.parse('2026-01-01T00:00:00Z')

export const seedTagDefs: TagDef[] = (
  [
    ['突破回踩', 'blue'],
    ['A+ 形态', 'green'],
    ['分批止盈', 'cyan'],
    ['加仓', 'purple'],
    ['移动止损', 'orange'],
    ['趋势跟随', 'blue'],
    ['区间交易', 'cyan'],
    ['开盘区间突破', 'purple'],
    ['止损', 'red'],
    ['假突破', 'red'],
    ['情绪单', 'orange'],
    ['追高', 'yellow'],
    ['震荡市', 'yellow'],
  ] as [string, TagColor][]
).map(([name, color], i) => ({ id: `tag-${i + 1}`, name, color, createdAt: T0 }))

export interface CairnStateSnapshot {
  accounts: Account[]
  periods: Period[]
  trades: Trade[]
  symbols: import('./types').TradingSymbol[]
  notes: import('./types').Note[]
  tagDefs: TagDef[]
}

export const seedState: CairnStateSnapshot = {
  accounts: [],
  periods: [],
  trades: [],
  symbols: [],
  notes: [],
  tagDefs: [],
}

export const emptyState: CairnStateSnapshot = seedState
