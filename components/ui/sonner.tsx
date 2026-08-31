"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

/** 右上角 toast 容器：压到自定义标题栏（h-10）以下，避开 Windows 窗口控制按钮；
 *  造型与 Dialog 同语言（popover 底 + ring）。 */
function Toaster(props: React.ComponentProps<typeof Sonner>) {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      offset={16}
      style={{ top: 48, fontFamily: 'inherit' }}
      toastOptions={{
        classNames: {
          toast: 'rounded-xl bg-popover text-popover-foreground text-sm ring-1 ring-foreground/10',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
          actionButton: 'rounded-lg bg-primary text-primary-foreground text-xs',
          cancelButton: 'rounded-lg bg-muted text-muted-foreground text-xs',
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
