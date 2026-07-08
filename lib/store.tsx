'use client'

/**
 * Cairn 客户端数据层（会话内可变）。
 * Tauri 运行时通过本地 SQLite 持久化，浏览器开发环境使用空 seed。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadLocalState, saveLocalRecord, saveLocalRecords, deleteLocalRecord, restoreLocalState, exportLocalBackup, saveAttachmentFile } from './local-db'
import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'
import { logFrontendError, logFrontendMessage } from './frontend-log'
import { parseNoteMentions } from './note-mentions'
import { findTagByName, normalizeTagDefs, normalizeTagName, normalizeTradeTagNames, uniqueTagNames, tagNamesEqual } from './tags'
import type { Account, Attachment, ChartCandle, ChartImport, ChartTimeframe, ImportBatch, Period, Trade, TagDef, TagColor } from './types'

/* ---------- Context ---------- */

interface CairnStore {
  accounts: Account[]
  periods: Period[]
  trades: Trade[]
  tagDefs: TagDef[]
  importBatches: ImportBatch[]
  attachments: Attachment[]
  chartImports: ChartImport[]
  chartCandles: ChartCandle[]
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
  createImageAttachment: (input: {
    ownerType: Attachment['ownerType']
    ownerId: string
    kind: Extract<Attachment['kind'], 'reference-image' | 'note-image'>
    fileName: string
    contentDataUrl: string
  }) => Promise<Attachment>
  deleteAttachment: (id: string) => void
  createTrades: (records: Trade[]) => void
  createImportBatch: (batch: ImportBatch) => void
  createChartImport: (record: ChartImport, candles: ChartCandle[]) => void
  deleteChartImport: (id: string) => void
  getChartCandles: (symbolId: string, timeframe: ChartTimeframe, start?: number, end?: number) => ChartCandle[]
  rollbackImportBatch: (batchId: string) => void
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

function migrateTradeChartData(trade: Trade): { trade: Trade; changed: boolean } {
  const legacyBars = trade.chartBars
  const chartData = trade.chartData ?? {}
  if (!legacyBars?.length || chartData['5m']?.length) return { trade, changed: false }
  return { trade: { ...trade, chartData: { ...chartData, '5m': legacyBars } }, changed: true }
}

function normalizeSnapshot(snapshot: CairnStateSnapshot): {
  snapshot: CairnStateSnapshot
  migratedTrades: Trade[]
  migratedNotes: CairnStateSnapshot['notes']
  migratedTagDefs: TagDef[]
  removedTagDefIds: string[]
} {
  const migratedTrades: Trade[] = []
  const migratedNotes: CairnStateSnapshot['notes'] = []
  const normalizedTagDefs = normalizeTagDefs(snapshot.tagDefs)
  const trades = snapshot.trades.map((trade) => {
    const migrated = migrateTradeChartData(trade)
    const normalizedTags = normalizeTradeTagNames(migrated.trade.tags, normalizedTagDefs.tagDefs)
    const tagsChanged = normalizedTags.length !== migrated.trade.tags.length || normalizedTags.some((tag, index) => tag !== migrated.trade.tags[index])
    const next = tagsChanged ? { ...migrated.trade, tags: normalizedTags } : migrated.trade
    if (migrated.changed || tagsChanged) migratedTrades.push(next)
    return next
  })
  const notes = snapshot.notes.map((note) => {
    const normalizedTags = uniqueTagNames(note.tags)
    const tagsChanged = normalizedTags.length !== note.tags.length || normalizedTags.some((tag, index) => tag !== note.tags[index])
    if (!tagsChanged) return note
    const next = { ...note, tags: normalizedTags }
    migratedNotes.push(next)
    return next
  })
  return {
    snapshot: { ...snapshot, trades, notes, tagDefs: normalizedTagDefs.tagDefs },
    migratedTrades,
    migratedNotes,
    migratedTagDefs: normalizedTagDefs.changed,
    removedTagDefIds: normalizedTagDefs.removedIds,
  }
}

export function CairnProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(seedState.accounts)
  const [periods, setPeriods] = useState<Period[]>(seedState.periods)
  const [trades, setTrades] = useState<Trade[]>(seedState.trades)
  const [symbols, setSymbols] = useState(seedState.symbols)
  const [notes, setNotes] = useState(seedState.notes)
  const [tagDefs, setTagDefs] = useState<TagDef[]>(seedState.tagDefs)
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(seedState.importBatches)
  const [attachments, setAttachments] = useState<Attachment[]>(seedState.attachments)
  const [chartImports, setChartImports] = useState<ChartImport[]>(seedState.chartImports)
  const [chartCandles, setChartCandles] = useState<ChartCandle[]>(seedState.chartCandles)

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
    const created = { ...input, tags: uniqueTagNames(input.tags), mentions: parseNoteMentions(input.content), id: makeId('note'), createdAt: now, updatedAt: now }
    setNotes((prev) => [...prev, created])
    void saveLocalRecord('notes', created)
    return created
  }, [makeId])

  const createImageAttachment = useCallback(async (input: {
    ownerType: Attachment['ownerType']
    ownerId: string
    kind: Extract<Attachment['kind'], 'reference-image' | 'note-image'>
    fileName: string
    contentDataUrl: string
  }): Promise<Attachment> => {
    const id = makeId('att')
    const saved = await saveAttachmentFile({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      attachmentId: id,
      fileName: input.fileName,
      contentDataUrl: input.contentDataUrl,
    })
    const created: Attachment = {
      id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      fileName: saved.fileName,
      relativePath: saved.relativePath,
      mimeType: saved.mimeType,
      createdAt: Date.now(),
    }
    setAttachments((prev) => [...prev.filter((item) => item.id !== id), created])
    void saveLocalRecord('attachments', created)
    return created
  }, [makeId])

  const deleteAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
    void deleteLocalRecord('attachments', id)
  }, [])

  const createTrades = useCallback((records: Trade[]) => {
    if (records.length === 0) return
    const normalizedRecords = records.map((record) => ({ ...record, tags: normalizeTradeTagNames(record.tags, tagDefs) }))
    setTrades((prev) => [...prev, ...normalizedRecords])
    normalizedRecords.forEach((record) => {
      void saveLocalRecord('trades', record)
    })
  }, [tagDefs])

  const createImportBatch = useCallback((batch: ImportBatch) => {
    setImportBatches((prev) => [...prev, batch])
    void saveLocalRecord('importBatches', batch)
  }, [])

  const createChartImport = useCallback((record: ChartImport, candles: ChartCandle[]) => {
    setChartImports((prev) => [record, ...prev.filter((item) => item.id !== record.id)])
    void saveLocalRecord('chartImports', record)
    const recordsToSave: ChartCandle[] = []
    const nextById = new Map(chartCandles.map((item) => [item.id, item]))
    for (const candle of candles) {
      const existing = nextById.get(candle.id)
      const next = existing ? { ...existing, importIds: [...new Set([...existing.importIds, ...candle.importIds])] } : candle
      nextById.set(candle.id, next)
      recordsToSave.push(next)
    }
    setChartCandles([...nextById.values()].sort((a, b) => a.time - b.time))
    void saveLocalRecords('chartCandles', recordsToSave)
  }, [chartCandles])

  const deleteChartImport = useCallback((id: string) => {
    setChartImports((prev) => prev.filter((item) => item.id !== id))
    void deleteLocalRecord('chartImports', id)
    setChartCandles((prev) => {
      const next: ChartCandle[] = []
      for (const candle of prev) {
        if (!candle.importIds.includes(id)) {
          next.push(candle)
          continue
        }
        const importIds = candle.importIds.filter((importId) => importId !== id)
        if (importIds.length === 0) {
          void deleteLocalRecord('chartCandles', candle.id)
        } else {
          const updated = { ...candle, importIds }
          next.push(updated)
          void saveLocalRecord('chartCandles', updated)
        }
      }
      return next
    })
  }, [])

  const rollbackImportBatch = useCallback((batchId: string) => {
    setTrades((prev) => {
      const removed = prev.filter((trade) => trade.importBatchId === batchId)
      removed.forEach((trade) => void deleteLocalRecord('trades', trade.id))
      return prev.filter((trade) => trade.importBatchId !== batchId)
    })
    setImportBatches((prev) =>
      prev.map((batch) => {
        if (batch.id !== batchId) return batch
        const next = { ...batch, status: 'rolled-back' as const, rolledBackAt: Date.now() }
        void saveLocalRecord('importBatches', next)
        return next
      }),
    )
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
    const normalized = normalizeSnapshot(snapshot).snapshot
    setAccounts(normalized.accounts)
    setPeriods(normalized.periods)
    setTrades(normalized.trades)
    setSymbols(normalized.symbols)
    setNotes(normalized.notes)
    setTagDefs(normalized.tagDefs)
    setImportBatches(normalized.importBatches)
    setAttachments(normalized.attachments)
    setChartImports(normalized.chartImports)
    setChartCandles(normalized.chartCandles)
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
        const normalized = normalizeSnapshot(snapshot)
        void logFrontendMessage(`local state loaded: accounts=${normalized.snapshot.accounts.length}, periods=${normalized.snapshot.periods.length}, trades=${normalized.snapshot.trades.length}`)
        applySnapshot(normalized.snapshot)
        normalized.migratedTrades.forEach((trade) => void saveLocalRecord('trades', trade))
        normalized.migratedNotes.forEach((note) => void saveLocalRecord('notes', note))
        normalized.migratedTagDefs.forEach((tag) => void saveLocalRecord('tagDefs', tag))
        normalized.removedTagDefIds.forEach((id) => void deleteLocalRecord('tagDefs', id))
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
        const next = { ...t, ...patch, tags: patch.tags ? normalizeTradeTagNames(patch.tags, tagDefs) : t.tags }
        void saveLocalRecord('trades', next)
        return next
      }),
    )
  }, [tagDefs])

  const updateNote = useCallback((id: string, patch: Partial<(typeof seedState.notes)[number]>) => {
    setNotes((prev) =>
      prev.map((note) => {
        if (note.id !== id) return note
        const next = { ...note, ...patch, tags: patch.tags ? uniqueTagNames(patch.tags) : note.tags, mentions: parseNoteMentions(patch.content ?? note.content), updatedAt: Date.now() }
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
      const normalized = normalizeTagName(name)
      if (!normalized || findTagByName(tagDefs, normalized)) return null
      const created: TagDef = { id: makeId('tag'), name: normalized, color, createdAt: Date.now() }
      setTagDefs((prev) => (findTagByName(prev, normalized) ? prev : [...prev, created]))
      void saveLocalRecord('tagDefs', created)
      return created
    },
    [makeId, tagDefs],
  )

  const updateTag = useCallback((id: string, patch: Partial<Pick<TagDef, 'name' | 'color'>>) => {
    setTagDefs((prev) => {
      const target = prev.find((t) => t.id === id)
      if (!target) return prev
      const normalizedName = patch.name == null ? undefined : normalizeTagName(patch.name)
      if (patch.name != null && !normalizedName) return prev
      if (normalizedName && !tagNamesEqual(normalizedName, target.name) && findTagByName(prev, normalizedName, id)) return prev
      /* 重命名时同步更新所有 trade.tags 引用 */
      if (normalizedName && !tagNamesEqual(normalizedName, target.name)) {
        const newName = normalizedName
        setTrades((tp) =>
          tp.map((t) => {
            if (!t.tags.some((name) => tagNamesEqual(name, target.name))) return t
            const next = { ...t, tags: normalizeTradeTagNames(t.tags.map((name) => (tagNamesEqual(name, target.name) ? newName : name)), prev) }
            void saveLocalRecord('trades', next)
            return next
          }),
        )
      }
      return prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, ...patch, name: normalizedName ?? t.name }
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
          if (!t.tags.some((name) => tagNamesEqual(name, target.name))) return t
          const next = { ...t, tags: t.tags.filter((name) => !tagNamesEqual(name, target.name)) }
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
      importBatches,
      attachments,
      chartImports,
      chartCandles,
      symbols,
      notes,
      getAccount: (id) => accounts.find((a) => a.id === id),
      getPeriod: (id) => periods.find((p) => p.id === id),
      getTrade: (id) => trades.find((t) => t.id === id),
      getSymbol: (id) => symbols.find((s) => s.id === id),
      getTagDef: (name) => findTagByName(tagDefs, name),
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
      createImageAttachment,
      deleteAttachment,
      createTrades,
      createImportBatch,
      createChartImport,
      deleteChartImport,
      getChartCandles: (symbolId, timeframe, start, end) =>
        chartCandles.filter((item) =>
          item.symbolId === symbolId &&
          item.timeframe === timeframe &&
          (start == null || item.time >= start) &&
          (end == null || item.time <= end)
        ),
      rollbackImportBatch,
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
    [accounts, periods, trades, tagDefs, importBatches, attachments, chartImports, chartCandles, symbols, notes, updateAccount, updatePeriod, updateTrade, updateNote, createAccount, createPeriod, createSymbol, createNote, createImageAttachment, deleteAttachment, createTrades, createImportBatch, createChartImport, deleteChartImport, rollbackImportBatch, deleteAccount, deletePeriod, deleteTrade, deleteSymbol, deleteNote, restoreState, exportBackup, setTradeStatus, createTag, updateTag, deleteTag],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useCairn(): CairnStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useCairn 必须在 CairnProvider 内使用')
  return ctx
}
