'use client'

/**
 * Cairn 客户端数据层（会话内可变）。
 * 以 mock 数据为初始状态，提供 Account / Period / Trade / Tag 的编辑操作。
 * 后端就绪后，此处的 setState 将替换为 REST API 调用 + SWR mutate（见 docs/backend-design.md）。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  accounts as mockAccounts,
  periods as mockPeriods,
  trades as mockTrades,
  symbols as mockSymbols,
  notes as mockNotes,
} from './mock-data'
import type { Account, Period, Trade, TagDef, TagColor } from './types'

/* ---------- 初始标签定义：从 mock 交易标签推导，各配一色 ---------- */

const T0 = Date.parse('2026-01-01T00:00:00Z')

const initialTagDefs: TagDef[] = (
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

/* ---------- Context ---------- */

interface CairnStore {
  accounts: Account[]
  periods: Period[]
  trades: Trade[]
  tagDefs: TagDef[]
  symbols: typeof mockSymbols
  notes: typeof mockNotes
  /* 查询 */
  getAccount: (id: string) => Account | undefined
  getPeriod: (id: string) => Period | undefined
  getTrade: (id: string) => Trade | undefined
  getTagDef: (name: string) => TagDef | undefined
  /* 编辑 */
  updateAccount: (id: string, patch: Partial<Account>) => void
  updatePeriod: (id: string, patch: Partial<Period>) => void
  updateTrade: (id: string, patch: Partial<Trade>) => void
  /** 快速平仓 / 重新打开 */
  setTradeStatus: (id: string, status: Trade['status']) => void
  /* 标签 */
  createTag: (name: string, color: TagColor) => TagDef | null
  updateTag: (id: string, patch: Partial<Pick<TagDef, 'name' | 'color'>>) => void
  deleteTag: (id: string) => void
}

const StoreContext = createContext<CairnStore | null>(null)

export function CairnProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(mockAccounts)
  const [periods, setPeriods] = useState<Period[]>(mockPeriods)
  const [trades, setTrades] = useState<Trade[]>(mockTrades)
  const [tagDefs, setTagDefs] = useState<TagDef[]>(initialTagDefs)

  const updateAccount = useCallback((id: string, patch: Partial<Account>) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }, [])

  const updatePeriod = useCallback((id: string, patch: Partial<Period>) => {
    setPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const updateTrade = useCallback((id: string, patch: Partial<Trade>) => {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const setTradeStatus = useCallback((id: string, status: Trade['status']) => {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
  }, [])

  const createTag = useCallback(
    (name: string, color: TagColor): TagDef | null => {
      const trimmed = name.trim()
      if (!trimmed) return null
      let created: TagDef | null = null
      setTagDefs((prev) => {
        if (prev.some((t) => t.name === trimmed)) return prev
        created = { id: `tag-${Date.now()}`, name: trimmed, color, createdAt: Date.now() }
        return [...prev, created]
      })
      return created
    },
    [],
  )

  const updateTag = useCallback((id: string, patch: Partial<Pick<TagDef, 'name' | 'color'>>) => {
    setTagDefs((prev) => {
      const target = prev.find((t) => t.id === id)
      if (!target) return prev
      /* 重命名时同步更新所有 trade.tags 引用 */
      if (patch.name && patch.name !== target.name) {
        const newName = patch.name.trim()
        setTrades((tp) =>
          tp.map((t) =>
            t.tags.includes(target.name)
              ? { ...t, tags: t.tags.map((n) => (n === target.name ? newName : n)) }
              : t,
          ),
        )
      }
      return prev.map((t) => (t.id === id ? { ...t, ...patch, name: patch.name?.trim() || t.name } : t))
    })
  }, [])

  const deleteTag = useCallback((id: string) => {
    setTagDefs((prev) => {
      const target = prev.find((t) => t.id === id)
      if (!target) return prev
      setTrades((tp) =>
        tp.map((t) =>
          t.tags.includes(target.name) ? { ...t, tags: t.tags.filter((n) => n !== target.name) } : t,
        ),
      )
      return prev.filter((t) => t.id !== id)
    })
  }, [])

  const value = useMemo<CairnStore>(
    () => ({
      accounts,
      periods,
      trades,
      tagDefs,
      symbols: mockSymbols,
      notes: mockNotes,
      getAccount: (id) => accounts.find((a) => a.id === id),
      getPeriod: (id) => periods.find((p) => p.id === id),
      getTrade: (id) => trades.find((t) => t.id === id),
      getTagDef: (name) => tagDefs.find((t) => t.name === name),
      updateAccount,
      updatePeriod,
      updateTrade,
      setTradeStatus,
      createTag,
      updateTag,
      deleteTag,
    }),
    [accounts, periods, trades, tagDefs, updateAccount, updatePeriod, updateTrade, setTradeStatus, createTag, updateTag, deleteTag],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useCairn(): CairnStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useCairn 必须在 CairnProvider 内使用')
  return ctx
}
