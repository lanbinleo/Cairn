'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Tags, Trash2 } from 'lucide-react'

import { useConfirm } from '@/components/confirm-dialog-provider'
import { TAG_COLORS, tagColorNames, tagDotClasses } from '@/components/tag-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { useCairn } from '@/lib/store'
import { findTagByName, normalizeTagName, tagNamesEqual } from '@/lib/tags'
import type { CaseTagDef, TagColor } from '@/lib/types'
import { cn } from '@/lib/utils'

function ColorPicker({ value, onChange, prefix }: { value: TagColor; onChange: (color: TagColor) => void; prefix: string }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Case 标签颜色">
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={tagColorNames[color]}
          id={`${prefix}-${color}`}
          onClick={() => onChange(color)}
          className={cn('flex size-6 items-center justify-center rounded-full', tagDotClasses[color], value === color && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
        >
          {value === color && <Check className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}

function CaseTagRow({ tag }: { tag: CaseTagDef }) {
  const { cases, caseTagDefs, updateCaseTag, deleteCaseTag } = useCairn()
  const confirm = useConfirm()
  const [name, setName] = useState(tag.name)
  const normalizedName = normalizeTagName(name)
  const duplicate = Boolean(normalizedName && findTagByName(caseTagDefs, normalizedName, tag.id))
  const usage = cases.filter((caseRecord) => caseRecord.tagIds.includes(tag.id)).length

  useEffect(() => setName(tag.name), [tag.name])

  function commitName() {
    if (!normalizedName || duplicate) {
      setName(tag.name)
      return
    }
    if (!tagNamesEqual(normalizedName, tag.name)) updateCaseTag(tag.id, { name: normalizedName })
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <Input
        value={name}
        aria-invalid={duplicate}
        className={cn('h-8 max-w-40 font-medium', duplicate && 'border-destructive')}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            commitName()
          }
        }}
      />
      <ColorPicker value={tag.color} onChange={(color) => updateCaseTag(tag.id, { color })} prefix={tag.id} />
      <span className="ml-auto font-mono text-xs text-muted-foreground">{usage} 个</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`删除 Case 标签 ${tag.name}`}
        onClick={() => {
          void confirm({
            title: `删除 Case 标签「${tag.name}」？`,
            description: `它会从 ${usage} 个 Case 中移除。`,
            confirmText: '删除',
            destructive: true,
          }).then((ok) => {
            if (ok) {
              deleteCaseTag(tag.id)
              toast.success('已删除 Case 标签')
            }
          })
        }}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export function ManageCaseTagsDialog() {
  const { caseTagDefs, createCaseTag } = useCairn()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<TagColor>('blue')
  const normalizedName = normalizeTagName(newName)
  const duplicate = Boolean(normalizedName && findTagByName(caseTagDefs, normalizedName))
  const sorted = useMemo(() => [...caseTagDefs].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')), [caseTagDefs])

  function handleCreate() {
    if (!normalizedName || duplicate) return
    if (createCaseTag(newName, newColor)) {
      setNewName('')
      setNewColor('blue')
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <Tags data-icon="inline-start" />
        管理 Case 标签
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>管理 Case 标签</DialogTitle>
          <DialogDescription>Case 标签与 Trade 标签相互独立，用于结构、情绪和决策类型等分类。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 py-2">
          <Input
            value={newName}
            aria-invalid={duplicate}
            placeholder="新标签名"
            className={cn('h-8 max-w-40', duplicate && 'border-destructive')}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                handleCreate()
              }
            }}
          />
          <ColorPicker value={newColor} onChange={setNewColor} prefix="new-case-tag" />
          <Button size="sm" className="ml-auto" disabled={!normalizedName || duplicate} onClick={handleCreate}>
            <Plus data-icon="inline-start" />添加
          </Button>
        </div>
        <Separator />
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">还没有 Case 标签</p>
        ) : (
          <div className="divide-y">{sorted.map((tag) => <CaseTagRow key={tag.id} tag={tag} />)}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
