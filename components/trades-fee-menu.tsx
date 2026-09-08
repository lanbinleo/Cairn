'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/sonner'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * 交易列表标题行的「手续费」折叠开关（0.3.8）：跨账户页面按账户列出
 * 「临时关闭手续费」，语义与账户详情页底部折叠区一致（费率配置保留，
 * 统计在毛/净口径间切换）。没有费率、没有导入手续费、也没处于关闭态的
 * 账户不参与；全都不参与时整个入口不渲染。
 */
export function TradesFeeMenu() {
  const { accounts, trades, updateAccount } = useCairn()
  const [open, setOpen] = useState(false)

  const rows = useMemo(
    () =>
      accounts.map((account) => {
        const hasRates = account.takerFeePct != null || account.makerFeePct != null
        const hasImportedFees = trades.some(
          (t) => t.accountId === account.id && t.executions.some((e) => e.feeOverride != null),
        )
        return { account, hasRates, hasImportedFees, relevant: hasRates || hasImportedFees || !!account.feesDisabled }
      }),
    [accounts, trades],
  )

  const relevant = rows.filter((row) => row.relevant)
  const disabledCount = relevant.filter((row) => row.account.feesDisabled).length
  if (relevant.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            aria-expanded={open}
          />
        }
      >
        手续费
        {disabledCount > 0 && (
          <Badge variant="secondary" className="px-1.5 text-[10px] leading-none">
            已临时关闭 {disabledCount}
          </Badge>
        )}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex flex-col gap-1.5">
          <p className="px-1 text-xs text-muted-foreground">
            关闭后按费率推算的部分回到毛口径（PnL / 胜率 / R / 权益曲线）；导入文件自带的每行真实手续费仍保留
          </p>
          {relevant.map(({ account, hasRates, hasImportedFees }) => (
            <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{account.name}</span>
                <span className="text-xs text-muted-foreground">
                  {hasRates
                    ? `Taker ${account.takerFeePct ?? 0}% / Maker ${account.makerFeePct ?? 0}%`
                    : '费率未配置 · 有导入的真实手续费'}
                </span>
              </div>
              <Switch
                aria-label={`临时关闭手续费：${account.name}`}
                checked={account.feesDisabled ?? false}
                disabled={!account.takerFeePct && !account.makerFeePct && !hasImportedFees}
                onCheckedChange={(checked) => {
                  updateAccount(account.id, { feesDisabled: checked || undefined })
                  toast.success(
                    checked
                      ? hasRates
                        ? '已临时关闭费率推算，统计回到毛口径'
                        : '已临时关闭费率推算（未配置费率，数字不变）'
                      : hasRates
                        ? '已恢复手续费，统计回到净额'
                        : '已重新允许费率推算（未配置费率，数字不变）',
                  )
                }}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
