import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-0 py-4', className)}>
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tracking-tight tabular-nums">{value}</span>
        {sub != null && <span className="text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  )
}
