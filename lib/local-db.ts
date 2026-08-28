import { invoke } from '@tauri-apps/api/core'

import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'
import type { CaseCard } from './types'

type CollectionName =
  | 'accounts'
  | 'periods'
  | 'trades'
  | 'symbols'
  | 'notes'
  | 'tagDefs'
  | 'cases'
  | 'caseCards'
  | 'caseBindings'
  | 'caseTagDefs'
  | 'importBatches'
  | 'attachments'
  | 'chartImports'
  | 'chartCandles'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauriRuntime() {
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
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    kind: input.kind,
    attachmentId: input.attachmentId,
    fileName: input.fileName,
    contentDataUrl: input.contentDataUrl,
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
  return invoke<string>('read_attachment_file', { relativePath })
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

/* ---------- 本地 REST API 管理 ---------- */

export interface ApiStatus {
  enabled: boolean
  port: number
  running: boolean
  boundPort: number
  token: string
  createdAt: number
}

const offlineApiStatus: ApiStatus = {
  enabled: false,
  port: 0,
  running: false,
  boundPort: 0,
  token: '',
  createdAt: 0,
}

export async function getApiStatus(): Promise<ApiStatus> {
  if (!isTauriRuntime()) return offlineApiStatus
  return invoke<ApiStatus>('get_api_status')
}

export async function regenerateApiToken(): Promise<ApiStatus> {
  if (!isTauriRuntime()) return offlineApiStatus
  return invoke<ApiStatus>('regenerate_api_token')
}

export async function setApiConfig(enabled: boolean, port: number): Promise<ApiStatus> {
  if (!isTauriRuntime()) return offlineApiStatus
  return invoke<ApiStatus>('set_api_config', { enabled, port })
}

/* ---------- AI Provider 管理 ---------- */

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  presetId?: string
  defaultModel?: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

const offlineProviders: AiProvider[] = []

export async function listAiProviders(): Promise<AiProvider[]> {
  if (!isTauriRuntime()) return offlineProviders
  return invoke<AiProvider[]>('list_ai_providers')
}

export async function saveAiProvider(provider: AiProvider): Promise<AiProvider[]> {
  if (!isTauriRuntime()) return offlineProviders
  return invoke<AiProvider[]>('save_ai_provider', { provider })
}

export async function deleteAiProvider(id: string): Promise<AiProvider[]> {
  if (!isTauriRuntime()) return offlineProviders
  return invoke<AiProvider[]>('delete_ai_provider', { id })
}

export async function fetchAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>('fetch_ai_models', { baseUrl, apiKey })
}

/** AI 秘书整理一张 Card；instruction 为重试时的补充要求。返回更新后的 Card。 */
export async function analyzeCaseCard(cardId: string, instruction?: string): Promise<CaseCard> {
  if (!isTauriRuntime()) {
    throw new Error('AI 整理需要桌面版运行')
  }
  return invoke<CaseCard>('analyze_case_card', { cardId, instruction: instruction ?? null })
}

/** AI 秘书代拟 Case 标题，返回草稿（不落库）。 */
export async function draftCaseTitle(caseId: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('AI 拟题需要桌面版运行')
  }
  return invoke<string>('draft_case_title', { caseId })
}

export interface AiSettings {
  autoAnalyze: boolean
}

export async function getAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime()) return { autoAnalyze: true }
  return invoke<AiSettings>('get_ai_settings')
}

export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  if (!isTauriRuntime()) return settings
  return invoke<AiSettings>('save_ai_settings', { settings })
}
