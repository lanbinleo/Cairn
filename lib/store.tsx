'use client'

/**
 * Cairn 客户端数据层（会话内可变）。
 * 以 mock 数据为初始状态，提供 Account / Period / Trade / Tag 的编辑操作。
 * 后端就绪后，此处的 setState 将替换为 REST API 调用 + SWR mutate（见 docs/backend-design.md）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadLocalState, saveLocalRecord, deleteLocalRecord, restoreLocalState, exportLocalBackup } from './local-db'
import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'
import { logFrontendError, logFrontendMessage } from './frontend-log'
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
  updateNote: (id: string, patch: Partial<(typeof seedState.notes)[number]>) => void
  createAccount: (input: Omit<Account, 'id' | 'createdAt'>) => Account
  createPeriod: (input: Omit<Period, 'id' | 'createdAt'>) => Period
  createSymbol: (input: Omit<(typeof seedState.symbols)[number], 'id'>) => (typeof seedState.symbols)[number]
  createNote: (input: Omit<(typeof seedState.notes)[number], 'id' | 'createdAt' | 'updatedAt'>) => (typeof seedState.notes)[number]
  createTrades: (records: Trade[]) => void
  deleteAccount: (id: string) => void
  deletePeriod: (id: string) => void
  deleteTrade: (id: string) => void
  deleteSymbol: (id: string) => void
  deleteNote: (id: string) => void
  restoreState: (snapshot: CairnStateSnapshot) => Promise<void>
  exportBackup: () => Promise<string>
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

  const makeId = useCallback((prefix: string) => {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }, [])

  const createAccount = useCallback((input: Omit<Account, 'id' | 'createdAt'>): Account => {
    const created: Account = { ...input, id: makeId('acc'), createdAt: Date.now() }
    setAccounts((prev) => [...prev, created])
    void saveLocalRecord('accounts', created)
    return created
  }, [makeId])

  const createPeriod = useCallback((input: Omit<Period, 'id' | 'createdAt'>): Period => {
    const created: Period = { ...input, id: makeId('per'), createdAt: Date.now() }
    setPeriods((prev) => [...prev, created])
    void saveLocalRecord('periods', created)
    return created
  }, [makeId])

  const createSymbol = useCallback((input: Omit<(typeof seedState.symbols)[number], 'id'>) => {
    const created = { ...input, id: makeId('sym') }
    setSymbols((prev) => [...prev, created])
    void saveLocalRecord('symbols', created)
    return created
  }, [makeId])

  const createNote = useCallback((input: Omit<(typeof seedState.notes)[number], 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const created = { ...input, id: makeId('note'), createdAt: now, updatedAt: now }
    setNotes((prev) => [...prev, created])
    void saveLocalRecord('notes', created)
    return created
  }, [makeId])

  const createTrades = useCallback((records: Trade[]) => {
    if (records.length === 0) return
    setTrades((prev) => [...prev, ...records])
    records.forEach((record) => {
      void saveLocalRecord('trades', record)
    })
  }, [])

  const deleteTrade = useCallback((id: string) => {
    setTrades((prev) => prev.filter((trade) => trade.id !== id))
    void deleteLocalRecord('trades', id)
  }, [])

  const deletePeriod = useCallback((id: string) => {
    setPeriods((prev) => prev.filter((period) => period.id !== id))
    setTrades((prev) => {
      const removed = prev.filter((trade) => trade.periodId === id)
      removed.forEach((trade) => void deleteLocalRecord('trades', trade.id))
      return prev.filter((trade) => trade.periodId !== id)
    })
    void deleteLocalRecord('periods', id)
  }, [])

  const deleteAccount = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((account) => account.id !== id))
    setPeriods((prev) => {
      const removedPeriods = prev.filter((period) => period.accountId === id)
      removedPeriods.forEach((period) => void deleteLocalRecord('periods', period.id))
      setTrades((tp) => {
        const removedTrades = tp.filter((trade) => trade.accountId === id)
        removedTrades.forEach((trade) => void deleteLocalRecord('trades', trade.id))
        return tp.filter((trade) => trade.accountId !== id)
      })
      return prev.filter((period) => period.accountId !== id)
    })
    void deleteLocalRecord('accounts', id)
  }, [])

  const deleteSymbol = useCallback((id: string) => {
    setSymbols((prev) => prev.filter((symbol) => symbol.id !== id))
    setPeriods((prev) => {
      const next = prev.map((period) => ({ ...period, symbolIds: period.symbolIds.filter((symbolId) => symbolId !== id) }))
      next.forEach((period) => void saveLocalRecord('periods', period))
      return next
    })
    void deleteLocalRecord('symbols', id)
  }, [])

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((note) => note.id !== id))
    void deleteLocalRecord('notes', id)
  }, [])

  const applySnapshot = useCallback((snapshot: CairnStateSnapshot) => {
    setAccounts(snapshot.accounts)
    setPeriods(snapshot.periods)
    setTrades(snapshot.trades)
    setSymbols(snapshot.symbols)
    setNotes(snapshot.notes)
    setTagDefs(snapshot.tagDefs)
  }, [])

  const restoreState = useCallback(async (snapshot: CairnStateSnapshot) => {
    const restored = await restoreLocalState(snapshot)
    applySnapshot(restored)
  }, [applySnapshot])

  const exportBackup = useCallback(() => exportLocalBackup(), [])

  useEffect(() => {
    let cancelled = false
    loadLocalState()
      .then((snapshot) => {
        if (cancelled) return
        void logFrontendMessage(`local state loaded: accounts=${snapshot.accounts.length}, periods=${snapshot.periods.length}, trades=${snapshot.trades.length}`)
        applySnapshot(snapshot)
      })
      .catch((err) => {
        console.error('Failed to load local CAIRN state', err)
        void logFrontendError(`local state load failed: ${err instanceof Error ? err.stack : String(err)}`)
      })
    return () => {
      cancelled = true
    }
  }, [applySnapshot])

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

  const updateNote = useCallback((id: string, patch: Partial<(typeof seedState.notes)[number]>) => {
    setNotes((prev) =>
      prev.map((note) => {
        if (note.id !== id) return note
        const next = { ...note, ...patch, updatedAt: Date.now() }
        void saveLocalRecord('notes', next)
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
      updateNote,
      createAccount,
      createPeriod,
      createSymbol,
      createNote,
      createTrades,
      deleteAccount,
      deletePeriod,
      deleteTrade,
      deleteSymbol,
      deleteNote,
      restoreState,
      exportBackup,
      setTradeStatus,
      createTag,
      updateTag,
      deleteTag,
    }),
    [accounts, periods, trades, tagDefs, symbols, notes, updateAccount, updatePeriod, updateTrade, updateNote, createAccount, createPeriod, createSymbol, createNote, createTrades, deleteAccount, deletePeriod, deleteTrade, deleteSymbol, deleteNote, restoreState, exportBackup, setTradeStatus, createTag, updateTag, deleteTag],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useCairn(): CairnStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useCairn 必须在 CairnProvider 内使用')
  return ctx
}
