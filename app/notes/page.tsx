import { Link, useSearchParams } from 'react-router-dom'
import { NotebookPen, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { NoteContent } from '@/components/note-content'
import { CreateNoteDialog } from '@/components/create-note-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useCairn } from '@/lib/store'
import { fmtUtcDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function NotesPage() {
  const [searchParams] = useSearchParams()
  const noteParam = searchParams.get('note') ?? undefined
  const { notes, deleteNote } = useCairn()
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
  const active = sorted.find((n) => n.id === noteParam) ?? sorted[0]

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader
        title="笔记"
        description="复盘笔记独立于交易存在，可在正文中 @提及 任意交易或图片"
        actions={<CreateNoteDialog />}
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
                to={`/notes?note=${note.id}`}
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
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg text-balance">{active.title}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除笔记 ${active.title}`}
                    onClick={() => {
                      if (window.confirm(`删除笔记「${active.title}」？`)) deleteNote(active.id)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
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
