import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  sub,
  className,
  title,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  className?: string
  /** 悬停提示：值被截断/紧凑化时给完整内容 */
  title?: string
}) {
  return (
    <Card className={cn('gap-0 py-4', className)}>
      <CardContent className="flex min-w-0 flex-col gap-1 px-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className="truncate text-xl font-semibold tracking-tight tabular-nums"
          title={title ?? (typeof value === 'string' ? value : undefined)}
        >
          {value}
        </span>
        {sub != null && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  )
}
