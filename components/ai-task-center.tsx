'use client'

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Loader2, Sparkles } from 'lucide-react'

import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCairn } from '@/lib/store'
import type { AiTask } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * 侧边栏底部的 AI 任务中心：哪些 AI 正在进行、哪些成功/失败一目了然。
 * 「需重试」不算完成——只有内建重试后的最终结果才落到 succeeded/failed。
 * 徽标 = 未读的已完成数，点开弹层即清零。
 */
export function AiTaskCenter() {
  const { aiTaskList, markAiTasksRead, caseCards } = useCairn()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string>()
  const running = aiTaskList.filter((task) => task.status === 'running')
  const finished = aiTaskList.filter((task) => task.status !== 'running')
  const unreadCount = aiTaskList.filter((task) => task.unread).length
  const hasFailed = finished.some((task) => task.status === 'failed')

  function jump(task: AiTask) {
    setOpen(false)
    if (task.targetType === 'trade' && task.targetId) {
      navigate(`/trades/${task.targetId}`)
      return
    }
    if (task.targetId) {
      // card → 所属 Case 页；case → Case 页
      const caseId = task.targetType === 'card'
        ? caseCards.find((card) => card.id === task.targetId)?.caseId
        : task.targetId
      if (caseId) navigate(`/cases/${caseId}`)
    }
  }

  // 聚合状态优先级：进行中 > 有失败 > 有未读完成 > 空闲
  const icon = running.length > 0
    ? <Loader2 className="size-4 animate-spin text-primary" />
    : hasFailed
      ? <CircleAlert className="size-4 text-destructive" />
      : unreadCount > 0
        ? <CheckCircle2 className="size-4 text-muted-foreground" />
        : <Sparkles className="size-4 text-muted-foreground/40" />

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) markAiTasksRead()
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground" aria-label="AI 任务" />
        }
      >
        {icon}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-medium leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" alignOffset={32} sideOffset={6} className="w-72 p-0">
        <Tabs defaultValue="running">
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
            <TabsList className="h-8">
              <TabsTrigger value="running" className="px-3">进行中{running.length > 0 ? ` · ${running.length}` : ''}</TabsTrigger>
              <TabsTrigger value="finished" className="px-3">已完成</TabsTrigger>
            </TabsList>
            {hasFailed && <span className="pr-1 text-xs text-destructive">有失败</span>}
          </div>
          <TabsContent value="running" className="max-h-80 overflow-y-auto px-1.5 pb-2">
            {running.length === 0
              ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">没有进行中的 AI 任务</p>
              : running.map((task) => (
                <TaskRow key={task.id} task={task} onJump={jump} />
              ))}
          </TabsContent>
          <TabsContent value="finished" className="max-h-80 overflow-y-auto px-1.5 pb-2">
            {finished.length === 0
              ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">暂无已完成记录</p>
              : finished.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onJump={jump}
                  expandable={task.status === 'failed'}
                  expanded={expandedId === task.id}
                  onToggleExpand={() => setExpandedId((prev) => (prev === task.id ? undefined : task.id))}
                />
              ))}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

function TaskRow({
  task,
  onJump,
  expandable,
  expanded,
  onToggleExpand,
}: {
  task: AiTask
  onJump: (task: AiTask) => void
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  return (
    <div className="rounded-lg transition-colors hover:bg-muted/60">
      <div className="flex items-center gap-2 px-2 py-1.5">
        {task.status === 'running'
          ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          : task.status === 'succeeded'
            ? <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
            : <CircleAlert className="size-4 shrink-0 text-destructive" />}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onJump(task)}>
          <span className="block truncate text-sm">{task.label}</span>
          <span className="block text-xs text-muted-foreground">
            <RelativeTime ms={task.endedAt ?? task.startedAt} />
          </span>
        </button>
        {expandable && (
          <button
            type="button"
            aria-label="查看失败原因"
            className={cn('shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground')}
            onClick={onToggleExpand}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        )}
      </div>
      {task.status === 'running' && task.kind === 'summary' && (task.phase != null || (task.outputChars ?? 0) > 0) && (
        <p className="px-2 pb-1.5 text-[11px] leading-4 text-muted-foreground">
          {task.phase === 'thinking'
            ? `思考中 · ${((task.thinkingMs ?? 0) / 1000).toFixed(1)}s`
            : `${(task.thinkingMs ?? 0) > 0 ? `思考 ${((task.thinkingMs ?? 0) / 1000).toFixed(1)}s · ` : ''}已输出 ${task.outputTokens != null ? `${task.outputTokens} tokens` : `${task.outputChars ?? 0} 字`}`}
        </p>
      )}
      {task.status === 'running' && task.streamText && (
        <p className="line-clamp-2 break-all px-2 pb-1.5 font-mono text-[11px] leading-4 text-muted-foreground/70">
          {task.streamText}
        </p>
      )}
      {expandable && expanded && task.error && (
        <p className="mx-2 mb-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs leading-relaxed break-all text-destructive">
          {task.error}
        </p>
      )}
    </div>
  )
}
