'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCairn } from '@/lib/store'

export function CreateNoteDialog() {
  const { createNote } = useCairn()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')

  function resetForm() {
    setTitle('')
    setContent('')
    setTags('')
  }

  function handleSave() {
    createNote({
      title: title.trim() || '新建笔记',
      content: content.trim() || '### 新建笔记',
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      mentions: [],
    })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) resetForm()
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus data-icon="inline-start" />
        新建笔记
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建笔记</DialogTitle>
          <DialogDescription>笔记可在正文中使用 [[trade:ID]] 或 [[image:URL]]</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-note-title">标题</FieldLabel>
            <Input id="new-note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-note-tags">标签</FieldLabel>
            <Input id="new-note-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用英文逗号分隔" />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-note-content">正文</FieldLabel>
            <Textarea id="new-note-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
