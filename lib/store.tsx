'use client'

/**
 * Cairn 客户端数据层（会话内可变）。
 * Tauri 运行时通过本地 SQLite 持久化，浏览器开发环境使用空 seed。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { loadLocalState, saveLocalRecord, saveLocalRecords, deleteLocalRecord, restoreLocalState, exportLocalBackup, saveAttachmentFile, isTauriRuntime, analyzeCaseCard as analyzeCaseCardRemote, draftCaseTitle as draftCaseTitleRemote, suggestCaseExecutions as suggestCaseExecutionsRemote, summarizeCase as summarizeCaseRemote, getAiSettings } from './local-db'
import { buildCaseSummaryContext } from './case-summary'
import { deriveAutoCloseCases } from './case-auto-close'
import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'
import { logFrontendError, logFrontendMessage } from './frontend-log'
import { parseNoteMentions } from './note-mentions'
import { extractExplicitBarRef, isDefaultCaseTitle } from './cases'
import { findTagByName, normalizeTagDefs, normalizeTagName, normalizeTradeTagNames, uniqueTagNames, tagNamesEqual } from './tags'
import { firstPlausibleNumberIn } from './process-score'
import { computeTradeMetrics } from './metrics'
import type { Account, Attachment, CaseCard, CaseCardAnalysis, CaseExecutionSuggestion, CaseSummary, CaseTagDef, CaseTradeBinding, ChartCandle, ChartImport, ChartTimeframe, ImportBatch, Period, Trade, TradeCase, TagDef, TagColor } from './types'

/* ---------- Context ---------- */

