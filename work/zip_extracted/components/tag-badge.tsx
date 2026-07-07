'use client'

import { Badge } from '@/components/ui/badge'
import { useCairn } from '@/lib/store'
import type { TagColor } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 七色标签样式（浅色底 + 同色系文字，深浅主题自适应） */
export const tagColorClasses: Record<TagColor, string> = {
  red: 'bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300',
  orange: 'bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  yellow: 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  green: 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  cyan: 'bg-cyan-500/12 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  blue: 'bg-blue-500/12 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  purple: 'bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
}

/** 色点（用于颜色选择器和列表） */
export const tagDotClasses: Record<TagColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-amber-500',
  green: 'bg-emerald-500',
  cyan: 'bg-cyan-500',
  blue: 'bg-blue-500',
  purple: 'bg-violet-500',
}

export const tagColorNames: Record<TagColor, string> = {
  red: '红',
  orange: '橙',
  yellow: '黄',
  green: '绿',
  cyan: '青',
  blue: '蓝',
  purple: '紫',
}

export const TAG_COLORS: TagColor[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']

/** 按标签名渲染彩色徽章；未注册的标签名回退为 outline 样式 */
export function TagBadge({ name, className }: { name: string; className?: string }) {
  const { getTagDef } = useCairn()
  const def = getTagDef(name)
  if (!def) {
    return (
      <Badge variant="outline" className={className}>
        {name}
      </Badge>
    )
  }
  return <Badge className={cn('border-transparent font-normal', tagColorClasses[def.color], className)}>{name}</Badge>
}
