'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

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
import { Switch } from '@/components/ui/switch'
import { fetchAiModels, saveAiProvider, type AiProvider } from '@/lib/local-db'
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
  const [isDefault, setIsDefault] = useState(false)
  const [thinking, setThinking] = useState<'auto' | 'on' | 'off'>('auto')
  const [concurrencyText, setConcurrencyText] = useState('10')
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
    setIsDefault(provider?.isDefault ?? false)
    setThinking(provider?.thinking ?? 'auto')
    setConcurrencyText(String(provider?.concurrency ?? 10))
    setModels(provider?.defaultModel ? [provider.defaultModel] : [])
    setModelError('')
    setSaveError('')
  }, [open, provider])

  function applyPreset(preset: AiProviderPreset) {
    setPresetId(preset.id)
    setName((current) => current.trim() || preset.name)
    if (preset.baseUrl) setBaseUrl(preset.baseUrl)
    else if (preset.id === 'custom') setBaseUrl('')
  }

  async function loadModels() {
    setLoadingModels(true)
    setModelError('')
    try {
      const list = await fetchAiModels(baseUrl, apiKey)
      setModels(list)
      if (!defaultModel && list.length > 0) setDefaultModel(list[0])
    } catch (error) {
      setModels([])
      setModelError(String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  async function handleSave() {
    if (!name.trim() || !baseUrl.trim()) {
      setSaveError('名称和 Base URL 不能为空。')
      return
    }
    const concurrency = Number.parseInt(concurrencyText, 10)
    try {
      const providers = await saveAiProvider({
        id: provider?.id ?? '',
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        presetId: presetId === 'custom' ? undefined : presetId,
        defaultModel: defaultModel.trim() || undefined,
        isDefault,
        thinking: thinking === 'auto' ? undefined : thinking,
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
            <FieldLabel htmlFor="ai-provider-model">默认模型</FieldLabel>
            <div className="flex items-center gap-2">
              <Select
                items={models.map((model) => ({ value: model, label: model }))}
                value={defaultModel || undefined}
                onValueChange={(value) => setDefaultModel(value ?? '')}
              >
                <SelectTrigger id="ai-provider-model" className="min-w-0 flex-1 font-mono text-xs" disabled={models.length === 0}>
                  <SelectValue placeholder={models.length === 0 ? '先获取模型列表' : '选择模型'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={loadModels} disabled={loadingModels || !baseUrl.trim()}>
                <RefreshCw data-icon="inline-start" className={loadingModels ? 'animate-spin' : undefined} />
                {loadingModels ? '获取中' : '获取模型'}
              </Button>
            </div>
            {modelError && <p className="text-xs text-destructive">{modelError}</p>}
            {!modelError && models.length > 0 && (
              <p className="text-xs text-muted-foreground">连接成功，共 {models.length} 个模型</p>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-provider-thinking">思考模式</FieldLabel>
            <Select
              items={[
                { value: 'auto', label: '跟随模型默认' },
                { value: 'on', label: '开启思考' },
                { value: 'off', label: '关闭思考' },
              ]}
              value={thinking}
              onValueChange={(value) => setThinking((value as 'auto' | 'on' | 'off') ?? 'auto')}
            >
              <SelectTrigger id="ai-provider-thinking" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">跟随模型默认</SelectItem>
                  <SelectItem value="on">开启思考</SelectItem>
                  <SelectItem value="off">关闭思考</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>仅支持思考开关的端点（智谱 GLM 系）生效，其他 Provider 保持默认。关闭思考可加快识别速度。</FieldDescription>
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

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">设为默认 Provider</span>
              <span className="text-xs text-muted-foreground">AI 功能默认使用此 Provider 和模型</span>
            </div>
            <Switch checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} />
          </div>
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
