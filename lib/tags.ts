import type { TagDef } from './types'

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
