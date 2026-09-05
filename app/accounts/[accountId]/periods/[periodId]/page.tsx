'use client'

import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { PnlText } from '@/components/pnl-text'
import { StatCard } from '@/components/stat-card'
import { EquityChart } from '@/components/equity-chart'
import { TradesTable } from '@/components/trades-table'
import { EditPeriodDialog } from '@/components/edit-period-dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCairn } from '@/lib/store'
import { computeStats, computeEquityCurve } from '@/lib/metrics'
import { feeRatesForAccount } from '@/lib/fee'
import { fmtMoney, fmtCompactMoney, fmtPct, fmtDateRange } from '@/lib/format'

export default function PeriodDetailPage() {
  const { accountId = '', periodId = '' } = useParams()
  const { getAccount, getPeriod, trades, symbolLabel } = useCairn()
  const account = getAccount(accountId)
  const period = getPeriod(periodId)
  if (!account || !period || period.accountId !== account.id) return <Navigate to="/accounts" replace />

  const periodTrades = trades.filter((t) => t.periodId === period.id)
  const stats = computeStats(periodTrades, account.initialBalance, () => feeRatesForAccount(account))
  const curve = computeEquityCurve(periodTrades, account.initialBalance, () => feeRatesForAccount(account))

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="面包屑">
          <Link to="/accounts" className="transition-colors hover:text-foreground">
            账户
          </Link>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <Link to={`/accounts/${account.id}`} className="transition-colors hover:text-foreground">
            {account.name}
          </Link>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span className="text-foreground">{period.name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{period.name}</h1>
          {period.symbolIds.map((sid) => (
            <Badge key={sid} variant="outline" className="font-mono">
              {symbolLabel(sid)}
            </Badge>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 text-sm text-muted-foreground sm:flex-row sm:gap-4">
          <span>图表时间 {fmtDateRange(period.chartStart, period.chartEnd)}</span>
          {period.realStart != null && period.realEnd != null && (
            <span>真实时间 {fmtDateRange(period.realStart, period.realEnd)}</span>
          )}
        </div>
        {period.note && <p className="text-sm text-muted-foreground text-pretty">{period.note}</p>}
        </div>
        <EditPeriodDialog period={period} />
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Period PnL"
          value={<PnlText value={stats.totalPnl} currency={account.currency} className="text-xl font-semibold" />}
          sub={`占初始资金 ${fmtPct(stats.totalPnl / account.initialBalance)}`}
        />
        <StatCard
          label="交易 / 胜率"
          value={`${stats.tradeCount} / ${fmtPct(stats.winRate)}`}
          sub={`${stats.wins} 胜 ${stats.losses} 负${stats.breakeven > 0 ? ` ${stats.breakeven} 平` : ''}`}
        />
        <StatCard
          label="Profit Factor"
          value={stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}
          sub={`期望值 ${fmtCompactMoney(stats.expectancy, account.currency)} / 笔`}
        />
        <StatCard
          label="平均盈 / 亏"
          value={`${fmtCompactMoney(stats.avgWin, account.currency)} / ${fmtCompactMoney(stats.avgLoss, account.currency)}`}
          title={`${fmtMoney(stats.avgWin, account.currency)} / ${fmtMoney(stats.avgLoss, account.currency)}`}
          sub={`平均 R ${stats.avgR == null ? '—' : stats.avgR.toFixed(2)}`}
        />
        <StatCard label="最大回撤" value={fmtPct(stats.maxDrawdownPct)} sub={fmtCompactMoney(stats.maxDrawdown, account.currency)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Period 资金曲线</CardTitle>
        </CardHeader>
        <CardContent>
          <EquityChart points={curve} baseline={account.initialBalance} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">交易（{periodTrades.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          <TradesTable trades={periodTrades} />
        </CardContent>
      </Card>
    </div>
  )
}
