'use client'

import { useState } from 'react'
import { Check, Plus, Tags, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { TAG_COLORS, tagColorNames, tagDotClasses } from '@/components/tag-badge'
import { useCairn } from '@/lib/store'
import type { TagColor, TagDef } from '@/lib/types'
import { cn } from '@/lib/utils'

/** 七色圆点选择器 */
function ColorPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: TagColor
  onChange: (c: TagColor) => void
  idPrefix: string
}) {
  return (
    <div role="radiogroup" aria-label="标签颜色" className="flex items-center gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={tagColorNames[c]}
          id={`${idPrefix}-${c}`}
          onClick={() => onChange(c)}
          className={cn(
            'flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110',
            tagDotClasses[c],
            value === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
        >
          {value === c && <Check className="size-3.5 text-white" aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}

/** 单个标签行：改色、重命名、删除、显示使用次数 */
function TagRow({ tag }: { tag: TagDef }) {
  const { trades, updateTag, deleteTag } = useCairn()
  const usage = trades.filter((t) => t.tags.includes(tag.name)).length

  return (
    <div className="flex items-center gap-3 py-2">
      <Input
        defaultValue={tag.name}
        aria-label={`标签名：${tag.name}`}
        className="h-8 max-w-40 font-medium"
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v && v !== tag.name) updateTag(tag.id, { name: v })
        }}
      />
      <ColorPicker value={tag.color} onChange={(c) => updateTag(tag.id, { color: c })} idPrefix={tag.id} />
      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {usage} 笔
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`删除标签 ${tag.name}`}
        className="text-muted-foreground hover:text-destructive"
        onClick={() => deleteTag(tag.id)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export function ManageTagsDialog() {
  const { tagDefs, createTag } = useCairn()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<TagColor>('blue')

  function handleCreate() {
    if (createTag(newName, newColor)) {
      setNewName('')
      setNewColor('blue')
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <Tags data-icon="inline-start" />
        管理标签
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>管理标签</DialogTitle>
          <DialogDescription>
            七种颜色供选择；重命名会同步更新所有引用该标签的交易，删除会将其从交易中移除。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col">
          <div className="flex items-center gap-3 py-2">
            <Input
              placeholder="新标签名"
              value={newName}
              aria-label="新标签名"
              className="h-8 max-w-40"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleCreate()
              }}
            />
            <ColorPicker value={newColor} onChange={setNewColor} idPrefix="new-tag" />
            <Button size="sm" className="ml-auto" disabled={!newName.trim()} onClick={handleCreate}>
              <Plus data-icon="inline-start" />
              添加
            </Button>
          </div>

          <Separator className="my-1" />

          {tagDefs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有标签，先创建一个吧</p>
          ) : (
            <div className="flex flex-col divide-y">
              {tagDefs.map((tag) => (
                <TagRow key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
