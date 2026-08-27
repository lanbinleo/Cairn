'use client'

import { useEffect, useState } from 'react'

import { fmtRelativeTime, fmtUtcDateTime } from '@/lib/format'

/**
 * 可读相对时间（数秒前 / N 分钟前 / 昨天 / MM-DD…）。
 * 悬停显示完整 UTC 时间；24 小时内每 30 秒自动刷新，更早的只随页面重渲染更新。
 */
export function RelativeTime({ ms, className }: { ms: number; className?: string }) {
  const [text, setText] = useState(() => fmtRelativeTime(ms))

  useEffect(() => {
    setText(fmtRelativeTime(ms))
    if (Date.now() - ms >= 86_400_000) return
    const timer = window.setInterval(() => {
      setText(fmtRelativeTime(ms))
      if (Date.now() - ms >= 86_400_000) window.clearInterval(timer)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [ms])

  return (
    <time dateTime={new Date(ms).toISOString()} title={fmtUtcDateTime(ms)} className={className}>
      {text}
    </time>
  )
}
