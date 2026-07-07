'use client'

import { use } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'

import { PnlText } from '@/components/pnl-text'
import { StatCard } from '@/components/stat-card'
import { EquityChart } from '@/components/equity-chart'
import { EditAccountDialog } from '@/components/edit-account-dialog'
import { EditPeriodDialog } from '@/components/edit-period-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { symbolLabel } from '@/lib/mock-data'
import { useCairn } from '@/lib/store'
import { computeStats, computeEquityCurve } from '@/lib/metrics'
import { fmtMoney, fmtPct, fmtDateRange, fmtUtcDate } from '@/lib/format'

export default function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>
}) {
  const { accountId } = use(params)
  const { getAccount, periods, trades } = useCairn()
  const account = getAccount(accountId)
  if (!account) notFound()

  const accountTrades = trades.filter((t) => t.accountId === account.id)
  const stats = computeStats(accountTrades, account.initialBalance)
  const curve = computeEquityCurve(accountTrades, account.initialBalance)
  const accountPeriods = periods
    .filter((p) => p.accountId === account.id)
    .sort((a, b) => b.chartStart - a.chartStart)
  const equity = account.initialBalance + stats.totalPnl

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="面包屑">
            <Link href="/accounts" className="transition-colors hover:text-foreground">
              账户
            </Link>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="text-foreground">{account.name}</span>
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
            <Badge variant="secondary">{account.kind === 'backtest' ? '回测' : '实盘'}</Badge>
          </div>
          {account.note && <p className="text-sm text-muted-foreground text-pretty">{account.note}</p>}
        </div>
        <div className="flex items-center gap-2">
          <EditAccountDialog account={account} />
          <Button>
            <Plus data-icon="inline-start" />
            新建 Period
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="当前权益"
          value={fmtMoney(equity, account.currency)}
          sub={<PnlText value={stats.totalPnl} currency={account.currency} className="text-xs" />}
        />
        <StatCard
          label="初始资金"
          value={fmtMoney(account.initialBalance, account.currency)}
          sub={`创建于 ${fmtUtcDate(account.createdAt)}`}
        />
        <StatCard
          label="交易 / 胜率"
          value={`${stats.tradeCount} / ${fmtPct(stats.winRate)}`}
          sub={`${stats.wins} 胜 ${stats.losses} 负${stats.breakeven > 0 ? ` ${stats.breakeven} 平` : ''}`}
        />
        <StatCard
          label="Profit Factor"
          value={stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}
          sub={`期望值 ${fmtMoney(stats.expectancy, account.currency)} / 笔`}
        />
        <StatCard
          label="最大回撤"
          value={fmtPct(stats.maxDrawdownPct)}
          sub={`平均 R ${stats.avgR == null ? '—' : stats.avgR.toFixed(2)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">资金曲线</CardTitle>
        </CardHeader>
        <CardContent>
          <EquityChart points={curve} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periods（{accountPeriods.length}）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {accountPeriods.map((period) => {
            const periodTrades = trades.filter((t) => t.periodId === period.id)
            const pStats = computeStats(periodTrades, account.initialBalance)
            return (
              <div
                key={period.id}
                className="group relative flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:border-ring/40 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/accounts/${account.id}/periods/${period.id}`}
                      className="font-medium after:absolute after:inset-0"
                    >
                      {period.name}
                    </Link>
                    <div className="flex items-center gap-1">
                      {period.symbolIds.map((sid) => (
                        <Badge key={sid} variant="outline" className="font-mono text-[10px]">
                          {symbolLabel(sid)}
                        </Badge>
                      ))}
                    </div>
                    <span className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <EditPeriodDialog period={period} size="icon-sm" />
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:gap-3">
                    <span>图表时间 {fmtDateRange(period.chartStart, period.chartEnd)}</span>
                    {period.realStart != null && period.realEnd != null && (
                      <span>真实时间 {fmtDateRange(period.realStart, period.realEnd)}</span>
                    )}
                  </div>
                  {period.note && (
                    <p className="text-xs text-muted-foreground text-pretty">{period.note}</p>
                  )}
                </div>
                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-sm tabular-nums">{pStats.tradeCount}</span>
                    <span className="text-xs text-muted-foreground">交易</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-sm tabular-nums">{fmtPct(pStats.winRate)}</span>
                    <span className="text-xs text-muted-foreground">胜率</span>
                  </div>
                  <div className="flex w-24 flex-col items-end gap-0.5">
                    <PnlText value={pStats.totalPnl} currency={account.currency} className="text-sm font-medium" />
                    <span className="text-xs text-muted-foreground">PnL</span>
                  </div>
                  <ChevronRight
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
