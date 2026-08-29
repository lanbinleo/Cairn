'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 标题旁的 ⓘ：计算口径/规则说明挂这里，不常驻占位。用户第一次需要它，第一百次不需要。 */
export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="说明"
            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  )
}
