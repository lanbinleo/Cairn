import type { CaseCard, CaseCardPhase, CaseEntryDecision, CaseProvenance, CaseStatus } from './types'

export const CASE_PHASE_OPTIONS: Array<{ value: CaseCardPhase; label: string; description: string }> = [
  { value: 'pre-entry', label: 'Pre-entry', description: '市场环境、观察重点和继续等待的条件' },
  { value: 'entry', label: 'Entry', description: '信号 BAR、入场理由、失效条件和计划' },
  { value: 'intermediate', label: 'Intermediate', description: '持仓期间看到的新结构、推断和计划变化' },
  { value: 'closing', label: 'Closing', description: '减仓或离场时看到的变化和执行理由' },
  { value: 'reflection', label: 'Reflection', description: '交易结束后的过程复盘' },
]

export const CASE_STATUS_OPTIONS: Array<{ value: CaseStatus; label: string }> = [
  { value: 'active', label: '记录中' },
  { value: 'closed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export const CASE_PROVENANCE_OPTIONS: Array<{ value: CaseProvenance; label: string }> = [
  { value: 'forward', label: 'Forward · 当时记录' },
  { value: 'retrospective', label: 'Retrospective · 事后记录' },
]

export const CASE_ENTRY_DECISION_OPTIONS: Array<{ value: CaseEntryDecision; label: string }> = [
  { value: 'pending', label: '待确认' },
  { value: 'executed', label: '已执行' },
  { value: 'continue-observing', label: '未执行，继续观察' },
]

export const casePhaseLabel = Object.fromEntries(CASE_PHASE_OPTIONS.map((option) => [option.value, option.label])) as Record<CaseCardPhase, string>
export const caseStatusLabel = Object.fromEntries(CASE_STATUS_OPTIONS.map((option) => [option.value, option.label])) as Record<CaseStatus, string>
export const caseProvenanceLabel = Object.fromEntries(CASE_PROVENANCE_OPTIONS.map((option) => [option.value, option.label])) as Record<CaseProvenance, string>
export const caseEntryDecisionLabel = Object.fromEntries(CASE_ENTRY_DECISION_OPTIONS.map((option) => [option.value, option.label])) as Record<CaseEntryDecision, string>

/** memo direction 值（AI 规范为 "long"/"short"）→ 做多/做空；无法识别返回 null */
export function memoDirectionLabel(value: string | number | undefined): '做多' | '做空' | null {
  if (value == null) return null
  const text = String(value).toLowerCase()
  if (text.includes('short') || text.includes('空')) return '做空'
  if (text.includes('long') || text.includes('多')) return '做多'
  return null
}

export const CASE_PHASE_PROMPTS: Record<CaseCardPhase, string[]> = {
  'pre-entry': ['现在是什么市场状态？', '哪些位置或结构值得观察？', '出现什么条件才会考虑入场？'],
  entry: ['是哪一根 BAR 触发了想法？', '方向、入场计划、止损和目标是什么？', '什么情况会让这个想法失效？'],
  intermediate: ['现在是哪一根 BAR？', '新出现了什么结构？', '它会如何改变原来的持仓计划？'],
  closing: ['是哪一根 BAR 触发了离场想法？', '市场发生了什么变化？', '这次离场符合之前的计划吗？'],
  reflection: ['实际发生了什么？', '哪些判断有依据，哪些推断没有依据？', '哪些动作符合计划，哪些是临时决定？'],
}

export function displayPhaseForCaseCard(card: CaseCard): CaseCardPhase {
  return card.phase === 'entry' && card.entryDecision === 'continue-observing' ? 'pre-entry' : card.phase
}

export function extractExplicitBarRef(rawText: string): number | undefined {
  const refs: Array<{ index: number; value: number }> = []
  const patterns = [
    /\bbar\s*#?\s*(\d+)\b/gi,
    /第\s*(\d+)\s*根\s*(?:k\s*线|蜡烛|bar)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of rawText.matchAll(pattern)) {
      const value = Number(match[1])
      if (Number.isInteger(value) && value > 0) refs.push({ index: match.index ?? Number.MAX_SAFE_INTEGER, value })
    }
  }
  return refs.sort((a, b) => a.index - b.index)[0]?.value
}

/** AI 秘书标签类型的中文与颜色（高亮原文用）。 */
export const CASE_CARD_LABEL_META: Record<string, { label: string; color: string }> = {
  'market-context': { label: '市场背景', color: '#94a3b8' },
  'setup-condition': { label: '形态条件', color: '#60a5fa' },
  'observed-pattern': { label: '观察结构', color: '#22d3ee' },
  inference: { label: '推断预期', color: '#a78bfa' },
  'entry-plan': { label: '入场计划', color: '#4ade80' },
  invalidation: { label: '失效条件', color: '#f87171' },
  'risk-plan': { label: '风险计划', color: '#fb923c' },
  'position-management': { label: '持仓管理', color: '#fbbf24' },
  action: { label: '已执行动作', color: '#34d399' },
  emotion: { label: '情绪', color: '#f472b6' },
  reflection: { label: '复盘', color: '#818cf8' },
}

/** 入场 memo 六字段的中文名（与过程分 memo 完整项同一清单）。 */
export const CASE_MEMO_FIELD_LABEL: Record<string, string> = {
  direction: '方向',
  stopLoss: '止损',
  target: '目标',
  confidence: '置信度',
  invalidation: '失效点',
  rejectedAlternatives: '放弃的方案',
  emotion: '情绪',
}

/** 默认占位标题：自动拟题只替换这类标题，用户起过的名字永不覆盖。 */
export function isDefaultCaseTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return true
  if (trimmed === '未命名 Case') return true
  // Case 页新建对话框：`Case ${toLocaleDateString('zh-CN')}` → "Case 2026/8/28"
  if (/^Case \d{4}(\/\d{1,2}){2}$/.test(trimmed)) return true
  // 浮窗默认：`SYM 观察 HH:MM`
  if (/ 观察 \d{1,2}:\d{2}$/.test(trimmed)) return true
  // Trade 页新建并关联：`Trade #001 Case`
  if (/^Trade #\d+ Case$/.test(trimmed)) return true
  return false
}
