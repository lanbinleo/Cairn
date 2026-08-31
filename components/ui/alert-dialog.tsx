"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface AlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 破坏性动作：确认键渲染为红色 */
  destructive?: boolean
  onConfirm?: () => void
  className?: string
}

/** 确认弹窗：与普通 Dialog 的差别——点外部 / Esc 等同于取消，初始焦点落在取消键
 *  （安全默认），层级高于普通 Dialog（z-[60]），可以叠在已打开的编辑弹窗上。 */
function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  destructive = false,
  onConfirm,
  className,
}: AlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 isolate z-[60] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          data-slot="alert-dialog-popup"
          initialFocus={cancelRef}
          className={cn(
            "fixed top-1/2 left-1/2 z-[60] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
        >
          <div className="flex flex-col gap-2 p-4 pb-3">
            <DialogPrimitive.Title className="text-base leading-snug font-medium">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" ref={cancelRef} onClick={() => onOpenChange(false)}>
              {cancelText}
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              onClick={() => {
                onConfirm?.()
                onOpenChange(false)
              }}
            >
              {confirmText}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export { AlertDialog }
