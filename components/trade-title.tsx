'use client'

import { Link } from 'react-router-dom'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { computeTradeMetrics } from '@/lib/metrics'
import { fmtMoney, fmtPct } from '@/lib/format'
import { useCairn } from '@/lib/store'
import type { Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 交易展示标题：Trade #003（hover 显示品种 / 方向 / 盈亏详情）。
 * 用于列表、mention 等任何需要指代一笔交易的地方。
 */
export function TradeTitle({
  trade,
  link = true,
  className,
}: {
  trade: Trade
  /** 是否包一层跳转链接 */
  link?: boolean
  className?: string
}) {
  const { getAccount, getSymbolLabel } = useTradeTooltipData()
  const account = getAccount(trade.accountId)
  const m = computeTradeMetrics(trade)
  const pnlPct = account ? m.pnl / account.initialBalance : null
  const closed = trade.status === 'closed'
  const tone = !closed
    ? 'text-primary'
    : m.pnl > 0.005
      ? 'text-profit'
      : m.pnl < -0.005
        ? 'text-loss'
        : 'text-muted-foreground'

  const label = (
    <span className={cn('font-mono font-medium', className)}>
      Trade <span className={tone}>#{String(trade.seq).padStart(3, '0')}</span>
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          link ? (
            <Link to={`/trades/${trade.id}`} className="transition-opacity hover:opacity-70">
              {label}
            </Link>
          ) : (
            <span>{label}</span>
          )
        }
      />
      <TooltipContent>
        <span className="flex flex-col gap-0.5 py-0.5">
          <span className="font-mono font-medium">{getSymbolLabel(trade.symbolId)}</span>
          <span>
            {trade.direction === 'long' ? '多头' : '空头'} ·{' '}
            {closed ? (
              <>
                {fmtMoney(m.pnl, account?.currency)}
                {pnlPct != null && ` (${m.pnl >= 0 ? '+' : ''}${fmtPct(pnlPct)})`}
              </>
            ) : (
              '持仓中'
            )}
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function useTradeTooltipData() {
  const { getAccount, symbols } = useCairn()
  return {
    getAccount,
    getSymbolLabel: (symbolId: string) => {
      const s = symbols.find((x) => x.id === symbolId)
      return s ? `${s.exchange}:${s.code}` : symbolId
    },
  }
}
