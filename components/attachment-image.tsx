'use client'

import { useEffect, useState } from 'react'

import { readAttachmentFile } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

function isDirectImageSrc(value: string) {
  return value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')
}

function looksLikeRelativeImagePath(value: string) {
  return value.includes('/') || value.includes('\\')
}

export function AttachmentImage({
  imageRef,
  alt,
  className,
}: {
  imageRef: string
  alt: string
  className?: string
}) {
  const { attachments } = useCairn()
  const [src, setSrc] = useState(() => (isDirectImageSrc(imageRef) ? imageRef : ''))

  useEffect(() => {
    let cancelled = false
    if (isDirectImageSrc(imageRef)) {
      setSrc(imageRef)
      return
    }
    const attachment = attachments.find((item) => item.id === imageRef)
    const relativePath = attachment?.relativePath ?? (looksLikeRelativeImagePath(imageRef) ? imageRef : '')
    if (!relativePath) {
      setSrc('')
      return
    }
    readAttachmentFile(relativePath)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc('')
      })
    return () => {
      cancelled = true
    }
  }, [attachments, imageRef])

  if (!src) {
    return (
      <div className={cn('flex items-center justify-center rounded border border-dashed text-xs text-muted-foreground', className)}>
        图片不可用
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} />
}
