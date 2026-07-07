'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EquityChart } from '@/components/equity-chart'
import { useCairn } from '@/lib/store'
import { computeEquityCurve, computeMaxDrawdown } from '@/lib/metrics'
import { fmtMoney, fmtPct } from '@/lib/format'

export function EquitySection() {
  const { accounts, trades } = useCairn()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>资金曲线</CardTitle>
          <CardDescription>创建账户后，这里会显示资金曲线和回撤。</CardDescription>
        </CardHeader>
        <CardContent>
          <EquityChart points={[]} />
        </CardContent>
      </Card>
    )
  }

  const { curve, dd, account } = useMemo(() => {
    const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
    const curve = computeEquityCurve(
      trades.filter((t) => t.accountId === account.id),
      account.initialBalance,
    )
    const dd = computeMaxDrawdown(curve)
    return { curve, dd, account }
  }, [accountId, accounts, trades])

  const latest = curve.length > 0 ? curve[curve.length - 1].equity : account.initialBalance

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>资金曲线</CardTitle>
          <CardDescription>
            当前权益{' '}
            <span className="font-mono font-medium text-foreground">{fmtMoney(latest, account.currency)}</span>
            <span className="mx-2 text-border">|</span>
            最大回撤{' '}
            <span className="font-mono font-medium text-loss">
              {fmtMoney(dd.maxDrawdown, account.currency)}（{fmtPct(dd.maxDrawdownPct)}）
            </span>
          </CardDescription>
        </div>
        <Tabs value={accountId} onValueChange={setAccountId}>
          <TabsList>
            {accounts.map((a) => (
              <TabsTrigger key={a.id} value={a.id}>
                {a.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <EquityChart points={curve} />
      </CardContent>
    </Card>
  )
}
