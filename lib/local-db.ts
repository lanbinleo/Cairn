import { invoke } from '@tauri-apps/api/core'

import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'

type CollectionName = 'accounts' | 'periods' | 'trades' | 'symbols' | 'notes' | 'tagDefs' | 'importBatches' | 'attachments' | 'chartImports' | 'chartCandles'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function loadLocalState(): Promise<CairnStateSnapshot> {
  if (!isTauriRuntime()) return seedState
  return invoke<CairnStateSnapshot>('load_state', { seed: seedState })
}

export async function saveLocalRecord<T extends { id: string }>(
  collection: CollectionName,
  record: T,
): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('save_record', {
    collection,
    id: record.id,
    data: record,
  })
}

export async function deleteLocalRecord(collection: CollectionName, id: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('delete_record', { collection, id })
}

export async function replaceLocalCollection<T extends { id: string }>(
  collection: CollectionName,
  records: T[],
): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('replace_collection', { collection, records })
}

export async function restoreLocalState(snapshot: CairnStateSnapshot): Promise<CairnStateSnapshot> {
  if (!isTauriRuntime()) return snapshot
  return invoke<CairnStateSnapshot>('restore_state', { state: snapshot })
}

export async function exportLocalBackup(): Promise<string> {
  if (!isTauriRuntime()) return ''
  return invoke<string>('export_backup')
}

export async function saveAttachmentFile(input: {
  ownerType: string
  ownerId: string
  kind: string
  attachmentId: string
  fileName: string
  contentDataUrl: string
}): Promise<{ fileName: string; relativePath: string; mimeType: string }> {
  if (!isTauriRuntime()) {
    return {
      fileName: input.fileName,
      relativePath: input.contentDataUrl,
      mimeType: input.contentDataUrl.match(/^data:([^;]+)/)?.[1] ?? 'image/png',
    }
  }
  return invoke<{ file_name: string; relative_path: string; mime_type: string }>('save_attachment_file', {
    owner_type: input.ownerType,
    owner_id: input.ownerId,
    kind: input.kind,
    attachment_id: input.attachmentId,
    file_name: input.fileName,
    content_data_url: input.contentDataUrl,
  }).then((saved) => ({
    fileName: saved.file_name,
    relativePath: saved.relative_path,
    mimeType: saved.mime_type,
  }))
}

export async function readAttachmentFile(relativePath: string): Promise<string> {
  if (relativePath.startsWith('data:') || relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath
  }
  if (!isTauriRuntime()) return relativePath
  return invoke<string>('read_attachment_file', { relative_path: relativePath })
}

export async function saveChartSourceFile(input: {
  fileName: string
  contentBase64: string
  symbolLabel: string
  timeframe: string
  startUtc: string
  endUtc: string
}): Promise<string> {
  if (!isTauriRuntime()) return ''
  return invoke<string>('save_chart_source_file', {
    ...input,
    content_base64: input.contentBase64,
    symbol_label: input.symbolLabel,
    start_utc: input.startUtc,
    end_utc: input.endUtc,
  })
}

export async function saveLocalRecords<T extends { id: string }>(
  collection: CollectionName,
  records: T[],
): Promise<void> {
  if (!isTauriRuntime() || records.length === 0) return
  await invoke('save_records', { collection, records })
}
