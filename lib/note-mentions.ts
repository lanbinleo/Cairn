import type { NoteMention } from './types'

const mentionPattern = /\[\[(trade|image):([^\]]+)\]\]/g

export function parseNoteMentions(content: string): NoteMention[] {
  const mentions: NoteMention[] = []
  const seen = new Set<string>()

  for (const match of content.matchAll(mentionPattern)) {
    const type = match[1] as NoteMention['type']
    const ref = match[2]?.trim()
    if (!ref) continue
    const key = `${type}:${ref}`
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({ type, ref })
  }

  return mentions
}
