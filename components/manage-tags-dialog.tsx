'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { findTagByName, normalizeTagName, tagNamesEqual } from '@/lib/tags'
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
  const { trades, tagDefs, updateTag, deleteTag } = useCairn()
  const [name, setName] = useState(tag.name)
  const normalizedName = normalizeTagName(name)
  const duplicate = Boolean(normalizedName && findTagByName(tagDefs, normalizedName, tag.id))
  const usage = trades.filter((t) => t.tags.some((name) => tagNamesEqual(name, tag.name))).length

  useEffect(() => {
    setName(tag.name)
  }, [tag.name])

  function commitName() {
    if (!normalizedName || duplicate) {
      setName(tag.name)
      return
    }
    if (!tagNamesEqual(normalizedName, tag.name)) updateTag(tag.id, { name: normalizedName })
  }

  function handleDelete() {
    const message = usage > 0
      ? `删除标签「${tag.name}」？它会从 ${usage} 笔交易中移除。`
      : `删除标签「${tag.name}」？`
    if (window.confirm(message)) deleteTag(tag.id)
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <Input
        value={name}
        aria-label={`标签名：${tag.name}`}
        aria-invalid={duplicate}
        className={cn('h-8 max-w-40 font-medium', duplicate && 'border-destructive')}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault()
            commitName()
          }
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
        onClick={handleDelete}
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
  const [colorFilter, setColorFilter] = useState<TagColor | 'all'>('all')
  const normalizedNewName = normalizeTagName(newName)
  const duplicateNewName = Boolean(normalizedNewName && findTagByName(tagDefs, normalizedNewName))
  const sortedTagDefs = useMemo(
    () => [...tagDefs].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.createdAt - b.createdAt),
    [tagDefs],
  )
  const visibleTagDefs = useMemo(
    () => (colorFilter === 'all' ? sortedTagDefs : sortedTagDefs.filter((tag) => tag.color === colorFilter)),
    [colorFilter, sortedTagDefs],
  )

  function handleCreate() {
    if (!normalizedNewName || duplicateNewName) return
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
              aria-invalid={duplicateNewName}
              className={cn('h-8 max-w-40', duplicateNewName && 'border-destructive')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
            <ColorPicker value={newColor} onChange={setNewColor} idPrefix="new-tag" />
            <Button size="sm" className="ml-auto" disabled={!normalizedNewName || duplicateNewName} onClick={handleCreate}>
              <Plus data-icon="inline-start" />
              添加
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 py-2" role="group" aria-label="按颜色筛选标签">
            <button
              type="button"
              aria-pressed={colorFilter === 'all'}
              onClick={() => setColorFilter('all')}
              className={cn(
                'inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium transition-colors',
                colorFilter === 'all' ? 'bg-primary/12 text-primary ring-1 ring-primary/30' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              全部
            </button>
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={colorFilter === color}
                aria-label={`筛选${tagColorNames[color]}色标签`}
                onClick={() => setColorFilter(color)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
                  colorFilter === color ? 'bg-primary/12 text-primary ring-1 ring-primary/30' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn('size-2 rounded-full', tagDotClasses[color])} aria-hidden="true" />
                {tagColorNames[color]}
              </button>
            ))}
          </div>

          <Separator className="my-1" />

          {tagDefs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有标签，先创建一个吧</p>
          ) : visibleTagDefs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">这个颜色下还没有标签</p>
          ) : (
            <div className="flex flex-col divide-y">
              {visibleTagDefs.map((tag) => (
                <TagRow key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