interface CairnStore {
  accounts: Account[]
  periods: Period[]
  trades: Trade[]
  tagDefs: TagDef[]
  cases: TradeCase[]
  caseCards: CaseCard[]
  caseBindings: CaseTradeBinding[]
  caseTagDefs: CaseTagDef[]
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
  getCase: (id: string) => TradeCase | undefined
  getCaseCards: (caseId: string) => CaseCard[]
  getCaseBinding: (caseId: string) => CaseTradeBinding | undefined
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
  createCase: (input: Omit<TradeCase, 'id' | 'createdAt' | 'updatedAt'>) => TradeCase
  updateCase: (id: string, patch: Partial<Omit<TradeCase, 'id' | 'createdAt'>>) => void
  deleteCase: (id: string) => void
  createCaseCard: (input: Omit<CaseCard, 'id' | 'createdAt' | 'barRef' | 'barRefs'> & { barRef?: number | null }) => CaseCard
  moveCaseCard: (cardId: string, targetCaseId: string) => CaseCard | undefined
  updateCaseCardText: (cardId: string, rawText: string) => CaseCard | undefined
  updateCaseCardBarRef: (cardId: string, barRef: number | null) => CaseCard | undefined
  deleteCaseCard: (cardId: string) => void
  updateCaseCardAnalysis: (cardId: string, updater: (prev: CaseCardAnalysis) => CaseCardAnalysis) => CaseCard | undefined
  analyzeCaseCard: (cardId: string, instruction?: string) => Promise<CaseCard | undefined>
  /** 重跑 AI 持仓管理补录建议（绑定 Trade 后自动触发，也可手动）。只吸收建议字段。 */
  refreshCaseExecutionSuggestions: (caseId: string) => Promise<void>
  /** 更新单条建议状态（accepted 带生成的 executionId / dismissed 带时间）。 */
  setCaseExecutionSuggestionStatus: (
    caseId: string,
    suggestionId: string,
    patch: { status: CaseExecutionSuggestion['status']; acceptedExecutionId?: string },
  ) => void
  /** 生成/重跑整单 AI 总结（上下文前端组装；只吸收 aiSummary 字段）。失败不 reject，写入 aiTasks。 */
  summarizeCase: (caseId: string, instruction?: string) => Promise<void>
  /** 手动 AI 长任务（整单总结 / 补录建议检查）的运行与失败状态：store 级，切页回来仍可见。 */
  aiTasks: {
    summarizingCaseIds: string[]
    checkingCaseIds: string[]
    summaryErrorByCase: Record<string, string>
    checkErrorByCase: Record<string, string>
  }
  prefillTradePlanFromBoundCase: (tradeId: string) => boolean
  createCaseBinding: (caseId: string, tradeId: string, source?: CaseTradeBinding['source']) => Promise<CaseTradeBinding>
  deleteCaseBinding: (id: string) => Promise<void>
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
  createCaseTag: (name: string, color: TagColor) => CaseTagDef | null
  updateCaseTag: (id: string, patch: Partial<Pick<CaseTagDef, 'name' | 'color'>>) => void
  deleteCaseTag: (id: string) => void
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
  const normalizedTagDefs = normalizeTagDefs(snapshot.tagDefs ?? [])
  const caseTagDefs = snapshot.caseTagDefs ?? []
  const caseTagIds = new Set(caseTagDefs.map((tag) => tag.id))
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
  const cases = (snapshot.cases ?? []).map((caseRecord) => ({
    ...caseRecord,
    tagIds: [...new Set((caseRecord.tagIds ?? []).filter((id) => caseTagIds.has(id)))],
  }))
  const caseCards = (snapshot.caseCards ?? [])
    .map((card) => ({ ...card, barRef: card.barRef ?? card.barRefs?.[0] ?? extractExplicitBarRef(card.rawText) }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return {
    snapshot: {
      ...snapshot,
      trades,
      notes,
      tagDefs: normalizedTagDefs.tagDefs,
      cases,
      caseCards,
      caseBindings: snapshot.caseBindings ?? [],
      caseTagDefs,
    },
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
  const [cases, setCases] = useState<TradeCase[]>(seedState.cases)
  const [caseCards, setCaseCards] = useState<CaseCard[]>(seedState.caseCards)
  const [caseBindings, setCaseBindings] = useState<CaseTradeBinding[]>(seedState.caseBindings)
  const [caseTagDefs, setCaseTagDefs] = useState<CaseTagDef[]>(seedState.caseTagDefs)
  const [importBatches, setImportBatches] = useState<ImportBatch[]>(seedState.importBatches)
  const [attachments, setAttachments] = useState<Attachment[]>(seedState.attachments)
  const [chartImports, setChartImports] = useState<ChartImport[]>(seedState.chartImports)
  const [chartCandles, setChartCandles] = useState<ChartCandle[]>(seedState.chartCandles)
  /** 数据变更事件计数：触发一次自动收尾推导（手动改状态不触发，避免和用户抢状态） */
  const [autoCloseTick, setAutoCloseTick] = useState(0)
  const handledAutoCloseTickRef = useRef(0)
  const requestAutoCloseCheck = useCallback(() => setAutoCloseTick((tick) => tick + 1), [])

  /** 手动 AI 长任务的运行/失败状态（store 级：组件卸载后切页回来仍显示「生成中」或失败原因） */
  const [aiTasks, setAiTasks] = useState<{
    summarizingCaseIds: string[]
    checkingCaseIds: string[]
    summaryErrorByCase: Record<string, string>
    checkErrorByCase: Record<string, string>
  }>({ summarizingCaseIds: [], checkingCaseIds: [], summaryErrorByCase: {}, checkErrorByCase: {} })

  /* AI 总结用状态镜像：关单自动总结在 setState 同一刻触发，闭包里的 state 还是旧值，
     用 ref 保证组装上下文时读到最新数据。 */
  const stateRef = useRef({ accounts, periods, trades, symbols, cases, caseCards, caseBindings })
  useEffect(() => {
    stateRef.current = { accounts, periods, trades, symbols, cases, caseCards, caseBindings }
  }, [accounts, periods, trades, symbols, cases, caseCards, caseBindings])

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
    await saveLocalRecord('attachments', created)
    setAttachments((prev) => [...prev.filter((item) => item.id !== id), created])
    return created
  }, [makeId])

  const deleteAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
    void deleteLocalRecord('attachments', id)
  }, [])

  const createCase = useCallback((input: Omit<TradeCase, 'id' | 'createdAt' | 'updatedAt'>): TradeCase => {
    const now = Date.now()
    const availableTagIds = new Set(caseTagDefs.map((tag) => tag.id))
    const created: TradeCase = {
      ...input,
      id: makeId('case'),
      title: input.title.trim() || '未命名 Case',
      tagIds: [...new Set(input.tagIds.filter((id) => availableTagIds.has(id)))],
      createdAt: now,
      updatedAt: now,
    }
    setCases((prev) => [...prev, created])
    void saveLocalRecord('cases', created)
    return created
  }, [caseTagDefs, makeId])

  const updateCase = useCallback((id: string, patch: Partial<Omit<TradeCase, 'id' | 'createdAt'>>) => {
    setCases((prev) =>
      prev.map((caseRecord) => {
        if (caseRecord.id !== id) return caseRecord
        const availableTagIds = new Set(caseTagDefs.map((tag) => tag.id))
        const next: TradeCase = {
          ...caseRecord,
          ...patch,
          title: patch.title == null ? caseRecord.title : patch.title.trim() || caseRecord.title,
          tagIds: patch.tagIds == null
            ? caseRecord.tagIds
            : [...new Set(patch.tagIds.filter((tagId) => availableTagIds.has(tagId)))],
          updatedAt: Date.now(),
        }
        void saveLocalRecord('cases', next)
        return next
      }),
    )
  }, [caseTagDefs])

  // 自动收尾：只在数据变更事件（requestAutoCloseCheck）后判断一次；
  // 用户手动把已满足条件的 Case 改回「记录中」不会被立即再次收尾。
  useEffect(() => {
    if (autoCloseTick === handledAutoCloseTickRef.current) return
    handledAutoCloseTickRef.current = autoCloseTick
    const candidates = deriveAutoCloseCases(cases, caseCards, caseBindings, trades)
    for (const candidate of candidates) {
      updateCase(candidate.caseId, { status: 'closed' })
    }
  }, [autoCloseTick, cases, caseCards, caseBindings, trades, updateCase])

  const createCaseCard = useCallback((input: Omit<CaseCard, 'id' | 'createdAt' | 'barRef' | 'barRefs'> & { barRef?: number | null }): CaseCard => {
    const { barRef, ...rest } = input
    const created: CaseCard = {
      ...rest,
      ...(barRef != null ? { barRef } : {}),
      id: makeId('card'),
      rawText: input.rawText.trim(),
      createdAt: Date.now(),
    }
    setCaseCards((prev) => [...prev, created].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    void saveLocalRecord('caseCards', created)
    setCases((prev) =>
      prev.map((caseRecord) => {
        if (caseRecord.id !== created.caseId) return caseRecord
        const next = { ...caseRecord, updatedAt: created.createdAt }
        void saveLocalRecord('cases', next)
        return next
      }),
    )
    requestAutoCloseCheck()
    return created
  }, [makeId, requestAutoCloseCheck])

  /** 修复通道：Card 归属错了可移动到其他 Case，rawText 保持不变。 */
  const moveCaseCard = useCallback((cardId: string, targetCaseId: string): CaseCard | undefined => {
    const card = caseCards.find((item) => item.id === cardId)
    if (!card || card.caseId === targetCaseId) return card
    const next: CaseCard = { ...card, caseId: targetCaseId }
    setCaseCards((prev) => prev
      .map((item) => (item.id === cardId ? next : item))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    void saveLocalRecord('caseCards', next)
    const now = Date.now()
    setCases((prev) =>
      prev.map((caseRecord) => {
        if (caseRecord.id !== targetCaseId && caseRecord.id !== card.caseId) return caseRecord
        const nextCase = { ...caseRecord, updatedAt: now }
        void saveLocalRecord('cases', nextCase)
        return nextCase
      }),
    )
    requestAutoCloseCheck()
    return next
  }, [caseCards, requestAutoCloseCheck])

  /** 错字修正：rawText 可改，旧值进 rawTextHistory（Rust 落库时同样自动追加）。 */
  const updateCaseCardText = useCallback((cardId: string, rawText: string): CaseCard | undefined => {
    const trimmed = rawText.trim()
    const card = caseCards.find((item) => item.id === cardId)
    if (!card || !trimmed || trimmed === card.rawText) return card
    const next: CaseCard = {
      ...card,
      rawText: trimmed,
      rawTextHistory: [...(card.rawTextHistory ?? []), card.rawText],
      rawTextEditedAt: Date.now(),
    }
    setCaseCards((prev) => prev
      .map((item) => (item.id === cardId ? next : item))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    void saveLocalRecord('caseCards', next)
    return next
  }, [caseCards])

  /** BAR 修正：语音误识别（如 2265→265）或漏填时直接改 barRef；rawText 不动。 */
  const updateCaseCardBarRef = useCallback((cardId: string, barRef: number | null): CaseCard | undefined => {
    const card = caseCards.find((item) => item.id === cardId)
    if (!card) return undefined
    const same = barRef == null
      ? card.barRef == null
      : card.barRef === barRef
    if (same) return card
    const next: CaseCard = barRef == null
      ? { ...card, barRef: undefined, barRefs: undefined }
      : { ...card, barRef, barRefs: undefined }
    setCaseCards((prev) => prev
      .map((item) => (item.id === cardId ? next : item))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    void saveLocalRecord('caseCards', next)
    return next
  }, [caseCards])

  /** 删除卡片（软删，备份可恢复）：用户调整权的一部分，用于清理误录/拆错的卡。
   *  「原文不可改写」约束的是 AI，不是用户。同时清掉指向该卡的 pending 建议（证据悬空）。 */
  const deleteCaseCard = useCallback((cardId: string): void => {
    const card = caseCards.find((item) => item.id === cardId)
    if (!card) return
    setCaseCards((prev) => prev.filter((item) => item.id !== cardId))
    void deleteLocalRecord('caseCards', cardId)
    const now = Date.now()
    setCases((prev) =>
      prev.map((caseRecord) => {
        if (caseRecord.id !== card.caseId) return caseRecord
        let next = { ...caseRecord, updatedAt: now }
        if (caseRecord.aiExecutionSuggestions) {
          const suggestions = caseRecord.aiExecutionSuggestions.suggestions.filter((suggestion) => suggestion.cardId !== cardId)
          next = { ...next, aiExecutionSuggestions: { ...caseRecord.aiExecutionSuggestions, suggestions } }
        }
        void saveLocalRecord('cases', next)
        return next
      }),
    )
  }, [caseCards])

  /** AI 派生数据人工修正（标签/memo/过期忽略）：标记 userAdjusted，重新识别前会提示覆盖。 */
  const updateCaseCardAnalysis = useCallback((cardId: string, updater: (prev: CaseCardAnalysis) => CaseCardAnalysis): CaseCard | undefined => {
    const card = caseCards.find((item) => item.id === cardId)
    if (!card?.aiAnalysis) return undefined
    const next: CaseCard = {
      ...card,
      aiAnalysis: { ...updater(card.aiAnalysis), userAdjusted: true },
    }
    setCaseCards((prev) => prev
      .map((item) => (item.id === cardId ? next : item))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    void saveLocalRecord('caseCards', next)
    return next
  }, [caseCards])

  /** AI 秘书整理：结果写入 card.aiAnalysis，原文不动。instruction 为重试补充要求。
   *  只吸收 aiAnalysis 与缺失的 barRef——请求期间本地的 rawText/barRef 修正不被回滚。 */
  const analyzeCaseCard = useCallback(async (cardId: string, instruction?: string): Promise<CaseCard | undefined> => {
    const updated = await analyzeCaseCardRemote(cardId, instruction)
    setCaseCards((prev) => prev
      .map((item) => {
        if (item.id !== updated.id) return item
        return { ...item, aiAnalysis: updated.aiAnalysis, barRef: item.barRef ?? updated.barRef }
      })
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    return updated
  }, [])

  /** 重跑持仓管理补录建议：只吸收 aiExecutionSuggestions 字段——请求期间
   *  本地的标题/状态/标签修改不被回滚（与 analyzeCaseCard 同一吸收模式）。
   *  失败不 reject，写入 aiTasks.checkErrorByCase，由面板就地显示。 */
  const refreshCaseExecutionSuggestions = useCallback(async (caseId: string): Promise<void> => {
    setAiTasks((prev) => {
      const checkErrorByCase = { ...prev.checkErrorByCase }
      delete checkErrorByCase[caseId]
      return {
        ...prev,
        checkingCaseIds: prev.checkingCaseIds.includes(caseId) ? prev.checkingCaseIds : [...prev.checkingCaseIds, caseId],
        checkErrorByCase,
      }
    })
    try {
      const updated = await suggestCaseExecutionsRemote(caseId)
      setCases((prev) => prev.map((item) => {
        if (item.id !== updated.id) return item
        return { ...item, aiExecutionSuggestions: updated.aiExecutionSuggestions }
      }))
    } catch (cause) {
      setAiTasks((prev) => ({
        ...prev,
        checkErrorByCase: { ...prev.checkErrorByCase, [caseId]: cause instanceof Error ? cause.message : String(cause) },
      }))
    } finally {
      setAiTasks((prev) => ({ ...prev, checkingCaseIds: prev.checkingCaseIds.filter((id) => id !== caseId) }))
    }
  }, [])

  /** 更新单条建议状态：accepted 需带生成的 executionId，dismissed 记时间。 */
  const setCaseExecutionSuggestionStatus = useCallback((
    caseId: string,
    suggestionId: string,
    patch: { status: CaseExecutionSuggestion['status']; acceptedExecutionId?: string },
  ): void => {
    setCases((prev) => prev.map((item) => {
      if (item.id !== caseId || !item.aiExecutionSuggestions) return item
      const suggestions = item.aiExecutionSuggestions.suggestions.map((suggestion) => {
        if (suggestion.id !== suggestionId) return suggestion
        return {
          ...suggestion,
          status: patch.status,
          acceptedExecutionId: patch.acceptedExecutionId,
          dismissedAt: patch.status === 'dismissed' ? Date.now() : undefined,
        }
      })
      const next = { ...item, aiExecutionSuggestions: { ...item.aiExecutionSuggestions, suggestions } }
      void saveLocalRecord('cases', next)
      return next
    }))
  }, [])

  /** 绑定建立后自动检查补录建议（autoSuggest 开关控制；此刻 Case 才拿得到 Trade 上下文）。失败静默。 */
  const maybeAutoSuggestExecutions = useCallback(async (caseId: string) => {
    try {
      const settings = await getAiSettings()
      if (settings.autoSuggest === false) return
      await refreshCaseExecutionSuggestions(caseId)
    } catch {
      // 自动建议失败静默：Trade 页的「重新检查」按钮仍在
    }
  }, [refreshCaseExecutionSuggestions])

  /** 生成/重跑整单总结：上下文在此组装（metrics 在 TS），结果只吸收 aiSummary 字段。
   *  经 stateRef 读最新数据——关单自动总结在 setState 同一刻触发，闭包 state 是旧的。
   *  失败不 reject，写入 aiTasks.summaryErrorByCase，由总结卡就地显示。 */
  const summarizeCase = useCallback(async (caseId: string, instruction?: string): Promise<void> => {
    const current = stateRef.current
    const caseRecord = current.cases.find((item) => item.id === caseId)
    if (!caseRecord) throw new Error('Case 不存在')
    const cards = current.caseCards.filter((card) => card.caseId === caseId)
    const binding = current.caseBindings.find((item) => item.caseId === caseId)
    const trade = binding ? current.trades.find((item) => item.id === binding.tradeId) : undefined
    const account = trade ? current.accounts.find((item) => item.id === trade.accountId) : undefined
    const period = trade ? current.periods.find((item) => item.id === trade.periodId) : undefined
    const symbol = trade ? current.symbols.find((item) => item.id === trade.symbolId) : undefined
    const context = buildCaseSummaryContext({ caseRecord, cards, trade, account, period, symbol })
    setAiTasks((prev) => {
      const summaryErrorByCase = { ...prev.summaryErrorByCase }
      delete summaryErrorByCase[caseId]
      return {
        ...prev,
        summarizingCaseIds: prev.summarizingCaseIds.includes(caseId) ? prev.summarizingCaseIds : [...prev.summarizingCaseIds, caseId],
        summaryErrorByCase,
      }
    })
    // analyzedAt 取发起时刻：AI 期间（几十秒）新建/编辑的卡片才会正确标「总结过期」
    const startedAt = Date.now()
    try {
      const summary = await summarizeCaseRemote(context, instruction)
      const withMeta: CaseSummary = { ...summary, analyzedAt: startedAt }
      setCases((prev) => prev.map((item) => {
        if (item.id !== caseId) return item
        const next = { ...item, aiSummary: withMeta }
        void saveLocalRecord('cases', next)
        return next
      }))
    } catch (cause) {
      setAiTasks((prev) => ({
        ...prev,
        summaryErrorByCase: { ...prev.summaryErrorByCase, [caseId]: cause instanceof Error ? cause.message : String(cause) },
      }))
    } finally {
      setAiTasks((prev) => ({ ...prev, summarizingCaseIds: prev.summarizingCaseIds.filter((id) => id !== caseId) }))
    }
  }, [])

  /** Trade 关闭时自动总结（autoSummary 开关控制）。失败静默，手动按钮仍在。 */
  const maybeAutoSummarizeForTrade = useCallback(async (tradeId: string) => {
    try {
      const binding = stateRef.current.caseBindings.find((item) => item.tradeId === tradeId)
      if (!binding) return
      const settings = await getAiSettings()
      if (settings.autoSummary === false) return
      await summarizeCase(binding.caseId)
    } catch {
      // 自动总结失败静默
    }
  }, [summarizeCase])

  /** 绑定 Trade 后自动拟题：只替换默认占位标题，用户起过的名字永不覆盖；失败静默。 */
  const maybeAutoTitleCase = useCallback(async (caseId: string) => {
    const caseRecord = cases.find((item) => item.id === caseId)
    if (!caseRecord || !isDefaultCaseTitle(caseRecord.title)) return
    try {
      const title = (await draftCaseTitleRemote(caseId)).trim()
      if (title) updateCase(caseId, { title })
    } catch {
      // 自动拟题失败静默：Case 页的「AI 拟题」按钮仍在
    }
  }, [cases, updateCase])

  const deleteCase = useCallback((id: string) => {
    const removedCardIds = new Set(caseCards.filter((card) => card.caseId === id).map((card) => card.id))
    setCases((prev) => prev.filter((caseRecord) => caseRecord.id !== id))
    setCaseCards((prev) => prev.filter((card) => card.caseId !== id))
    setCaseBindings((prev) => prev.filter((binding) => binding.caseId !== id))
    setAttachments((prev) => prev.filter((attachment) =>
      !(attachment.ownerType === 'case' && attachment.ownerId === id) &&
      !(attachment.ownerType === 'case-card' && removedCardIds.has(attachment.ownerId)),
    ))
    void deleteLocalRecord('cases', id)
  }, [caseCards])

  const createCaseBinding = useCallback(async (
    caseId: string,
    tradeId: string,
    source: CaseTradeBinding['source'] = 'manual',
  ): Promise<CaseTradeBinding> => {
    if (caseBindings.some((binding) => binding.caseId === caseId)) throw new Error('这个 Case 已关联 Trade')
    if (caseBindings.some((binding) => binding.tradeId === tradeId)) throw new Error('这个 Trade 已关联 Case')
    const created: CaseTradeBinding = {
      id: makeId('case-binding'),
      caseId,
      tradeId,
      source,
      boundAt: Date.now(),
    }
    await saveLocalRecord('caseBindings', created)
    setCaseBindings((prev) => [...prev, created])
    requestAutoCloseCheck()
    void maybeAutoTitleCase(caseId)
    // 绑定建立 = 卡片首次拿得到 Trade 上下文，自动跑一次补录建议
    void maybeAutoSuggestExecutions(caseId)
    return created
  }, [caseBindings, makeId, requestAutoCloseCheck, maybeAutoTitleCase, maybeAutoSuggestExecutions])

  const deleteCaseBinding = useCallback(async (id: string) => {
    await deleteLocalRecord('caseBindings', id)
    setCaseBindings((prev) => prev.filter((binding) => binding.id !== id))
  }, [])

  const createTrades = useCallback((records: Trade[]) => {
    if (records.length === 0) return
    const normalizedRecords = records.map((record) => ({ ...record, tags: normalizeTradeTagNames(record.tags, tagDefs) }))
    setTrades((prev) => [...prev, ...normalizedRecords])
    normalizedRecords.forEach((record) => {
      void saveLocalRecord('trades', record)
    })
    requestAutoCloseCheck()
  }, [tagDefs, requestAutoCloseCheck])

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
    setCaseBindings((prev) => prev.filter((binding) => binding.tradeId !== id))
    void deleteLocalRecord('trades', id)
  }, [])

  const deletePeriod = useCallback((id: string) => {
    setPeriods((prev) => prev.filter((period) => period.id !== id))
    setTrades((prev) => {
      const removed = prev.filter((trade) => trade.periodId === id)
      removed.forEach((trade) => void deleteLocalRecord('trades', trade.id))
      return prev.filter((trade) => trade.periodId !== id)
    })
    setCases((prev) => {
      const removed = prev.filter((caseRecord) => caseRecord.periodId === id)
      removed.forEach((caseRecord) => void deleteLocalRecord('cases', caseRecord.id))
      const removedIds = new Set(removed.map((caseRecord) => caseRecord.id))
      setCaseCards((cards) => cards.filter((card) => !removedIds.has(card.caseId)))
      setCaseBindings((bindings) => bindings.filter((binding) => !removedIds.has(binding.caseId)))
      return prev.filter((caseRecord) => caseRecord.periodId !== id)
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
      setCases((cp) => {
        const removedCases = cp.filter((caseRecord) => caseRecord.accountId === id)
        removedCases.forEach((caseRecord) => void deleteLocalRecord('cases', caseRecord.id))
        const removedCaseIds = new Set(removedCases.map((caseRecord) => caseRecord.id))
        setCaseCards((cards) => cards.filter((card) => !removedCaseIds.has(card.caseId)))
        setCaseBindings((bindings) => bindings.filter((binding) => !removedCaseIds.has(binding.caseId)))
        return cp.filter((caseRecord) => caseRecord.accountId !== id)
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
    setCases(normalized.cases)
    setCaseCards(normalized.caseCards)
    setCaseBindings(normalized.caseBindings)
    setCaseTagDefs(normalized.caseTagDefs)
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
    let refreshTimer: number | undefined
    let disposeListener: (() => void) | undefined

    const hydrate = () => {
      loadLocalState()
        .then((snapshot) => {
          if (cancelled) return
          const normalized = normalizeSnapshot(snapshot)
          void logFrontendMessage(`local state loaded: accounts=${normalized.snapshot.accounts.length}, periods=${normalized.snapshot.periods.length}, trades=${normalized.snapshot.trades.length}, cases=${normalized.snapshot.cases.length}`)
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
    }

    hydrate()

    // 本地 REST API 写入 SQLite 后由 Rust 侧广播；防抖合并短时间内的多次刷新。
    if (isTauriRuntime()) {
      void listen('cairn://data-changed', () => {
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => hydrate(), 500)
      })
        .then((unlisten) => {
          if (cancelled) unlisten()
          else disposeListener = unlisten
        })
        .catch((err) => console.error('Failed to listen for local api data changes', err))
    }

    return () => {
      cancelled = true
      disposeListener?.()
      window.clearTimeout(refreshTimer)
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
    const previous = trades.find((t) => t.id === id)
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, ...patch, tags: patch.tags ? normalizeTradeTagNames(patch.tags, tagDefs) : t.tags }
        void saveLocalRecord('trades', next)
        return next
      }),
    )
    if (patch.status != null || patch.executions != null) requestAutoCloseCheck()
    // 关单瞬间自动总结（开关在 maybeAutoSummarizeForTrade 内检查）
    if (previous && previous.status === 'open' && patch.status === 'closed') {
      void maybeAutoSummarizeForTrade(id)
    }
  }, [tagDefs, requestAutoCloseCheck, trades, maybeAutoSummarizeForTrade])

  /** 从绑定 Case 的 Entry memo 机械回填 Trade 计划价（入场价/止损/止盈）；只填空字段，绝不覆盖已填值。
   * 提取时以实际成交均价为数量级参照，过滤 K 线号/倍数被误读成价格的情况。 */
  const prefillTradePlanFromBoundCase = useCallback((tradeId: string): boolean => {
    const binding = caseBindings.find((item) => item.tradeId === tradeId)
    const trade = trades.find((item) => item.id === tradeId)
    if (!binding || !trade) return false
    const memo = caseCards.find((card) => card.caseId === binding.caseId && card.phase === 'entry')?.aiAnalysis?.memo
    if (!memo) return false
    const avgEntry = computeTradeMetrics(trade).avgEntry
    const reference = avgEntry > 0 ? avgEntry : null
    const patch: Partial<Trade> = {}
    if (trade.initialEntryPrice == null) {
      const value = memo.entryPrice ? firstPlausibleNumberIn(memo.entryPrice.value, reference) : null
      if (value != null) patch.initialEntryPrice = value
    }
    if (trade.initialStopLoss == null) {
      const value = memo.stopLoss ? firstPlausibleNumberIn(memo.stopLoss.value, reference) : null
      if (value != null) patch.initialStopLoss = value
    }
    if (trade.initialTakeProfit == null) {
      const value = memo.target ? firstPlausibleNumberIn(memo.target.value, reference) : null
      if (value != null) patch.initialTakeProfit = value
    }
    if (Object.keys(patch).length === 0) return false
    updateTrade(tradeId, patch)
    return true
  }, [caseBindings, trades, caseCards, updateTrade])

  /**
   * 权益快照：交易变化后按 initialBalance + 已平仓 PnL 重算各账户当前权益，
   * 写回 Account 记录（派生数据）。REST list_accounts 原样带出，供浮窗显示
   * 余额与 1%/2% 风险额。值未变化时不写，避免加载即落盘。
   */
  useEffect(() => {
    for (const account of accounts) {
      const pnlSum = trades
        .filter((item) => item.accountId === account.id && item.status === 'closed')
        .reduce((sum, item) => sum + computeTradeMetrics(item).pnl, 0)
      const equity = account.initialBalance + pnlSum
      if (account.equity === equity) continue
      const next = { ...account, equity, equityUpdatedAt: Date.now() }
      setAccounts((prev) => prev.map((item) => (item.id === account.id ? next : item)))
      void saveLocalRecord('accounts', next)
    }
  }, [trades, accounts])

  /**
   * 绑定后自动预填：Entry memo 可能晚于绑定到达（逐卡自动识别仍在进行），
   * 用 effect 等它到位；每笔 Trade 只自动尝试一次且持久化（用户手动清空
   * 后重启不被填回），与缺失提醒弹窗的 localStorage 口径一致。
   */
  useEffect(() => {
    for (const binding of caseBindings) {
      const prefillKey = `cairn.trade-plan-prefill.${binding.tradeId}`
      if (window.localStorage.getItem(prefillKey) === 'done') continue
      const trade = trades.find((item) => item.id === binding.tradeId)
      if (!trade) continue
      const hasGap = trade.initialEntryPrice == null || trade.initialStopLoss == null || trade.initialTakeProfit == null
      if (!hasGap) {
        window.localStorage.setItem(prefillKey, 'done')
        continue
      }
      const memo = caseCards.find((card) => card.caseId === binding.caseId && card.phase === 'entry')?.aiAnalysis?.memo
      if (memo == null) continue
      prefillTradePlanFromBoundCase(binding.tradeId)
      window.localStorage.setItem(prefillKey, 'done')
    }
  }, [caseBindings, trades, caseCards, prefillTradePlanFromBoundCase])

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
    const previous = trades.find((t) => t.id === id)
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = { ...t, status }
        void saveLocalRecord('trades', next)
        return next
      }),
    )
    requestAutoCloseCheck()
    if (previous && previous.status === 'open' && status === 'closed') {
      void maybeAutoSummarizeForTrade(id)
    }
  }, [requestAutoCloseCheck, trades, maybeAutoSummarizeForTrade])

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

  const createCaseTag = useCallback((name: string, color: TagColor): CaseTagDef | null => {
    const normalized = normalizeTagName(name)
    if (!normalized || findTagByName(caseTagDefs, normalized)) return null
    const created: CaseTagDef = { id: makeId('case-tag'), name: normalized, color, createdAt: Date.now() }
    setCaseTagDefs((prev) => (findTagByName(prev, normalized) ? prev : [...prev, created]))
    void saveLocalRecord('caseTagDefs', created)
    return created
  }, [caseTagDefs, makeId])

  const updateCaseTag = useCallback((id: string, patch: Partial<Pick<CaseTagDef, 'name' | 'color'>>) => {
    setCaseTagDefs((prev) => {
      const target = prev.find((tag) => tag.id === id)
      if (!target) return prev
      const normalizedName = patch.name == null ? undefined : normalizeTagName(patch.name)
      if (patch.name != null && !normalizedName) return prev
      if (normalizedName && !tagNamesEqual(normalizedName, target.name) && findTagByName(prev, normalizedName, id)) return prev
      return prev.map((tag) => {
        if (tag.id !== id) return tag
        const next = { ...tag, ...patch, name: normalizedName ?? tag.name }
        void saveLocalRecord('caseTagDefs', next)
        return next
      })
    })
  }, [])

  const deleteCaseTag = useCallback((id: string) => {
    setCaseTagDefs((prev) => prev.filter((tag) => tag.id !== id))
    setCases((prev) =>
      prev.map((caseRecord) => {
        if (!caseRecord.tagIds.includes(id)) return caseRecord
        const next = { ...caseRecord, tagIds: caseRecord.tagIds.filter((tagId) => tagId !== id), updatedAt: Date.now() }
        void saveLocalRecord('cases', next)
        return next
      }),
    )
    void deleteLocalRecord('caseTagDefs', id)
  }, [])

  const value = useMemo<CairnStore>(
    () => ({
      accounts,
      periods,
      trades,
      tagDefs,
      cases,
      caseCards,
      caseBindings,
      caseTagDefs,
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
      getCase: (id) => cases.find((caseRecord) => caseRecord.id === id),
      getCaseCards: (caseId) => caseCards.filter((card) => card.caseId === caseId),
      getCaseBinding: (caseId) => caseBindings.find((binding) => binding.caseId === caseId),
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
      createCase,
      updateCase,
      deleteCase,
      createCaseCard,
      moveCaseCard,
      updateCaseCardText,
      updateCaseCardBarRef,
      deleteCaseCard,
      updateCaseCardAnalysis,
      analyzeCaseCard,
      refreshCaseExecutionSuggestions,
      setCaseExecutionSuggestionStatus,
      summarizeCase,
      aiTasks,
      prefillTradePlanFromBoundCase,
      createCaseBinding,
      deleteCaseBinding,
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
      createCaseTag,
      updateCaseTag,
      deleteCaseTag,
    }),
    [accounts, periods, trades, tagDefs, cases, caseCards, caseBindings, caseTagDefs, importBatches, attachments, chartImports, chartCandles, symbols, notes, aiTasks, updateAccount, updatePeriod, updateTrade, updateNote, createAccount, createPeriod, createSymbol, createNote, createImageAttachment, deleteAttachment, createCase, updateCase, deleteCase, createCaseCard, moveCaseCard, updateCaseCardText, updateCaseCardBarRef, updateCaseCardAnalysis, analyzeCaseCard, prefillTradePlanFromBoundCase, createCaseBinding, deleteCaseBinding, createTrades, createImportBatch, createChartImport, deleteChartImport, rollbackImportBatch, deleteAccount, deletePeriod, deleteTrade, deleteSymbol, deleteNote, restoreState, exportBackup, setTradeStatus, createTag, updateTag, deleteTag, createCaseTag, updateCaseTag, deleteCaseTag],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useCairn(): CairnStore {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useCairn 必须在 CairnProvider 内使用')
  return ctx
}
