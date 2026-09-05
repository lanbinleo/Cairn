'use client'

import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { PnlText } from '@/components/pnl-text'
import { StatCard } from '@/components/stat-card'
import { EquityChart } from '@/components/equity-chart'
import { EditAccountDialog } from '@/components/edit-account-dialog'
import { EditPeriodDialog } from '@/components/edit-period-dialog'
import { CreatePeriodDialog } from '@/components/create-period-dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/sonner'
import { useCairn } from '@/lib/store'
import { computeStats, computeEquityCurve } from '@/lib/metrics'
import { feeRatesForAccount } from '@/lib/fee'
import { fmtMoney, fmtCompactMoney, fmtPct, fmtDateRange, fmtUtcDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function AccountDetailPage() {
  const { accountId = '' } = useParams()
  const { getAccount, periods, trades, symbolLabel, updateAccount } = useCairn()
  const [feesOpen, setFeesOpen] = useState(false)
  const account = getAccount(accountId)
  if (!account) return <Navigate to="/accounts" replace />

  const accountTrades = trades.filter((t) => t.accountId === account.id)
  const stats = computeStats(accountTrades, account.initialBalance, () => feeRatesForAccount(account))
  const curve = computeEquityCurve(accountTrades, account.initialBalance, () => feeRatesForAccount(account))
  const accountPeriods = periods
    .filter((p) => p.accountId === account.id)
    .sort((a, b) => b.chartStart - a.chartStart)
  const equity = account.initialBalance + stats.totalPnl
  // 只有 feeOverride（导入的真实手续费）没有费率时也能对比口径
  const hasImportedFees = accountTrades.some((t) => t.executions.some((e) => e.feeOverride != null))

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="面包屑">
            <Link to="/accounts" className="transition-colors hover:text-foreground">
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
          <CreatePeriodDialog accountId={account.id} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="当前权益"
          value={fmtCompactMoney(equity, account.currency)}
          title={fmtMoney(equity, account.currency)}
          sub={<PnlText value={stats.totalPnl} currency={account.currency} className="text-xs" />}
        />
        <StatCard
          label="初始资金"
          value={fmtCompactMoney(account.initialBalance, account.currency)}
          title={fmtMoney(account.initialBalance, account.currency)}
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
          sub={`期望值 ${fmtCompactMoney(stats.expectancy, account.currency)} / 笔`}
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
          <EquityChart points={curve} baseline={account.initialBalance} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periods（{accountPeriods.length}）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {accountPeriods.map((period) => {
            const periodTrades = trades.filter((t) => t.periodId === period.id)
            const pStats = computeStats(periodTrades, account.initialBalance, () => feeRatesForAccount(account))
            return (
              <div
                key={period.id}
                className="group relative flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:border-ring/40 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/accounts/${account.id}/periods/${period.id}`}
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

      {/* 手续费开关收在折叠区（0.3.7）：临时对比毛/净口径用，平时不打扰 */}
      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={feesOpen}
            onClick={() => setFeesOpen((v) => !v)}
          >
            <span className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">手续费</CardTitle>
              <span className="text-sm text-muted-foreground">
                {account.takerFeePct != null || account.makerFeePct != null
                  ? `Taker ${account.takerFeePct ?? 0}% / Maker ${account.makerFeePct ?? 0}%`
                  : hasImportedFees
                    ? '费率未配置 · 有导入的真实手续费'
                    : '未配置费率'}
              </span>
              {account.feesDisabled && <Badge variant="secondary">已临时关闭</Badge>}
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', feesOpen && 'rotate-180')} />
          </button>
        </CardHeader>
        {feesOpen && (
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">临时关闭手续费</span>
                <span className="text-xs text-muted-foreground">
                  关闭后按费率推算的部分回到毛口径（PnL / 胜率 / R / 权益曲线）；导入文件自带的每行真实手续费仍保留
                </span>
              </div>
              <Switch
                checked={account.feesDisabled ?? false}
                disabled={!account.takerFeePct && !account.makerFeePct && !hasImportedFees}
                onCheckedChange={(checked) => {
                  updateAccount(account.id, { feesDisabled: checked || undefined })
                  const hasRates = account.takerFeePct != null || account.makerFeePct != null
                  toast.success(checked
                    ? (hasRates ? '已临时关闭费率推算，统计回到毛口径' : '已临时关闭费率推算（未配置费率，数字不变）')
                    : (hasRates ? '已恢复手续费，统计回到净额' : '已重新允许费率推算（未配置费率，数字不变）'))
                }}
              />
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
