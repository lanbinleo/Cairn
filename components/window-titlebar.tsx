'use client'

import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function currentWindow() {
  return isTauriRuntime() ? getCurrentWindow() : null
}

function isWindowsPlatform() {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
}

export function shouldShowWindowTitlebar() {
  return isWindowsPlatform()
}

export function WindowTitlebar() {
  if (!shouldShowWindowTitlebar()) return null

  async function startDragging() {
    await currentWindow()?.startDragging()
  }

  async function minimize() {
    await currentWindow()?.minimize()
  }

  async function toggleMaximize() {
    await currentWindow()?.toggleMaximize()
  }

  async function hideToTray() {
    await currentWindow()?.hide()
  }

  return (
    <div className="fixed left-56 right-0 top-0 z-50 flex h-10 select-none items-center border-b border-border bg-background/95 backdrop-blur">
      <div
        data-tauri-drag-region
        className="h-full min-w-0 flex-1"
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail === 1) void startDragging()
        }}
        onDoubleClick={() => void toggleMaximize()}
      />
      <div className="flex h-full items-center">
        {[
          { label: '最小化', icon: Minus, action: minimize },
          { label: '最大化', icon: Square, action: toggleMaximize },
          { label: '关闭到托盘', icon: X, action: hideToTray, danger: true },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Button
              key={item.label}
              variant="ghost"
              size="icon-sm"
              aria-label={item.label}
              title={item.label}
              className={cn(
                'h-10 w-11 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground',
                item.danger && 'hover:bg-loss hover:text-loss-foreground',
              )}
              onClick={() => void item.action()}
            >
              <Icon className="size-4" />
            </Button>
          )
        })}
      </div>
    </div>
  )
}
