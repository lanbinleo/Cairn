'use client'

import { useState } from 'react'
import { Check, Pencil, Plus } from 'lucide-react'

import { TAG_COLORS, tagColorClasses, tagColorNames, tagDotClasses } from '@/components/tag-badge'
import { Badge } from '@/components/ui/badge'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { insertAtCursor, readPastedImage } from '@/lib/clipboard-images'
import { useCairn } from '@/lib/store'
import type { TagColor, Trade } from '@/lib/types'
import { cn } from '@/lib/utils'

export function EditTradeDialog({ trade }: { trade: Trade }) {
  const { updateTrade, tagDefs, createTag } = useCairn()
  const [open, setOpen] = useState(false)

  /* 表单状态：打开时从 trade 初始化 */
  const [note, setNote] = useState(trade.note ?? '')
  const [sl, setSl] = useState(trade.initialStopLoss?.toString() ?? '')
  const [selectedTags, setSelectedTags] = useState<string[]>(trade.tags)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState<TagColor>('blue')

  function resetForm() {
    setNote(trade.note ?? '')
    setSl(trade.initialStopLoss?.toString() ?? '')
    setSelectedTags(trade.tags)
    setNewTagName('')
    setNewTagColor('blue')
  }

  function toggleTag(name: string) {
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  function handleCreateTag() {
    const def = createTag(newTagName, newTagColor)
    if (def) {
      setSelectedTags((prev) => [...prev, def.name])
      setNewTagName('')
    }
  }

  function handleSave() {
    const parsedSl = sl.trim() === '' ? undefined : Number(sl)
    updateTrade(trade.id, {
      note: note.trim() === '' ? undefined : note.trim(),
      initialStopLoss: parsedSl != null && Number.isFinite(parsedSl) ? parsedSl : undefined,
      tags: selectedTags,
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
      <DialogTrigger render={<Button variant="outline" />}>
        <Pencil data-icon="inline-start" />
        编辑
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑 Trade #{String(trade.seq).padStart(3, '0')}</DialogTitle>
          <DialogDescription>补录初始止损、整理标签与复盘备注</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-trade-sl">初始止损价</FieldLabel>
            <Input
              id="edit-trade-sl"
              type="number"
              inputMode="decimal"
              placeholder="未设置"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
            />
            <FieldDescription>R 倍数的计算基准；留空表示未设置（该笔不参与 R 统计）</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>标签</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {tagDefs.map((def) => {
                const active = selectedTags.includes(def.name)
                return (
                  <button key={def.id} type="button" onClick={() => toggleTag(def.name)} className="rounded-full">
                    <Badge
                      className={cn(
                        'cursor-pointer border font-normal transition-all',
                        active
                          ? cn('border-transparent', tagColorClasses[def.color])
                          : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {active && <Check className="size-3" aria-hidden="true" />}
                      {def.name}
                    </Badge>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="新建标签…"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    handleCreateTag()
                  }
                }}
                className="h-8 flex-1"
              />
              <div className="flex items-center gap-1" role="radiogroup" aria-label="标签颜色">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={newTagColor === c}
                    aria-label={tagColorNames[c]}
                    onClick={() => setNewTagColor(c)}
                    className={cn(
                      'size-5 rounded-full transition-transform',
                      tagDotClasses[c],
                      newTagColor === c ? 'scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background' : 'opacity-50 hover:opacity-90',
                    )}
                  />
                ))}
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-trade-note">复盘备注</FieldLabel>
            <Textarea
              id="edit-trade-note"
              rows={4}
              placeholder="这笔交易的执行、情绪与教训…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onPaste={(event) => {
                const start = event.currentTarget.selectionStart
                const end = event.currentTarget.selectionEnd
                void readPastedImage(event).then((dataUrl) => {
                  if (dataUrl) setNote((prev) => insertAtCursor(prev, `[[image:${dataUrl}]]`, start, end))
                })
              }}
            />
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
