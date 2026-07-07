'use client'

import Link from 'next/link'
import { ChevronRight, Plus } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { PnlText } from '@/components/pnl-text'
import { Sparkline } from '@/components/sparkline'
import { EditAccountDialog } from '@/components/edit-account-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCairn } from '@/lib/store'
import { computeStats, computeEquityCurve } from '@/lib/metrics'
import { fmtMoney, fmtPct } from '@/lib/format'

export default function AccountsPage() {
  const { accounts, periods, trades } = useCairn()
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="账户"
        description="每个账户是一个独立的交易环境 / 账本"
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            新建账户
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {accounts.map((account) => {
          const accountTrades = trades.filter((t) => t.accountId === account.id)
          const stats = computeStats(accountTrades, account.initialBalance)
          const curve = computeEquityCurve(accountTrades, account.initialBalance)
          const periodCount = periods.filter((p) => p.accountId === account.id).length
          const equity = account.initialBalance + stats.totalPnl

          return (
            <div key={account.id} className="group relative">
              <Card className="h-full transition-colors group-hover:border-ring/40">
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold">
                          <Link href={`/accounts/${account.id}`} className="after:absolute after:inset-0">
                            {account.name}
                          </Link>
                        </h2>
                        <Badge variant="secondary">{account.kind === 'backtest' ? '回测' : '实盘'}</Badge>
                      </div>
                      {account.note && (
                        <p className="text-sm text-muted-foreground">{account.note}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <EditAccountDialog account={account} size="icon-sm" />
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">当前权益</span>
                      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
                        {fmtMoney(equity, account.currency)}
                      </span>
                      <PnlText value={stats.totalPnl} currency={account.currency} className="text-sm" />
                    </div>
                    <Sparkline values={curve.map((p) => p.equity)} width={140} height={48} />
                  </div>

                  <div className="grid grid-cols-4 gap-2 border-t pt-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">Period</span>
                      <span className="font-mono text-sm font-medium tabular-nums">{periodCount}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">交易</span>
                      <span className="font-mono text-sm font-medium tabular-nums">{stats.tradeCount}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">胜率</span>
                      <span className="font-mono text-sm font-medium tabular-nums">{fmtPct(stats.winRate)}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">最大回撤</span>
                      <span className="font-mono text-sm font-medium tabular-nums">{fmtPct(stats.maxDrawdownPct)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )
        })}
      </div>
    </div>
  )
}
