'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ClipboardPaste, Plus, X } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { TradesTable } from '@/components/trades-table'
import { TradeFilterChips, TradeFilterMenu } from '@/components/trade-filter-menu'
import { ManageTagsDialog } from '@/components/manage-tags-dialog'
import { tagColorClasses, tagDotClasses } from '@/components/tag-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { computeTradeMetrics } from '@/lib/metrics'
import { feeRatesResolverFor } from '@/lib/fee'
import { useCairn } from '@/lib/store'
import {
  EMPTY_TRADE_FILTER,
  loadTradeFilterPresets,
  matchesTradeFilter,
  saveTradeFilterPresets,
  type TradeFilterConditions,
  type TradeFilterPreset,
} from '@/lib/trade-filters'
import { findTagByName, sortTagDefsByColor, tagNameKey, tagNamesEqual, uniqueTagNames } from '@/lib/tags'
import { getPossibleDuplicateTrade } from '@/lib/trade-duplicates'
import { parseTradeTransferPayload, type TradeTransferPayload } from '@/lib/trade-transfer'
import type { Execution, Trade, TradeEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

const ALL = 'all'

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function TradesPage() {
  const { accounts, periods, trades, tagDefs, symbols, createTrades } = useCairn()
  const [accountId, setAccountId] = useState(ALL)
  const [periodId, setPeriodId] = useState(ALL)
  const [symbolId, setSymbolId] = useState(ALL)
  const [direction, setDirection] = useState(ALL)
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [pastePayload, setPastePayload] = useState<TradeTransferPayload | null>(null)
  const [pasteError, setPasteError] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')
  const [targetPeriodId, setTargetPeriodId] = useState('')
  const [targetSymbolId, setTargetSymbolId] = useState('')
  const [advancedFilter, setAdvancedFilter] = useState<TradeFilterConditions>(EMPTY_TRADE_FILTER)
  const [filterPresets, setFilterPresets] = useState<TradeFilterPreset[]>(() => loadTradeFilterPresets())

  const periodOptions = useMemo(
    () => (accountId === ALL ? periods : periods.filter((p) => p.accountId === accountId)),
    [accountId, periods],
  )
  const sortedTagDefs = useMemo(() => sortTagDefsByColor(tagDefs), [tagDefs])
  const ratesFor = useMemo(() => feeRatesResolverFor(accounts), [accounts])

  function toggleTag(name: string) {
    setActiveTags((prev) => {
      const active = prev.some((tag) => tagNamesEqual(tag, name))
      return active ? prev.filter((tag) => !tagNamesEqual(tag, name)) : uniqueTagNames([...prev, name])
    })
  }

  useEffect(() => {
    const availableKeys = new Set(tagDefs.map((tag) => tagNameKey(tag.name)))
    setActiveTags((prev) => {
      const next = uniqueTagNames(prev)
        .filter((tag) => availableKeys.has(tagNameKey(tag)))
        .map((tag) => findTagByName(tagDefs, tag)?.name ?? tag)
      return next.length === prev.length && next.every((tag, index) => tag === prev[index]) ? prev : next
    })
  }, [tagDefs])

  const filtered = useMemo(
    () =>
      trades.filter(
        (t) =>
          (accountId === ALL || t.accountId === accountId) &&
          (periodId === ALL || t.periodId === periodId) &&
          (symbolId === ALL || t.symbolId === symbolId) &&
          (direction === ALL || t.direction === direction) &&
          (activeTags.length === 0 || activeTags.every((tag) => t.tags.some((tradeTag) => tagNamesEqual(tradeTag, tag)))) &&
          matchesTradeFilter(t, advancedFilter, ratesFor(t)),
      ),
    [trades, accountId, periodId, symbolId, direction, activeTags, advancedFilter, ratesFor],
  )
  const targetPeriodOptions = useMemo(
    () => periods.filter((p) => p.accountId === targetAccountId),
    [targetAccountId, periods],
  )

  const sortedFiltered = useMemo(
    () => [...filtered].sort((a, b) => computeTradeMetrics(b).entryTime - computeTradeMetrics(a).entryTime),
    [filtered],
  )
  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedTrades = sortedFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const transferPreviewTrade = useMemo(() => {
    if (!pastePayload || !targetAccountId || !targetPeriodId || !targetSymbolId) return null
    return instantiateTradeFromTransfer(pastePayload, {
      accountId: targetAccountId,
      periodId: targetPeriodId,
      symbolId: targetSymbolId,
      seq: Math.max(0, ...trades.map((trade) => trade.seq)) + 1,
    })
  }, [pastePayload, targetAccountId, targetPeriodId, targetSymbolId, trades])
  const possibleDuplicate = transferPreviewTrade ? getPossibleDuplicateTrade(transferPreviewTrade, trades) : null

  useEffect(() => {
    setPage(1)
  }, [accountId, periodId, symbolId, direction, activeTags, advancedFilter, pageSize])

  function savePreset(name: string, conditions: TradeFilterConditions) {
    const preset: TradeFilterPreset = { id: makeId('filter-preset'), name, conditions, createdAt: Date.now() }
    const next = [...filterPresets, preset]
    setFilterPresets(next)
    saveTradeFilterPresets(next)
  }

  function deletePreset(id: string) {
    const next = filterPresets.filter((preset) => preset.id !== id)
    setFilterPresets(next)
    saveTradeFilterPresets(next)
  }

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  async function handlePasteTradeJson() {
    setPasteError('')
    try {
      const text = await navigator.clipboard.readText()
      const payload = parseTradeTransferPayload(text)
      const matchedSymbol = payload.symbol
        ? symbols.find((symbol) => symbol.exchange === payload.symbol?.exchange && symbol.code === payload.symbol?.code)
        : undefined
      const nextAccountId = accountId !== ALL ? accountId : accounts[0]?.id ?? ''
      const nextPeriodId = periodId !== ALL ? periodId : periods.find((period) => period.accountId === nextAccountId)?.id ?? ''
      setPastePayload(payload)
      setTargetAccountId(nextAccountId)
      setTargetPeriodId(nextPeriodId)
      setTargetSymbolId(matchedSymbol?.id ?? (symbolId !== ALL ? symbolId : symbols[0]?.id ?? ''))
    } catch (error) {
      setPastePayload(null)
      setPasteError(error instanceof Error ? error.message : String(error))
    }
  }

  function importPastedTrade() {
    if (!transferPreviewTrade) return
    createTrades([transferPreviewTrade])
    setPastePayload(null)
    setPasteError('')
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="交易"
        actions={
          <div className="flex items-center gap-2">
            <ManageTagsDialog />
            <Button variant="outline" onClick={handlePasteTradeJson}>
              <ClipboardPaste data-icon="inline-start" />
              粘贴 JSON
            </Button>
            <Button nativeButton={false} render={<Link to="/trades/new" />}>
              <Plus data-icon="inline-start" />
              手动录入
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={[
            { value: ALL, label: '全部账户' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          value={accountId}
          onValueChange={(v) => {
            setAccountId(v as string)
            setPeriodId(ALL)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="账户" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部账户</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '全部 Period' },
            ...periodOptions.map((p) => ({ value: p.id, label: p.name })),
          ]}
          value={periodId}
          onValueChange={(v) => setPeriodId(v as string)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部 Period</SelectItem>
              {periodOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '全部品种' },
            ...symbols.map((s) => ({ value: s.id, label: `${s.exchange}:${s.code}` })),
          ]}
          value={symbolId}
          onValueChange={(v) => setSymbolId(v as string)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="品种" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>全部品种</SelectItem>
              {symbols.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.exchange}:{s.code}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: ALL, label: '多空' },
            { value: 'long', label: '仅多' },
            { value: 'short', label: '仅空' },
          ]}
          value={direction}
          onValueChange={(v) => setDirection(v as string)}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="方向" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>多空</SelectItem>
              <SelectItem value="long">仅多</SelectItem>
              <SelectItem value="short">仅空</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{filtered.length} 笔交易</span>
          <TradeFilterMenu
            conditions={advancedFilter}
            onChange={setAdvancedFilter}
            presets={filterPresets}
            onSavePreset={savePreset}
            onDeletePreset={deletePreset}
          />
          <Select
            items={[
              { value: '20', label: '20 / 页' },
              { value: '40', label: '40 / 页' },
            ]}
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v))}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="20">20 / 页</SelectItem>
                <SelectItem value="40">40 / 页</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <TradeFilterChips conditions={advancedFilter} onChange={setAdvancedFilter} />

      {tagDefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按标签筛选">
          {sortedTagDefs.map((tag) => {
            const active = activeTags.includes(tag.name)
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag.name)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all',
                  active
                    ? cn(tagColorClasses[tag.color], 'ring-1 ring-current/30')
                    : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', tagDotClasses[tag.color])} aria-hidden="true" />
                {tag.name}
              </button>
            )
          })}
          {activeTags.length > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setActiveTags([])}>
              <X data-icon="inline-start" />
              清除
            </Button>
          )}
        </div>
      )}

      {(pastePayload || pasteError) && (
        <Card className={possibleDuplicate ? 'bg-warning/8 ring-warning/30' : undefined}>
          <CardContent className="flex flex-col gap-4">
            {pasteError ? (
              <div className="flex items-center gap-2 text-sm text-loss">
                <AlertTriangle className="size-4" />
                {pasteError}
              </div>
            ) : pastePayload ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">准备导入 Trade JSON</span>
                    <span className="text-sm text-muted-foreground">
                      {pastePayload.symbol ? `${pastePayload.symbol.exchange}:${pastePayload.symbol.code}` : '未提供 symbol'} · {pastePayload.trade.direction} · {pastePayload.trade.executions.length} executions
                    </span>
                    {possibleDuplicate && (
                      <span className="flex items-center gap-1.5 text-sm text-warning">
                        <AlertTriangle className="size-4" />
                        <Tooltip>
                          <TooltipTrigger render={<span>疑似重复：Trade #{String(possibleDuplicate.trade.seq).padStart(3, '0')}</span>} />
                          <TooltipContent className="max-w-sm">
                            <span className="flex flex-col gap-1 py-1">
                              <span className="font-mono font-medium">Trade #{String(possibleDuplicate.trade.seq).padStart(3, '0')}</span>
                              {possibleDuplicate.reasons.map((reason) => (
                                <span key={reason}>{reason}</span>
                              ))}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setPastePayload(null)}>取消</Button>
                    <Button onClick={importPastedTrade} disabled={!transferPreviewTrade}>导入</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Select
                    items={accounts.map((account) => ({ value: account.id, label: account.name }))}
                    value={targetAccountId}
                    onValueChange={(value) => {
                      setTargetAccountId(value as string)
                      setTargetPeriodId(periods.find((period) => period.accountId === value)?.id ?? '')
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    items={targetPeriodOptions.map((period) => ({ value: period.id, label: period.name }))}
                    value={targetPeriodId}
                    onValueChange={(value) => setTargetPeriodId(value as string)}
                  >
                    <SelectTrigger><SelectValue placeholder="Period" /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {targetPeriodOptions.map((period) => <SelectItem key={period.id} value={period.id}>{period.name}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select
                    items={symbols.map((symbol) => ({ value: symbol.id, label: `${symbol.exchange}:${symbol.code}` }))}
                    value={targetSymbolId}
                    onValueChange={(value) => setTargetSymbolId(value as string)}
                  >
                    <SelectTrigger><SelectValue placeholder="Symbol" /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {symbols.map((symbol) => <SelectItem key={symbol.id} value={symbol.id}>{symbol.exchange}:{symbol.code}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <TradesTable trades={pagedTrades} showContext />
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <span className="text-sm text-muted-foreground">
                第 {currentPage} / {totalPages} 页
              </span>
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function instantiateTradeFromTransfer(
  payload: TradeTransferPayload,
  target: { accountId: string; periodId: string; symbolId: string; seq: number },
): Trade {
  const tradeId = makeId('trd')
  const now = Date.now()
  const executions: Execution[] = payload.trade.executions.map((execution) => ({
    ...execution,
    id: makeId('exe'),
    tradeId,
  }))
  const events: TradeEvent[] = payload.trade.events.map((event) => ({
    ...event,
    id: makeId('evt'),
    tradeId,
  }))
  return {
    ...payload.trade,
    id: tradeId,
    seq: target.seq,
    accountId: target.accountId,
    periodId: target.periodId,
    symbolId: target.symbolId,
    executions,
    events,
    referenceImages: [],
    tags: uniqueTagNames(payload.trade.tags),
    createdAt: now,
  }
}
