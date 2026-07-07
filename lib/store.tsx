'use client'

/**
 * Cairn 客户端数据层（会话内可变）。
 * 以 mock 数据为初始状态，提供 Account / Period / Trade / Tag 的编辑操作。
 * 后端就绪后，此处的 setState 将替换为 REST API 调用 + SWR mutate（见 docs/backend-design.md）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadLocalState, saveLocalRecord, deleteLocalRecord } from './local-db'
import { seedState } from './seed'
import type { Account, Period, Trade, TagDef, TagColor } from './types'

/* ---------- Context ---------- */

interface CairnStore {
  accounts: Account[]
  periods: Period[]
  trades: Trade[]
  tagDefs: TagDef[]
  symbols: typeof seedState.symbols
  notes: typeof seedState.notes
  /* 查询 */
  getAccount: (id: string) => Account | undefined
  getPeriod: (id: string) => Period | undefined
  getTrade: (id: string) => Trade | undefined
  getSymbol: (id: string) => (typeof seedState.symbols)[number] | undefined
  getTagDef: (name: string) => TagDef | undefined
  symbolLabel: (id: string) => string
  getNotesMentioningTrade: (tradeId: string) => typeof seedState.notes
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
  const [accounts, setAccounts] = useState<Account[]>(seedState.accounts)
  const [periods, setPeriods] = useState<Period[]>(seedState.periods)
  const [trades, setTrades] = useState<Trade[]>(seedState.trades)
  const [symbols, setSymbols] = useState(seedState.symbols)
  const [notes, setNotes] = useState(seedState.notes)
  const [tagDefs, setTagDefs] = useState<TagDef[]>(seedState.tagDefs)

  useEffect(() => {
    let cancelled = false
    loadLocalState()
      .then((snapshot) => {
        if (cancelled) return
        setAccounts(snapshot.accounts)
        setPeriods(snapshot.periods)
        setTrades(snapshot.trades)
        setSymbols(snapshot.symbols)
        setNotes(snapshot.notes)
        setTagDefs(snapshot.tagDefs)
      })
      .catch((err) => {
        console.error('Failed to load local CAIRN state', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateAccount = useCallback((id: string, patch: Partial<Account>) => {
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        const next = { ...a, ...patch }
        void saveLocalRecord('accounts', next)
        return next
      }),
    )
  }, [])

  const updatePeriod = useCallback((id: string, patch: Partial<Period>) => {
    setPeriods((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, ...patch }
        void saveLocalRecord('periods', next)
        return next
      }),
    )
  }, [])

  const updateTrade = useCallback((id: string, patch: Partial<Trade>) => {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, ...patch }
        void saveLocalRecord('trades', next)
        return next
      }),
    )
  }, [])

  const setTradeStatus = useCallback((id: string, status: Trade['status']) => {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, status }
        void saveLocalRecord('trades', next)
        return next
      }),
    )
  }, [])

  const createTag = useCallback(
    (name: string, color: TagColor): TagDef | null => {
      const trimmed = name.trim()
      if (!trimmed) return null
      let created: TagDef | null = null
      setTagDefs((prev) => {
        if (prev.some((t) => t.name === trimmed)) return prev
        created = { id: `tag-${Date.now()}`, name: trimmed, color, createdAt: Date.now() }
        void saveLocalRecord('tagDefs', created)
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
          tp.map((t) => {
            if (!t.tags.includes(target.name)) return t
            const next = { ...t, tags: t.tags.map((n) => (n === target.name ? newName : n)) }
            void saveLocalRecord('trades', next)
            return next
          }),
        )
      }
      return prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, ...patch, name: patch.name?.trim() || t.name }
        void saveLocalRecord('tagDefs', next)
        return next
      })
    })
  }, [])

  const deleteTag = useCallback((id: string) => {
    setTagDefs((prev) => {
      const target = prev.find((t) => t.id === id)
      if (!target) return prev
      setTrades((tp) =>
        tp.map((t) => {
          if (!t.tags.includes(target.name)) return t
          const next = { ...t, tags: t.tags.filter((n) => n !== target.name) }
          void saveLocalRecord('trades', next)
          return next
        }),
      )
      void deleteLocalRecord('tagDefs', id)
      return prev.filter((t) => t.id !== id)
    })
  }, [])

  const value = useMemo<CairnStore>(
    () => ({
      accounts,
      periods,
      trades,
      tagDefs,
      symbols,
      notes,
      getAccount: (id) => accounts.find((a) => a.id === id),
      getPeriod: (id) => periods.find((p) => p.id === id),
      getTrade: (id) => trades.find((t) => t.id === id),
      getSymbol: (id) => symbols.find((s) => s.id === id),
      getTagDef: (name) => tagDefs.find((t) => t.name === name),
      symbolLabel: (id) => {
        const s = symbols.find((x) => x.id === id)
        return s ? `${s.exchange}:${s.code}` : id
      },
      getNotesMentioningTrade: (tradeId) =>
        notes.filter((n) => n.mentions.some((m) => m.type === 'trade' && m.ref === tradeId)),
      updateAccount,
      updatePeriod,
      updateTrade,
      setTradeStatus,
      createTag,
      updateTag,
      deleteTag,
    }),
    [accounts, periods, trades, tagDefs, symbols, notes, updateAccount, updatePeriod, updateTrade, setTradeStatus, createTag, updateTag, deleteTag],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useCairn(): CairnStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useCairn 必须在 CairnProvider 内使用')
  return ctx
}
