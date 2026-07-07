'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PnlText, RText } from '@/components/pnl-text'
import { TradeTitle } from '@/components/trade-title'
import { TagBadge } from '@/components/tag-badge'
import { computeTradeMetrics } from '@/lib/metrics'
import { fmtUtcDateTime, fmtDuration } from '@/lib/format'
import { useCairn } from '@/lib/store'
import type { Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  const { getAccount, getPeriod, symbols } = useCairn()
  const sorted = [...trades].sort((a, b) => computeTradeMetrics(b).entryTime - computeTradeMetrics(a).entryTime)

  const symbolLabel = (symbolId: string) => {
    const s = symbols.find((x) => x.id === symbolId)
    return s ? `${s.exchange}:${s.code}` : symbolId
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">交易</TableHead>
          <TableHead>品种</TableHead>
          <TableHead className="w-14">方向</TableHead>
          {showContext && <TableHead>账户 / Period</TableHead>}
          <TableHead>标签</TableHead>
          <TableHead>进场时间（UTC）</TableHead>
          <TableHead className="text-right">持仓</TableHead>
          <TableHead className="text-right">PnL</TableHead>
          <TableHead className="text-right">R</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((trade) => {
          const m = computeTradeMetrics(trade)
          const account = getAccount(trade.accountId)
          const period = getPeriod(trade.periodId)
          return (
            <TableRow key={trade.id} className="group">
              <TableCell>
                <TradeTitle trade={trade} className="text-sm" />
              </TableCell>
              <TableCell>
                <Link href={`/trades/${trade.id}`} className="block font-mono text-muted-foreground group-hover:text-foreground">
                  {symbolLabel(trade.symbolId)}
                </Link>
              </TableCell>
              <TableCell>
                <DirectionBadge direction={trade.direction} />
              </TableCell>
              {showContext && (
                <TableCell className="text-muted-foreground">
                  {account?.name} · {period?.name}
                </TableCell>
              )}
              <TableCell>
                <div className="flex max-w-44 flex-wrap gap-1">
                  {trade.tags.slice(0, 2).map((tag) => (
                    <TagBadge key={tag} name={tag} className="text-[10px]" />
                  ))}
                  {trade.tags.length > 2 && (
                    <span className="self-center text-[10px] text-muted-foreground">+{trade.tags.length - 2}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">{fmtUtcDateTime(m.entryTime, false)}</TableCell>
              <TableCell className="text-right font-mono text-muted-foreground">
                {trade.status === 'closed' ? fmtDuration(m.durationMs) : '—'}
              </TableCell>
              <TableCell className="text-right">
                {trade.status === 'closed' ? <PnlText value={m.pnl} currency={account?.currency} /> : <span className="text-muted-foreground">—</span>}
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
