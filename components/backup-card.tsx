'use client'

import { useRef } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'

import { useConfirm } from '@/components/confirm-dialog-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/sonner'
import { useCairn } from '@/lib/store'
import { emptyState, type CairnStateSnapshot } from '@/lib/seed'

function isSnapshot(value: unknown): value is CairnStateSnapshot {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return ['accounts', 'periods', 'trades', 'symbols', 'notes', 'tagDefs', 'importBatches', 'attachments'].every((key) => Array.isArray(obj[key]))
}

function withCaseCollections(snapshot: CairnStateSnapshot): CairnStateSnapshot {
  return {
    ...snapshot,
    cases: snapshot.cases ?? [],
    caseCards: snapshot.caseCards ?? [],
    caseBindings: snapshot.caseBindings ?? [],
    caseTagDefs: snapshot.caseTagDefs ?? [],
    chartImports: snapshot.chartImports ?? [],
    chartCandles: snapshot.chartCandles ?? [],
  }
}

export function BackupCard() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { exportBackup, restoreState } = useCairn()
  const confirm = useConfirm()

  async function handleExport() {
    try {
      const path = await exportBackup()
      if (path) toast.success('备份已导出', { description: path })
      else toast.warning('当前环境不支持直接导出，请在 Tauri App 内使用。')
    } catch (error) {
      toast.error(`导出失败：${String(error)}`)
    }
  }

  async function handleRestore(file: File | undefined) {
    if (!file) return
    let state: CairnStateSnapshot | null = null
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      state = isSnapshot(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && isSnapshot((parsed as { state?: unknown }).state)
          ? (parsed as { state: CairnStateSnapshot }).state
          : null
    } catch {
      state = null
    }
    if (!state) {
      toast.error('备份文件格式不正确，未做任何改动。')
      return
    }
    try {
      await restoreState(withCaseCollections(state))
      toast.success(`已从 ${file.name} 恢复。`)
    } catch (error) {
      toast.error(`恢复失败：${String(error)}`)
    }
  }

  function handleClear() {
    void confirm({
      title: '清空 Cairn 的所有本地数据？',
      description: '清空后只能靠备份文件恢复，请先导出一份。',
      confirmText: '清空',
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      void restoreState(emptyState)
        .then(() => toast.success('已清空所有本地数据。'))
        .catch((error) => toast.error(`清空失败：${String(error)}`))
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">备份</CardTitle>
        <CardDescription>导出或恢复本地 Cairn 数据</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleExport()}>
            <Download data-icon="inline-start" />
            导出备份
          </Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            恢复备份
          </Button>
          <Button variant="destructive" onClick={handleClear}>
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
      </CardContent>
    </Card>
  )
}
