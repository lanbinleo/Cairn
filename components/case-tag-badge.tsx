'use client'

import { tagColorClasses } from '@/components/tag-badge'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

export function CaseTagBadge({ tagId, className }: { tagId: string; className?: string }) {
  const { caseTagDefs } = useCairn()
  const tag = caseTagDefs.find((item) => item.id === tagId)
  if (!tag) return null
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tagColorClasses[tag.color], className)}>
      {tag.name}
    </span>
  )
}
