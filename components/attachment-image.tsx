'use client'

import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { readAttachmentFile } from '@/lib/local-db'
import { useCairn } from '@/lib/store'
import { cn } from '@/lib/utils'

function isDirectImageSrc(value: string) {
  return value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')
}

function looksLikeRelativeImagePath(value: string) {
  return value.includes('/') || value.includes('\\')
}

function imagePoint(event: MouseEvent<HTMLImageElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  }
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
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [zoom, setZoom] = useState({ active: false, x: 50, y: 50 })

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

  useEffect(() => {
    setZoom({ active: false, x: 50, y: 50 })
  }, [src])

  if (!src) {
    return (
      <div className={cn('flex items-center justify-center rounded border border-dashed text-xs text-muted-foreground', className)}>
        图片不可用
      </div>
    )
  }

  const zoomStyle: CSSProperties = zoom.active
    ? {
        transform: 'scale(2.4)',
        transformOrigin: `${zoom.x}% ${zoom.y}%`,
      }
    : {}
  const maskStyle = {
    '--zoom-x': `${zoom.x}%`,
    '--zoom-y': `${zoom.y}%`,
  } as CSSProperties

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={cn(className, 'cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background')}
        role="button"
        tabIndex={0}
        onClick={() => setLightboxOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setLightboxOpen(true)
          }
        }}
      />
      <Dialog
        open={lightboxOpen}
        onOpenChange={(open) => {
          setLightboxOpen(open)
          if (!open) setZoom({ active: false, x: 50, y: 50 })
        }}
      >
        <DialogContent showCloseButton={false} className="h-[calc(100vh-2rem)] !max-w-[calc(100vw-2rem)] gap-0 overflow-hidden bg-black p-3 text-white ring-white/15 sm:!max-w-[calc(100vw-3rem)]">
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4 z-20 bg-black/50 text-white hover:bg-white/15 hover:text-white"
                aria-label="关闭灯箱"
              />
            }
          >
            <XIcon />
          </DialogClose>
          <div className="relative flex size-full items-center justify-center overflow-hidden rounded-lg bg-black">
            <img
              src={src}
              alt={alt}
              className={cn(
                'max-h-full max-w-full select-none object-contain transition-transform duration-200',
                zoom.active ? 'cursor-zoom-out' : 'cursor-zoom-in',
              )}
              draggable={false}
              style={zoomStyle}
              onClick={(event) => {
                event.stopPropagation()
                if (zoom.active) {
                  setZoom({ active: false, x: 50, y: 50 })
                  return
                }
                setZoom({ active: true, ...imagePoint(event) })
              }}
            />
            {zoom.active && (
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_var(--zoom-x)_var(--zoom-y),transparent_0_18%,rgba(0,0,0,0.22)_28%,rgba(0,0,0,0.58)_100%)]"
                style={maskStyle}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
