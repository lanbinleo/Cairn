import Link from 'next/link'
import { Plus, NotebookPen } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { NoteContent } from '@/components/note-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { notes } from '@/lib/mock-data'
import { fmtUtcDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>
}) {
  const { note: noteParam } = await searchParams
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
  const active = sorted.find((n) => n.id === noteParam) ?? sorted[0]

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="笔记"
        description="复盘笔记独立于交易存在，可在正文中 @提及 任意交易或图片"
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            新建笔记
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>还没有笔记</EmptyTitle>
            <EmptyDescription>写下第一篇复盘笔记，沉淀你的交易经验。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 笔记列表 */}
          <div className="flex flex-col gap-2">
            {sorted.map((note) => (
              <Link
                key={note.id}
                href={`/notes?note=${note.id}`}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border p-4 transition-colors',
                  note.id === active?.id
                    ? 'border-ring/50 bg-card'
                    : 'hover:border-ring/30 hover:bg-muted/40',
                )}
                aria-current={note.id === active?.id ? 'page' : undefined}
              >
                <span className="text-sm font-medium text-balance">{note.title}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {note.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {fmtUtcDate(note.updatedAt)} · 提及 {note.mentions.filter((m) => m.type === 'trade').length} 笔交易
                </span>
              </Link>
            ))}
          </div>

          {/* 笔记正文 */}
          {active && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg text-balance">{active.title}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  创建于 {fmtUtcDate(active.createdAt)} · 更新于 {fmtUtcDate(active.updatedAt)}
                </p>
              </CardHeader>
              <CardContent>
                <NoteContent content={active.content} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
