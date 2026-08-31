import type { TagColor, TagDef } from './types'

export const TAG_COLOR_ORDER: TagColor[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']

const tagColorRank = new Map<TagColor, number>(TAG_COLOR_ORDER.map((color, index) => [color, index]))

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function tagNameKey(name: string): string {
  return normalizeTagName(name).toLocaleLowerCase()
}

export function tagNamesEqual(a: string, b: string): boolean {
  return tagNameKey(a) === tagNameKey(b)
}

export function uniqueTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const name of names) {
    const normalized = normalizeTagName(name)
    if (!normalized) continue

    const key = tagNameKey(normalized)
    if (seen.has(key)) continue

    seen.add(key)
    tags.push(normalized)
  }

  return tags
}

/** 把一批标签名并进现有标签（忽略大小写去重、保序），返回下一份完整 tags 数组。
 * updateTrade 的 patch.tags 是整体替换——同一轮里逐条追加会被旧闭包互相覆盖
 * （只剩最后一条），必须一次算好整份数组再提交。 */
export function tagsWithAdditions(current: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(current.map(tagNameKey))
  const next = [...current]
  for (const name of additions) {
    const normalized = normalizeTagName(name)
    if (!normalized) continue
    const key = tagNameKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
  }
  return next
}

export function compareTagDefsByColor(a: TagDef, b: TagDef): number {
  const colorDiff = (tagColorRank.get(a.color) ?? TAG_COLOR_ORDER.length) - (tagColorRank.get(b.color) ?? TAG_COLOR_ORDER.length)
  if (colorDiff !== 0) return colorDiff
  const nameDiff = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  if (nameDiff !== 0) return nameDiff
  return a.createdAt - b.createdAt
}

export function sortTagDefsByColor(tagDefs: readonly TagDef[]): TagDef[] {
  return [...tagDefs].sort(compareTagDefsByColor)
}

export function sortTagNamesByColor(names: readonly string[], tagDefs: readonly TagDef[]): string[] {
  const defByKey = new Map(tagDefs.map((tag) => [tagNameKey(tag.name), tag]))
  return uniqueTagNames(names).sort((a, b) => {
    const defA = defByKey.get(tagNameKey(a))
    const defB = defByKey.get(tagNameKey(b))
    if (defA && defB) return compareTagDefsByColor(defA, defB)
    if (defA) return -1
    if (defB) return 1
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

export function findTagByName(tagDefs: readonly TagDef[], name: string, exceptId?: string): TagDef | undefined {
  const key = tagNameKey(name)
  if (!key) return undefined
  return tagDefs.find((tag) => tag.id !== exceptId && tagNameKey(tag.name) === key)
}

export function normalizeTradeTagNames(names: readonly string[], tagDefs: readonly TagDef[]): string[] {
  const displayNameByKey = new Map(tagDefs.map((tag) => [tagNameKey(tag.name), tag.name]))
  return uniqueTagNames(names.map((name) => displayNameByKey.get(tagNameKey(name)) ?? name))
}

export function normalizeTagDefs(tagDefs: readonly TagDef[]): {
  tagDefs: TagDef[]
  changed: TagDef[]
  removedIds: string[]
} {
  const seen = new Set<string>()
  const normalized: TagDef[] = []
  const changed: TagDef[] = []
  const removedIds: string[] = []

  for (const tag of tagDefs) {
    const name = normalizeTagName(tag.name)
    const key = tagNameKey(name)
    if (!key || seen.has(key)) {
      removedIds.push(tag.id)
      continue
    }

    seen.add(key)
    const next = name === tag.name ? tag : { ...tag, name }
    normalized.push(next)
    if (next !== tag) changed.push(next)
  }

  return { tagDefs: normalized, changed, removedIds }
}
