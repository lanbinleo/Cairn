'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Star, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchAiModels, saveAiProvider, type AiModelConfig, type AiProvider, type AiThinkingLevel } from '@/lib/local-db'
import { cn } from '@/lib/utils'

export interface AiProviderPreset {
  id: string
  name: string
  baseUrl: string
  badge: string
  color: string
  textColor: string
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', badge: '❋', color: '#0d0d0d', textColor: '#ffffff' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', badge: 'A', color: '#D97757', textColor: '#ffffff' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', badge: 'OR', color: '#1a1a1a', textColor: '#ffffff' },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', badge: 'G', color: '#4285F4', textColor: '#ffffff' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', badge: 'Gq', color: '#F55036', textColor: '#ffffff' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', badge: 'DS', color: '#4D6BFE', textColor: '#ffffff' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', badge: 'Z', color: '#3859FF', textColor: '#ffffff' },
  { id: 'moonshot', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', badge: 'K', color: '#101010', textColor: '#ffffff' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', badge: 'Q', color: '#615CED', textColor: '#ffffff' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', badge: 'S', color: '#4E6BFF', textColor: '#ffffff' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', badge: '🦙', color: '#f5f5f5', textColor: '#0d0d0d' },
  { id: 'custom', name: '自定义', baseUrl: '', badge: 'AI', color: '#52525b', textColor: '#ffffff' },
]

export function presetFor(presetId?: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]
}

/** 思考等级选项文案；auto = 跟随模型默认（不发参数） */
export const THINKING_LEVEL_LABELS: Record<AiThinkingLevel, string> = {
  auto: '跟随模型默认',
  on: '开启思考',
  off: '关闭思考',
  low: '低',
  medium: '中',
  high: '高',
}

/** 各 preset 支持的思考等级（0.3.2）：按厂商映射成原生参数；不在表里的 Provider 不支持 */
const PRESET_THINKING_LEVELS: Record<string, AiThinkingLevel[]> = {
  openrouter: ['low', 'medium', 'high', 'off'],
  openai: ['low', 'medium', 'high'],
  zhipu: ['on', 'low', 'high', 'off'],
  qwen: ['on', 'off', 'low', 'medium', 'high'],
  siliconflow: ['on', 'off'],
}

export function thinkingLevelsForPreset(presetId?: string): AiThinkingLevel[] {
  return (presetId && PRESET_THINKING_LEVELS[presetId]) || []
}

/** GLM-5.3 系列官方明确「始终思考，不能关闭」（发 disabled 会 400）——不提供「关闭思考」 */
function isAlwaysThinkingModel(presetId?: string, modelId?: string): boolean {
  return presetId === 'zhipu' && /^glm-5\.3/i.test(modelId ?? '')
}

/** 单个模型可用的思考等级：preset 等级减去该模型不支持的档位 */
function thinkingLevelsForModel(presetId?: string, modelId?: string): AiThinkingLevel[] {
  const levels = thinkingLevelsForPreset(presetId)
  return isAlwaysThinkingModel(presetId, modelId) ? levels.filter((level) => level !== 'off') : levels
}

export function AiProviderBadge({ presetId, className }: { presetId?: string; className?: string }) {
  const preset = presetFor(presetId)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold leading-none shadow-sm',
        className,
      )}
      style={{ backgroundColor: preset.color, color: preset.textColor }}
    >
      {preset.badge}
    </span>
  )
}

