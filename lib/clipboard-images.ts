import type { ClipboardEvent } from 'react'

export function readPastedImage(event: ClipboardEvent): Promise<string | null> {
  const items = Array.from(event.clipboardData.items)
  const imageItem = items.find((item) => item.type.startsWith('image/'))
  const file = imageItem?.getAsFile()
  if (!file) return Promise.resolve(null)

  event.preventDefault()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function insertAtCursor(value: string, insert: string, start?: number | null, end?: number | null) {
  const from = start ?? value.length
  const to = end ?? from
  return `${value.slice(0, from)}${insert}${value.slice(to)}`
}
