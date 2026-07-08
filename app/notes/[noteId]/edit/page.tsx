'use client'

import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Save } from 'lucide-react'

import { NoteContent } from '@/components/note-content'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MentionTextarea } from '@/components/mention-textarea'
import { useCairn } from '@/lib/store'
import { uniqueTagNames } from '@/lib/tags'

export default function NoteEditPage() {
  const navigate = useNavigate()
  const { noteId = '' } = useParams()
  const { notes, updateNote } = useCairn()
  const note = notes.find((item) => item.id === noteId)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (!note) return
    setTitle(note.title)
    setTags(note.tags.join(', '))
    setContent(note.content)
  }, [note])

  if (!note) return <Navigate to="/notes" replace />

  const activeNote = note

  function handleSave() {
    updateNote(activeNote.id, {
      title: title.trim() || activeNote.title,
      tags: uniqueTagNames(tags.split(',')),
      content,
    })
    navigate(`/notes?note=${activeNote.id}`)
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="面包屑">
            <Link to="/notes" className="transition-colors hover:text-foreground">
              笔记
            </Link>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="text-foreground">编辑</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">编辑笔记</h1>
        </div>
        <Button onClick={handleSave}>
          <Save data-icon="inline-start" />
          保存
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Markdown</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-note-title">标题</FieldLabel>
                <Input id="edit-note-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-note-tags">标签</FieldLabel>
                <Input id="edit-note-tags" value={tags} onChange={(event) => setTags(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-note-content">正文</FieldLabel>
                <MentionTextarea
                  id="edit-note-content"
                  rows={18}
                  value={content}
                  onChange={setContent}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">预览</CardTitle>
          </CardHeader>
          <CardContent>
            <NoteContent content={content} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
