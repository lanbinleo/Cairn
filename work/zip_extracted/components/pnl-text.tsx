import { cn } from '@/lib/utils'
import { fmtSignedMoney, fmtR } from '@/lib/format'

export function PnlText({
  value,
  currency = 'USD',
  className,
}: {
  value: number
  currency?: string
  className?: string
}) {
  const tone = value > 0.005 ? 'text-profit' : value < -0.005 ? 'text-loss' : 'text-muted-foreground'
  return (
    <span className={cn('font-mono tabular-nums', tone, className)}>{fmtSignedMoney(value, currency)}</span>
  )
}

export function RText({ value, className }: { value: number | null; className?: string }) {
  const tone =
    value == null ? 'text-muted-foreground' : value > 0.005 ? 'text-profit' : value < -0.005 ? 'text-loss' : 'text-muted-foreground'
  return <span className={cn('font-mono tabular-nums', tone, className)}>{fmtR(value)}</span>
}
