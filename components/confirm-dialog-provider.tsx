"use client"

import * as React from "react"

import { AlertDialog } from '@/components/ui/alert-dialog'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 破坏性动作：确认键渲染为红色 */
  destructive?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<Confirm | null>(null)

/** 全局确认弹窗：`const confirm = useConfirm()`，`if (await confirm({...})) ...`。
 *  取消路径（含 Esc / 点外部）一律 resolve false。单槽：已打开时来了新调用，旧的
 *  按取消结算后被顶掉。 */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const resolveRef = React.useRef<((ok: boolean) => void) | null>(null)

  const confirm = React.useCallback<Confirm>((next) => {
    resolveRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOptions(next)
    })
  }, [])

  const settle = React.useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setOptions(null)
  }, [])

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) settle(false)
    },
    [settle]
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={options !== null}
        onOpenChange={handleOpenChange}
        title={options?.title ?? ''}
        description={options?.description}
        confirmText={options?.confirmText}
        cancelText={options?.cancelText}
        destructive={options?.destructive}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const confirm = React.useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm 必须在 ConfirmDialogProvider 内使用')
  return confirm
}
