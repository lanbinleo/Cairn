'use client'

import { useRef, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCairn } from '@/lib/store'
import { emptyState, type CairnStateSnapshot } from '@/lib/seed'

function isSnapshot(value: unknown): value is CairnStateSnapshot {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return ['accounts', 'periods', 'trades', 'symbols', 'notes', 'tagDefs'].every((key) => Array.isArray(obj[key]))
}

export function BackupCard() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { exportBackup, restoreState } = useCairn()
  const [message, setMessage] = useState('')

  async function handleExport() {
    const path = await exportBackup()
    setMessage(path ? `已导出到 ${path}` : '当前环境不支持直接导出，请在 Tauri App 内使用。')
  }

  async function handleRestore(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    const parsed = JSON.parse(text) as unknown
    const state = isSnapshot(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && isSnapshot((parsed as { state?: unknown }).state)
        ? (parsed as { state: CairnStateSnapshot }).state
        : null
    if (!state) {
      setMessage('备份文件格式不正确。')
      return
    }
    await restoreState(state)
    setMessage(`已从 ${file.name} 恢复。`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">备份</CardTitle>
        <CardDescription>导出或恢复本地 Cairn 数据</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleExport}>
            <Download data-icon="inline-start" />
            导出备份
          </Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            恢复备份
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (window.confirm('清空 Cairn 的所有本地数据？')) {
                void restoreState(emptyState).then(() => setMessage('已清空所有本地数据。'))
              }
            }}
          >
            <Trash2 data-icon="inline-start" />
            清空数据
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json,.cairn-backup"
            className="hidden"
            onChange={(event) => {
              void handleRestore(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
        {message && <p className="text-xs text-muted-foreground break-all">{message}</p>}
      </CardContent>
    </Card>
  )
}
