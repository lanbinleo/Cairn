'use client'

import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { PnlText } from '@/components/pnl-text'
import { Sparkline } from '@/components/sparkline'
import { TradesTable } from '@/components/trades-table'
import { EquitySection } from '@/components/dashboard/equity-section'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCairn } from '@/lib/store'
import { computeStats, computeEquityCurve, computeTradeMetrics } from '@/lib/metrics'
import { feeRatesForAccount, feeRatesResolverFor } from '@/lib/fee'
import { fmtMoney, fmtPct, fmtDateRange } from '@/lib/format'

export default function DashboardPage() {
  const { accounts, periods, trades } = useCairn()
  const totalInitial = accounts.reduce((s, a) => s + a.initialBalance, 0)
  const stats = computeStats(trades, totalInitial, feeRatesResolverFor(accounts))
  const totalEquity = totalInitial + stats.totalPnl

  const recentTrades = [...trades]
    .filter((t) => t.status === 'closed')
    .sort((a, b) => computeTradeMetrics(b).exitTime - computeTradeMetrics(a).exitTime)
    .slice(0, 6)

  const recentPeriods = [...periods].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader title="总览" description="所有账户的整体表现一览" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="总权益"
          value={fmtMoney(totalEquity)}
          sub={
            <PnlText
              value={stats.totalPnl}
              className="text-xs"
            />
          }
        />
        <StatCard
          label="总交易数"
          value={String(stats.tradeCount)}
          sub={`${stats.wins} 胜 / ${stats.losses} 负${stats.breakeven > 0 ? ` / ${stats.breakeven} 平` : ''}`}
        />
        <StatCard
          label="胜率"
          value={fmtPct(stats.winRate)}
          sub={`Profit Factor ${stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}`}
        />
        <StatCard
          label="最大回撤"
          value={fmtPct(stats.maxDrawdownPct)}
          sub={`平均 R ${stats.avgR == null ? '—' : stats.avgR.toFixed(2)}`}
        />
      </div>

      <EquitySection />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">账户</CardTitle>
            <CardAction>
              <Link
                to="/accounts"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                全部
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {accounts.map((account) => {
              const accountTrades = trades.filter((t) => t.accountId === account.id)
              const accountStats = computeStats(accountTrades, account.initialBalance, () => feeRatesForAccount(account))
              const curve = computeEquityCurve(accountTrades, account.initialBalance, () => feeRatesForAccount(account))
              return (
                <Link
                  key={account.id}
                  to={`/accounts/${account.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{account.name}</span>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {account.kind === 'backtest' ? '回测' : '实盘'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{accountStats.tradeCount} 笔交易</span>
                  </div>
                  <Sparkline values={curve.map((p) => p.equity)} width={80} className="hidden shrink-0 sm:block" />
                  <div className="flex w-24 flex-col items-end gap-0.5">
                    <PnlText value={accountStats.totalPnl} currency={account.currency} className="text-sm font-medium" />
                    <span className="text-xs text-muted-foreground">
                      {accountStats.totalPnl >= 0 ? '+' : ''}
                      {fmtPct(accountStats.totalPnl / account.initialBalance)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">近期 Period</CardTitle>
            <CardAction>
              <Link
                to="/accounts"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                管理
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {recentPeriods.map((period) => {
              const account = accounts.find((a) => a.id === period.accountId)
              const periodTrades = trades.filter((t) => t.periodId === period.id)
              const periodStats = computeStats(periodTrades, account?.initialBalance ?? 0, account ? () => feeRatesForAccount(account) : undefined)
              return (
                <Link
                  key={period.id}
                  to={`/accounts/${period.accountId}/periods/${period.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{period.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {account?.name} · {fmtDateRange(period.chartStart, period.chartEnd)}
                    </span>
                  </div>
                  <div className="hidden w-16 flex-col items-end gap-0.5 sm:flex">
                    <span className="font-mono text-sm tabular-nums">{periodStats.tradeCount}</span>
                    <span className="text-xs text-muted-foreground">交易</span>
                  </div>
                  <div className="hidden w-16 flex-col items-end gap-0.5 sm:flex">
                    <span className="font-mono text-sm tabular-nums">{fmtPct(periodStats.winRate)}</span>
                    <span className="text-xs text-muted-foreground">胜率</span>
                  </div>
                  <div className="flex w-24 flex-col items-end gap-0.5">
                    <PnlText value={periodStats.totalPnl} currency={account?.currency} className="text-sm font-medium" />
                    <span className="text-xs text-muted-foreground">PnL</span>
                  </div>
                </Link>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">近期交易</CardTitle>
          <CardAction>
            <Link
              to="/trades"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              全部交易
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TradesTable trades={recentTrades} showContext />
        </CardContent>
      </Card>
    </div>
  )
}