export function AiProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: AiProvider | null
  onSaved: (providers: AiProvider[]) => void
}) {
  const [presetId, setPresetId] = useState('custom')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [thinking, setThinking] = useState<AiThinkingLevel>('auto')
  const [concurrencyText, setConcurrencyText] = useState('10')
  const [modelConfigs, setModelConfigs] = useState<AiModelConfig[]>([])
  const [manualModel, setManualModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!open) return
    setPresetId(provider?.presetId ?? 'custom')
    setName(provider?.name ?? '')
    setBaseUrl(provider?.baseUrl ?? '')
    setApiKey(provider?.apiKey ?? '')
    setDefaultModel(provider?.defaultModel ?? '')
    setThinking(provider?.thinking ?? 'auto')
    setConcurrencyText(String(provider?.concurrency ?? 10))
    setModelConfigs(
      provider?.models?.length
        ? provider.models
        : provider?.defaultModel
          ? [{ id: provider.defaultModel }]
          : [],
    )
    setManualModel('')
    setModels(provider?.defaultModel ? [provider.defaultModel] : [])
    setModelError('')
    setSaveError('')
  }, [open, provider])

  function applyPreset(preset: AiProviderPreset) {
    setPresetId(preset.id)
    setName((current) => current.trim() || preset.name)
    if (preset.baseUrl) setBaseUrl(preset.baseUrl)
    else if (preset.id === 'custom') setBaseUrl('')
    // 切换 Provider 后原思考等级可能不被支持，回退到跟随模型默认（Provider 级与模型级都清洗）
    const levels = thinkingLevelsForPreset(preset.id)
    setThinking((current) => (levels.includes(current) ? current : 'auto'))
    setModelConfigs((current) =>
      current.map((item) => ({
        ...item,
        thinking: item.thinking && levels.includes(item.thinking) ? item.thinking : undefined,
      })),
    )
  }

  async function loadModels() {
    setLoadingModels(true)
    setModelError('')
    try {
      const list = await fetchAiModels(baseUrl, apiKey)
      setModels(list)
      if (modelConfigs.length === 0 && list.length > 0) {
        setModelConfigs([{ id: list[0] }])
        setDefaultModel(list[0])
      }
    } catch (error) {
      setModels([])
      setModelError(String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  const availableLevels = thinkingLevelsForPreset(presetId)
  const availableModels = models.filter((model) => !modelConfigs.some((item) => item.id === model))

  function addModel(id: string) {
    const trimmed = id.trim()
    if (!trimmed || modelConfigs.some((item) => item.id === trimmed)) return
    setModelConfigs((current) => [...current, { id: trimmed }])
    if (!defaultModel) setDefaultModel(trimmed)
  }

  function removeModel(id: string) {
    const next = modelConfigs.filter((item) => item.id !== id)
    setModelConfigs(next)
    if (defaultModel === id) setDefaultModel(next[0]?.id ?? '')
  }

  async function handleSave() {
    if (!name.trim() || !baseUrl.trim()) {
      setSaveError('名称和 Base URL 不能为空。')
      return
    }
    if (modelConfigs.length === 0) {
      setSaveError('至少添加一个模型。')
      return
    }
    const concurrency = Number.parseInt(concurrencyText, 10)
    // 与渲染同样的兜底：当前 preset 不支持的等级按「跟随模型默认」保存
    const effectiveThinking = thinking !== 'auto' && availableLevels.includes(thinking) ? thinking : 'auto'
    try {
      const providers = await saveAiProvider({
        id: provider?.id ?? '',
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        presetId: presetId === 'custom' ? undefined : presetId,
        defaultModel: defaultModel || modelConfigs[0].id,
        models: modelConfigs,
        // 默认 Provider 在设置页点击列表切换；保存只维护本 Provider 自身（后端保留原默认标记）
        isDefault: provider?.isDefault ?? false,
        thinking: effectiveThinking === 'auto' ? undefined : effectiveThinking,
        concurrency: Number.isInteger(concurrency) && concurrency > 0 ? Math.min(concurrency, 32) : undefined,
        createdAt: provider?.createdAt ?? 0,
        updatedAt: provider?.updatedAt ?? 0,
      })
      onSaved(providers)
    } catch (error) {
      setSaveError(String(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{provider ? '编辑 AI Provider' : '添加 AI Provider'}</DialogTitle>
          <DialogDescription>OpenAI compatible 接口；API Key 只保存在本机，不进入备份</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>常用 Provider</FieldLabel>
            <div className="grid grid-cols-4 gap-2">
              {AI_PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors',
                    presetId === preset.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-muted-foreground/40 hover:bg-muted/50',
                  )}
                >
                  <AiProviderBadge presetId={preset.id} />
                  <span className="truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-name">名称</FieldLabel>
            <Input id="ai-provider-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-url">Base URL</FieldLabel>
            <Input
              id="ai-provider-url"
              className="font-mono text-xs"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-key">API Key（本地服务可留空）</FieldLabel>
            <Input
              id="ai-provider-key"
              type="password"
              className="font-mono text-xs"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>模型列表（★ 为默认模型）</FieldLabel>
            <div className="flex flex-col gap-2">
              {modelConfigs.map((model) => {
                const modelLevels = thinkingLevelsForModel(presetId, model.id)
                return (
                <div key={model.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={`设为默认模型 ${model.id}`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setDefaultModel(model.id)}
                  >
                    <Star className={cn('size-4', defaultModel === model.id && 'fill-current text-amber-500')} />
                  </button>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</span>
                  {modelLevels.length > 0 && (
                    <Select
                      items={[
                        { value: 'inherit', label: '跟随 Provider' },
                        ...modelLevels.map((level) => ({ value: level, label: THINKING_LEVEL_LABELS[level] })),
                      ]}
                      value={model.thinking && modelLevels.includes(model.thinking) ? model.thinking : 'inherit'}
                      onValueChange={(value) =>
                        setModelConfigs((current) =>
                          current.map((item) =>
                            item.id === model.id
                              ? { ...item, thinking: !value || value === 'inherit' ? undefined : (value as AiModelConfig['thinking']) }
                              : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label={`${model.id} 思考等级`}
                        className="h-7 w-[7.5rem] shrink-0 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="inherit">跟随 Provider</SelectItem>
                          {modelLevels.map((level) => (
                            <SelectItem key={level} value={level}>
                              {THINKING_LEVEL_LABELS[level]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                  <button
                    type="button"
                    aria-label={`移除模型 ${model.id}`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => removeModel(model.id)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                )
              })}
              {presetId === 'zhipu' && modelConfigs.some((model) => isAlwaysThinkingModel(presetId, model.id)) && (
                <p className="text-xs text-muted-foreground">GLM-5.3 系列始终思考（官方不支持关闭），已配置「关闭」的会按最低档 low 发送。</p>
              )}
              <div className="flex items-center gap-2">
                <Input
                  aria-label="模型名"
                  className="min-w-0 flex-1 font-mono text-xs"
                  placeholder={availableModels.length > 0 ? '输入或从右侧列表选择模型名' : '输入模型名，或先获取模型列表'}
                  value={manualModel}
                  onChange={(event) => setManualModel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addModel(manualModel)
                      setManualModel('')
                    }
                  }}
                />
                {availableModels.length > 0 && (
                  <Select
                    items={availableModels.map((model) => ({ value: model, label: model }))}
                    value=""
                    onValueChange={(value) => {
                      if (value) addModel(value)
                    }}
                  >
                    <SelectTrigger aria-label="从已获取列表添加" className="h-8 w-36 shrink-0 font-mono text-xs">
                      <SelectValue placeholder="从列表添加" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableModels.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!manualModel.trim()}
                  onClick={() => {
                    addModel(manualModel)
                    setManualModel('')
                  }}
                >
                  添加
                </Button>
              </div>
              <div>
                <Button variant="outline" size="sm" onClick={loadModels} disabled={loadingModels || !baseUrl.trim()}>
                  <RefreshCw data-icon="inline-start" className={loadingModels ? 'animate-spin' : undefined} />
                  {loadingModels ? '获取中' : '获取模型'}
                </Button>
              </div>
              {modelError && <p className="text-xs text-destructive">{modelError}</p>}
              {!modelError && models.length > 0 && (
                <p className="text-xs text-muted-foreground">连接成功，共 {models.length} 个模型；点选即加入列表</p>
              )}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-thinking">思考等级</FieldLabel>
            <Select
              items={
                availableLevels.length > 0
                  ? [{ value: 'auto', label: THINKING_LEVEL_LABELS.auto }, ...availableLevels.map((level) => ({ value: level, label: THINKING_LEVEL_LABELS[level] }))]
                  : [{ value: 'auto', label: THINKING_LEVEL_LABELS.auto }]
              }
              value={availableLevels.includes(thinking) || thinking === 'auto' ? thinking : 'auto'}
              onValueChange={(value) => setThinking((value as AiThinkingLevel) ?? 'auto')}
              disabled={availableLevels.length === 0}
            >
              <SelectTrigger id="ai-provider-thinking" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">跟随模型默认</SelectItem>
                  {availableLevels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {THINKING_LEVEL_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {availableLevels.length > 0
                ? '默认对全部模型生效，单个模型可在上方单独设置。关闭思考可加快识别速度。'
                : '该 Provider 的接口暂不支持思考参数，保持各模型默认行为。'}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-concurrency">并发上限</FieldLabel>
            <Input
              id="ai-provider-concurrency"
              type="number"
              min="1"
              max="32"
              value={concurrencyText}
              onChange={(event) => setConcurrencyText(event.target.value.replace(/[^0-9]/g, ''))}
            />
            <FieldDescription>「全部识别」批量与后台自动识别同时进行的请求数（默认 10）；限流（429）时调低。</FieldDescription>
          </Field>
        </FieldGroup>

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
