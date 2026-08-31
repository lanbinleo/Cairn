import { invoke } from '@tauri-apps/api/core'

import { toast } from '@/components/ui/sonner'

import type { CairnStateSnapshot } from './seed'
import { seedState } from './seed'
import { logFrontendError } from './frontend-log'
import type { BindingMatch } from './binding-suggestions'
import type { CaseCard, CaseSummary, TradeCase } from './types'

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

/* ---------- fire-and-forget 持久化（0.3.6） ----------
 * store 里的 void save/delete 调用统一走 bg* 函数：UI 已经即时更新，
 * 落库失败必须让用户知道（toast + 前端日志），否则就是「以为存了其实没存」。
 * 需要自行处理错误的调用方请 await 对应的非 bg 函数。 */

function notifyPersistFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(`本地保存失败：${message}。当前改动可能没有存上，重启后会回退。`)
  void logFrontendError(`persist failed: ${message}`)
}

export function bgSaveRecord<T extends { id: string }>(collection: CollectionName, record: T): void {
  saveLocalRecord(collection, record).catch(notifyPersistFailure)
}

export function bgSaveRecords<T extends { id: string }>(collection: CollectionName, records: T[]): void {
  saveLocalRecords(collection, records).catch(notifyPersistFailure)
}

export function bgDeleteRecord(collection: CollectionName, id: string): void {
  deleteLocalRecord(collection, id).catch(notifyPersistFailure)
}

export function bgReplaceCollection<T extends { id: string }>(collection: CollectionName, records: T[]): void {
  replaceLocalCollection(collection, records).catch(notifyPersistFailure)
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

/** 内置浮窗脚本（随应用打包）；浏览器预览环境拿不到。 */
export interface WidgetScript {
  version: string
  script: string
}

export async function getWidgetScript(): Promise<WidgetScript | null> {
  if (!isTauriRuntime()) return null
  return invoke<WidgetScript>('get_widget_script')
}

/** GitHub main 分支的浮窗脚本；remote 为 null 表示网络不可达（remoteError 为原因），用内置版。 */
export interface WidgetScriptUpdate {
  builtinVersion: string
  remote: { version: string; script: string } | null
  remoteNewer: boolean
  remoteError: string | null
}

export async function checkWidgetScriptUpdate(): Promise<WidgetScriptUpdate | null> {
  if (!isTauriRuntime()) return null
  return invoke<WidgetScriptUpdate>('check_widget_script_update')
}

/* ---------- AI Provider 管理 ---------- */

/** 思考等级（0.3.2 统一抽象）：auto = 跟随模型默认（不发参数）；其余按 preset 映射成各家原生参数 */
export type AiThinkingLevel = 'auto' | 'on' | 'off' | 'low' | 'medium' | 'high'

export interface AiModelConfig {
  id: string
  /** 模型级思考等级；缺省继承 Provider 级 */
  thinking?: Exclude<AiThinkingLevel, 'auto'>
}

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  presetId?: string
  defaultModel?: string
  /** 模型列表（0.3.2）：一个 Provider 可配多个模型；旧数据由 defaultModel 合成 */
  models?: AiModelConfig[]
  isDefault: boolean
  /** 思考等级（Provider 级默认，模型级可覆盖） */
  thinking?: Exclude<AiThinkingLevel, 'auto'>
  /** 并发上限（0.3.1）：「全部识别」批量与后台自动识别共用，默认 10 */
  concurrency?: number
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

/** 把默认 Provider 切换到指定 id（设置页点击 Provider 卡片即选中） */
export async function setDefaultAiProvider(id: string): Promise<AiProvider[]> {
  if (!isTauriRuntime()) return offlineProviders
  return invoke<AiProvider[]>('set_default_ai_provider', { id })
}

export async function fetchAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>('fetch_ai_models', { baseUrl, apiKey })
}

/** 默认 Provider 的并发上限（「全部识别」批量 worker 数，默认 10）。 */
export async function getDefaultAiConcurrency(): Promise<number> {
  if (!isTauriRuntime()) return 10
  return invoke<number>('default_ai_concurrency')
}

/** AI 秘书识别一张 Card；instruction 为重试时的补充要求。返回更新后的 Card。 */
export async function analyzeCaseCard(cardId: string, instruction?: string): Promise<CaseCard> {
  if (!isTauriRuntime()) {
    throw new Error('AI 识别需要桌面版运行')
  }
  return invoke<CaseCard>('analyze_case_card', { cardId, instruction: instruction ?? null })
}

export interface CaseCardResplitSegment {
  text: string
  barRef: number | null
}

