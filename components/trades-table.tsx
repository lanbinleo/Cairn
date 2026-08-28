'use client'

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PnlText, RText } from '@/components/pnl-text'
import { TradeTitle } from '@/components/trade-title'
import { TagBadge } from '@/components/tag-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { computeTradeMetrics, equityBeforeByTrade } from '@/lib/metrics'
import { fmtUtcDateTime, fmtDuration } from '@/lib/format'
import { useCairn } from '@/lib/store'
import { sortTagNamesByColor } from '@/lib/tags'
import type { Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

const quoteSuffixes = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'PERP']

function compactSymbolCode(code: string) {
  const upper = code.toUpperCase()
  const suffix = quoteSuffixes.find((item) => upper.endsWith(item) && upper.length > item.length)
  return suffix ? code.slice(0, -suffix.length) : code
}

function EllipsisTooltip({
  children,
  content,
  className,
}: {
  children: ReactNode
  content: ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn('block truncate', className)}>{children}</span>} />
      <TooltipContent className="max-w-md">{content}</TooltipContent>
    </Tooltip>
  )
}

export function DirectionBadge({ direction }: { direction: Trade['direction'] }) {
  return (
    <Badge
      className={cn(
        'border-transparent font-medium',
        direction === 'long' ? 'bg-profit/12 text-profit' : 'bg-loss/12 text-loss',
      )}
    >
      {direction === 'long' ? '↗ 多' : '↘ 空'}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: Trade['status'] }) {
  return status === 'open' ? (
    <Badge className="border-transparent bg-primary/12 text-primary">持仓中</Badge>
  ) : (
    <Badge variant="secondary">已平仓</Badge>
  )
}

export function TradesTable({
  trades,
  showContext = false,
}: {
  trades: Trade[]
  /** 是否显示 账户/Period 列（全局交易列表用） */
  showContext?: boolean
}) {
  const { getAccount, getPeriod, symbols, tagDefs, accounts, trades: allTrades } = useCairn()
  const sorted = [...trades].sort((a, b) => computeTradeMetrics(b).entryTime - computeTradeMetrics(a).entryTime)
  /**
   * 每笔入场前权益（PnL% 分母）。必须用全账户全量交易推导——trades prop 在
   * 调用方可能是筛选/分页/最近的子集，按子集累计会把分母重置回初始资金。
   */
  const equityBefore = useMemo(() => {
    const merged = new Map<string, number>()
    for (const account of accounts) {
      const accountTrades = allTrades.filter((trade) => trade.accountId === account.id)
      for (const [tradeId, equity] of equityBeforeByTrade(accountTrades, account.initialBalance)) {
        merged.set(tradeId, equity)
      }
    }
    return merged
  }, [accounts, allTrades])

  const symbolLabel = (symbolId: string) => {
    const s = symbols.find((x) => x.id === symbolId)
    return s ? `${s.exchange}:${s.code}` : symbolId
  }

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">交易</TableHead>
          <TableHead className="w-20">品种</TableHead>
          <TableHead className="w-14">方向</TableHead>
          {showContext && <TableHead className="w-36">账户 / Period</TableHead>}
          <TableHead className="w-28">标签</TableHead>
          <TableHead className="w-40">进场时间（UTC）</TableHead>
          <TableHead className="w-16 text-right">持仓</TableHead>
          <TableHead className="w-24 text-right">PnL</TableHead>
          <TableHead className="w-20 text-right">PnL%</TableHead>
          <TableHead className="w-20 text-right">R</TableHead>
          <TableHead className="w-20">状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((trade) => {
          const m = computeTradeMetrics(trade)
          const account = getAccount(trade.accountId)
          const period = getPeriod(trade.periodId)
          const symbol = symbols.find((x) => x.id === trade.symbolId)
          const symbolFull = symbol ? `${symbol.exchange}:${symbol.code}` : trade.symbolId
          const symbolShort = symbol ? compactSymbolCode(symbol.code) : symbolLabel(trade.symbolId)
          const tags = sortTagNamesByColor(trade.tags, tagDefs)
          return (
            <TableRow key={trade.id} className="group">
              <TableCell>
                <TradeTitle trade={trade} className="text-sm" />
              </TableCell>
              <TableCell className="min-w-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link to={`/trades/${trade.id}`} className="block truncate font-mono text-muted-foreground group-hover:text-foreground">
                        {symbolShort}
                      </Link>
                    }
                  />
                  <TooltipContent className="max-w-md">
                    <span className="flex flex-col gap-0.5 py-0.5">
                      <span className="font-mono font-medium">{symbolFull}</span>
                      {symbol?.name && <span>{symbol.name}</span>}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <DirectionBadge direction={trade.direction} />
              </TableCell>
              {showContext && (
                <TableCell className="min-w-0 text-muted-foreground">
                  <EllipsisTooltip content={`${account?.name ?? '未知账户'} · ${period?.name ?? '未知 Period'}`}>
                    {account?.name} · {period?.name}
                  </EllipsisTooltip>
                </TableCell>
              )}
              <TableCell className="min-w-0">
                {tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden">
                          {tags.slice(0, 1).map((tag) => (
                            <TagBadge key={tag} name={tag} className="max-w-16 truncate text-[10px]" />
                          ))}
                          {tags.length > 1 && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">+{tags.length - 1}</span>
                          )}
                        </div>
                      }
                    />
                    <TooltipContent>
                      <span className="flex max-w-56 flex-wrap gap-1 py-0.5">
                        {tags.map((tag) => (
                          <TagBadge key={tag} name={tag} className="text-[10px]" />
                        ))}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">{fmtUtcDateTime(m.entryTime, false)}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">
                {trade.status === 'closed' ? fmtDuration(m.durationMs) : '—'}
              </TableCell>
              <TableCell className="text-right">
                {trade.status === 'closed' ? <PnlText value={m.pnl} currency={account?.currency} /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right">
                {trade.status === 'closed' && (() => {
                  const base = equityBefore.get(trade.id)
                  if (base == null || base === 0) return <span className="text-muted-foreground">—</span>
                  const pct = (m.pnl / base) * 100
                  return (
                    <span
                      className="font-mono tabular-nums"
                      title="PnL ÷ 该笔入场前权益（初始资金 + 此前已平仓累计 PnL）"
                    >
                      <span className={cn(pct > 0 ? 'text-profit' : pct < 0 ? 'text-loss' : 'text-muted-foreground')}>
                        {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                    </span>
                  )
                })()}
                {trade.status !== 'closed' && <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right">
                {trade.status === 'closed' ? <RText value={m.rMultiple} /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <StatusBadge status={trade.status} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