/** AI 重拆预览（0.3.6 两步式）：跑拆卡 AI 返回分段，不落库、原卡不动。 */
export async function previewCaseCardResplit(cardId: string): Promise<{ caseId: string; segments: CaseCardResplitSegment[] }> {
  if (!isTauriRuntime()) {
    throw new Error('AI 重拆需要桌面版运行')
  }
  return invoke<{ caseId: string; segments: CaseCardResplitSegment[] }>('preview_case_card_resplit', { cardId })
}

/** AI 重拆应用：确认后的分段替换原卡（软删）。originalText 是预览时的原文——
 *  应用前比对原卡，期间被编辑/删除则中止。 */
export async function applyCaseCardResplit(
  cardId: string,
  originalText: string,
  segments: CaseCardResplitSegment[],
): Promise<{ caseId: string; cards: CaseCard[] }> {
  if (!isTauriRuntime()) {
    throw new Error('AI 重拆需要桌面版运行')
  }
  return invoke<{ caseId: string; cards: CaseCard[] }>('apply_case_card_resplit', { cardId, originalText, segments })
}

/** AI 秘书代拟 Case 标题，返回草稿（不落库）。 */
export async function draftCaseTitle(caseId: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('AI 拟题需要桌面版运行')
  }
  return invoke<string>('draft_case_title', { caseId })
}

/** AI 持仓管理补录建议：检查绑定 Trade 的卡片动作覆盖情况，返回更新后的 Case。
 *  instruction（0.3.6）：标签建议的可教重试——用户补充要求会连同标签现状一起发给 AI。 */
export async function suggestCaseExecutions(caseId: string, instruction?: string): Promise<TradeCase> {
  if (!isTauriRuntime()) {
    throw new Error('AI 建议需要桌面版运行')
  }
  return invoke<TradeCase>('suggest_case_executions', { caseId, instruction: instruction ?? null })
}

/** 整单总结：上下文由前端组装，Rust 只做 AI 管道；返回总结 blob（analyzedAt 由调用方补）。
 *  taskId 存在时 Rust 走流式，增量经 cairn://ai-stream 事件推送。 */
export async function summarizeCase(context: string, instruction?: string, taskId?: string): Promise<CaseSummary> {
  if (!isTauriRuntime()) {
    throw new Error('AI 总结需要桌面版运行')
  }
  return invoke<CaseSummary>('ai_summarize_case', { context, instruction: instruction ?? null, taskId: taskId ?? null })
}

/** 关联推荐：AI 只排序+给理由，绑定由用户确认。 */
export async function suggestBindings(context: string, candidateCount: number): Promise<{ matches: BindingMatch[] }> {
  if (!isTauriRuntime()) {
    throw new Error('AI 推荐需要桌面版运行')
  }
  return invoke<{ matches: BindingMatch[] }>('ai_suggest_bindings', { context, candidateCount })
}

export interface AiSettings {
  autoAnalyze: boolean
  /** 0.3.0：绑定后自动建议 / 导入后自动关联推荐 */
  autoSuggest?: boolean
  /** 0.3.0：Trade 关闭时自动整单总结 */
  autoSummary?: boolean
}

export async function getAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime()) return { autoAnalyze: true, autoSuggest: true, autoSummary: true }
  return invoke<AiSettings>('get_ai_settings')
}

export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  if (!isTauriRuntime()) return settings
  return invoke<AiSettings>('save_ai_settings', { settings })
}

/* ---------- 出站网络设置（0.3.3：三档模式） ---------- */

export type ProxyMode = 'system' | 'manual' | 'off'

export interface NetworkSettings {
  /** "system"（默认，跟随操作系统代理）| "manual"（手动地址）| "off"（强制直连）；
   * null/缺省 = 0.3.2 旧文件（proxyEnabled 迁移）。 */
  mode?: ProxyMode | null
  /** 手动模式的代理地址；默认 http://127.0.0.1:7890 */
  proxyUrl: string
  /** 0.3.2 旧字段，只读迁移用 */
  proxyEnabled?: boolean
  /** 当前实际生效的代理地址（manual 配置值或 system 探测到的系统代理）；直连为缺省 */
  effectiveProxyUrl?: string
}

export async function getNetworkSettings(): Promise<NetworkSettings> {
  if (!isTauriRuntime()) return { mode: 'system', proxyUrl: 'http://127.0.0.1:7890' }
  return invoke<NetworkSettings>('get_network_settings')
}

export async function saveNetworkSettings(settings: NetworkSettings): Promise<NetworkSettings> {
  if (!isTauriRuntime()) return settings
  return invoke<NetworkSettings>('save_network_settings', { settings })
}
