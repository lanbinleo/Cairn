'use client'

import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { useTheme } from 'next-themes'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { CreateSymbolDialog } from '@/components/create-symbol-dialog'
import { BackupCard } from '@/components/backup-card'
import { AiProviderBadge, AiProviderDialog } from '@/components/ai-provider-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { checkWidgetScriptUpdate, deleteAiProvider, getAiSettings, getApiStatus, getWidgetScript, listAiProviders, regenerateApiToken, saveAiSettings, setApiConfig, type AiProvider, type ApiStatus, type WidgetScript, type WidgetScriptUpdate } from '@/lib/local-db'
import { useCairn } from '@/lib/store'

const categoryLabel: Record<string, string> = {
  crypto: '加密货币',
  forex: '外汇',
  futures: '期货',
  stock: '股票',
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-5 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label>{title}</Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { symbols, trades, deleteSymbol } = useCairn()
  const [mounted, setMounted] = useState(false)
  const [logs, setLogs] = useState('')
  const [logPath, setLogPath] = useState('')
  const [copiedLogs, setCopiedLogs] = useState(false)
  const [appVersion, setAppVersion] = useState('0.1.3')
  const [updateStatus, setUpdateStatus] = useState('尚未检查更新')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null)
  const [apiEnabledDraft, setApiEnabledDraft] = useState(true)
  const [apiPortDraft, setApiPortDraft] = useState('8787')
  const [apiMessage, setApiMessage] = useState('')
  const [copiedToken, setCopiedToken] = useState(false)
  const [savingApi, setSavingApi] = useState(false)
  const [widgetScript, setWidgetScript] = useState<WidgetScript | null>(null)
  const [widgetUpdate, setWidgetUpdate] = useState<WidgetScriptUpdate | null>(null)
  const [checkingWidget, setCheckingWidget] = useState(true)
  const [copiedWidgetScript, setCopiedWidgetScript] = useState(false)
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([])
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null)
  const [aiAutoAnalyze, setAiAutoAnalyze] = useState(true)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    void invoke<string>('get_app_version').then(setAppVersion).catch(() => undefined)
    void invoke<string>('get_log_path').then(setLogPath).catch(() => undefined)
    void getApiStatus()
      .then((status) => {
        setApiStatus(status)
        setApiEnabledDraft(status.enabled)
        setApiPortDraft(String(status.port))
      })
      .catch(() => undefined)
    void getWidgetScript().then(setWidgetScript).catch(() => undefined)
    void runWidgetUpdateCheck()
    void listAiProviders().then(setAiProviders).catch(() => undefined)
    void getAiSettings()
      .then((settings) => setAiAutoAnalyze(settings.autoAnalyze))
      .catch(() => undefined)
  }, [])

  function applyApiStatus(status: ApiStatus) {
    setApiStatus(status)
    setApiEnabledDraft(status.enabled)
    setApiPortDraft(String(status.port))
  }

  async function saveApiConfig() {
    const port = Number.parseInt(apiPortDraft, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setApiMessage('端口必须是 1-65535 的整数。')
      return
    }
    setSavingApi(true)
    try {
      const status = await setApiConfig(apiEnabledDraft, port)
      applyApiStatus(status)
      setApiMessage('配置已保存；重启应用后生效。')
    } catch (error) {
      setApiMessage(`保存失败：${String(error)}`)
    } finally {
      setSavingApi(false)
    }
  }

  async function refreshApiToken() {
    if (!window.confirm('重新生成 token 后，现有脚本需要更新为新 token 才能继续写入。确定重新生成？')) return
    try {
      const status = await regenerateApiToken()
      applyApiStatus(status)
      setApiMessage('token 已重新生成。')
    } catch (error) {
      setApiMessage(`重新生成失败：${String(error)}`)
    }
  }

  async function copyToken() {
    if (!apiStatus) return
    await navigator.clipboard?.writeText(apiStatus.token)
    setCopiedToken(true)
    window.setTimeout(() => setCopiedToken(false), 1200)
  }

  async function copyWidgetScript() {
    // GitHub 有新版时复制新版，否则复制内置版
    const source = widgetUpdate?.remoteNewer && widgetUpdate.remote ? widgetUpdate.remote.script : widgetScript?.script
    if (!source) return
    await navigator.clipboard?.writeText(source)
    setCopiedWidgetScript(true)
    window.setTimeout(() => setCopiedWidgetScript(false), 2000)
  }

  async function runWidgetUpdateCheck() {
    if (!isTauriRuntime()) {
      setCheckingWidget(false)
      return
    }
    setCheckingWidget(true)
    try {
      const update = await checkWidgetScriptUpdate()
      if (update?.remoteError) console.warn('[cairn] widget update check failed:', update.remoteError)
      setWidgetUpdate(update)
    } catch {
      setWidgetUpdate(null)
    } finally {
      setCheckingWidget(false)
    }
  }

  async function loadLogs() {
    if (!isTauriRuntime()) {
      setLogs('浏览器预览环境没有本地运行日志。')
      return
    }
    const content = await invoke<string>('read_logs')
    setLogs(content || '暂无日志。')
  }

  async function copyLogs() {
    await navigator.clipboard?.writeText(logs)
    setCopiedLogs(true)
    window.setTimeout(() => setCopiedLogs(false), 1200)
  }

  async function checkForUpdate() {
    setCheckingUpdate(true)
    setUpdateStatus('正在检查更新')
    try {
      const update = await check()
      if (!update) {
        setUpdateStatus('当前已经是最新版本')
        return
      }
      setUpdateStatus(`发现 ${update.version}，正在下载并安装`)
      await update.downloadAndInstall()
      setUpdateStatus('更新安装完成，正在重启')
      await relaunch()
    } catch (error) {
      setUpdateStatus(`检查更新失败：${String(error)}`)
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader title="设置" description="管理应用偏好、数据、日志与版本更新" />

      <Tabs defaultValue="general" className="gap-6">
        <TabsList className="h-10">
          <TabsTrigger value="general" className="px-4">通用</TabsTrigger>
          <TabsTrigger value="data" className="px-4">数据</TabsTrigger>
          <TabsTrigger value="docs" className="px-4">文档</TabsTrigger>
          <TabsTrigger value="api" className="px-4">本地 API</TabsTrigger>
          <TabsTrigger value="ai" className="px-4">AI</TabsTrigger>
          <TabsTrigger value="logs" className="px-4">日志</TabsTrigger>
          <TabsTrigger value="about" className="px-4">关于</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>通用</CardTitle>
              <CardDescription>设置界面显示与录入默认值</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-2xl">
                <SettingRow title="主题" description="浅色 / 深色 / 跟随系统">
                  {mounted && (
                    <Select
                      items={[
                        { value: 'light', label: '浅色' },
                        { value: 'dark', label: '深色' },
                        { value: 'system', label: '跟随系统' },
                      ]}
                      value={theme}
                      onValueChange={(v) => setTheme(v as string)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="light">浅色</SelectItem>
                          <SelectItem value="dark">深色</SelectItem>
                          <SelectItem value="system">跟随系统</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </SettingRow>

                <SettingRow title="时间基准" description="所有时间统一以 UTC 存储与展示">
                  <Select items={[{ value: 'utc', label: 'UTC' }]} value="utc" disabled>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="utc">UTC</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>

                <SettingRow title="默认录入周期" description="手动录入时 Bar 序号与时间换算的默认周期">
                  <Select
                    items={[
                      { value: '1', label: '1 分钟' },
                      { value: '5', label: '5 分钟' },
                      { value: '15', label: '15 分钟' },
                      { value: '60', label: '1 小时' },
                    ]}
                    defaultValue="5"
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="1">1 分钟</SelectItem>
                        <SelectItem value="5">5 分钟</SelectItem>
                        <SelectItem value="15">15 分钟</SelectItem>
                        <SelectItem value="60">1 小时</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>品种</CardTitle>
              <CardDescription>导入数据时必须选择品种归属；品种以「交易所:代码」唯一标识</CardDescription>
              <CardAction>
                <CreateSymbolDialog />
              </CardAction>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>标识</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>类别</TableHead>
                    <TableHead className="text-right">价格精度</TableHead>
                    <TableHead className="text-right">关联交易</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {symbols.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono font-medium">
                        {s.exchange}:{s.code}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{categoryLabel[s.category]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {s.pricePrecision}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {trades.filter((t) => t.symbolId === s.id).length}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除品种 ${s.exchange}:${s.code}`}
                          onClick={() => {
                            if (window.confirm(`删除品种「${s.exchange}:${s.code}」？`)) deleteSymbol(s.id)
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <BackupCard />
        </TabsContent>

        <TabsContent value="docs">
          <Card>
            <CardHeader>
              <CardTitle>数据格式文档</CardTitle>
              <CardDescription>导入、导出和粘贴 JSON 时使用的字段规范</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="font-medium">Trade JSON</h3>
                <p className="text-sm text-muted-foreground">
                  Trade 复制会生成带版本号的 JSON envelope。粘贴导入时，CAIRN 会重新分配 id、seq、Account、Period 和 Symbol。
                </p>
                <pre className="overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`{
  "kind": "cairn.trade",
  "version": 1,
  "includeChartData": false,
  "symbol": {
    "exchange": "BINANCE",
    "code": "BTCUSDT"
  },
  "trade": {
    "direction": "long",
    "status": "closed",
    "initialStopLoss": 42000,
    "executions": [
      {
        "action": "entry",
        "orderType": "market",
        "time": 1760000000000,
        "price": 43000,
        "quantity": 1
      }
    ],
    "events": [],
    "tags": ["breakout"]
  }
}`}
                </pre>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="font-medium">字段约定</h3>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>字段</TableHead>
                        <TableHead>说明</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ['time', 'UTC epoch 毫秒'],
                        ['direction', 'long / short'],
                        ['status', 'open / closed'],
                        ['action', 'entry / scale-in / scale-out / exit / stop / target-set / order-edit'],
                        ['orderType', 'market / limit / stop / stop-loss / take-profit'],
                        ['chartData', '可选；复制 JSON + 图表时包含'],
                        ['referenceImages', '不会写入 JSON；图片以附件方式保存在本机'],
                      ].map(([field, desc]) => (
                        <TableRow key={field}>
                          <TableCell className="font-mono">{field}</TableCell>
                          <TableCell className="text-muted-foreground">{desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>本地 REST API</CardTitle>
              <CardDescription>仅供本机脚本（如 TradingView 浮窗）写入 Case 数据；不提供任何下单或仓位修改能力</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex max-w-2xl flex-col">
                <SettingRow title="启用本地 API" description="只监听 127.0.0.1，修改后需重启应用生效">
                  <Switch checked={apiEnabledDraft} onCheckedChange={(checked) => setApiEnabledDraft(checked === true)} />
                </SettingRow>
                <SettingRow title="端口" description="默认 8787；被占用时启动失败，可在日志中查看原因">
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-24 font-mono"
                      value={apiPortDraft}
                      onChange={(event) => setApiPortDraft(event.target.value)}
                      inputMode="numeric"
                    />
                    <Button variant="outline" size="sm" disabled={savingApi || !isTauriRuntime()} onClick={saveApiConfig}>
                      保存配置
                    </Button>
                  </div>
                </SettingRow>
                <SettingRow title="运行状态" description="服务随应用常驻（托盘），关闭窗口不影响">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {apiStatus?.running && apiStatus.boundPort > 0 ? (
                      <>
                        <span className="size-2 rounded-full bg-emerald-500" />
                        运行中 · 127.0.0.1:{apiStatus.boundPort}
                      </>
                    ) : apiStatus?.enabled ? (
                      <>
                        <span className="size-2 rounded-full bg-amber-500" />
                        已启用但未运行
                      </>
                    ) : (
                      '未启用'
                    )}
                  </span>
                </SettingRow>
                <SettingRow title="访问 Token" description="脚本请求需携带 Authorization: Bearer &lt;token&gt;">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={!apiStatus?.token} onClick={copyToken}>
                      {copiedToken ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                      {copiedToken ? '已复制' : '复制 Token'}
                    </Button>
                    <Button variant="outline" size="sm" disabled={!isTauriRuntime()} onClick={refreshApiToken}>
                      重新生成
                    </Button>
                  </div>
                </SettingRow>
                {apiStatus?.token && (
                  <div className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">{apiStatus.token}</div>
                )}
                {apiMessage && <div className="text-xs text-muted-foreground">{apiMessage}</div>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>浮窗脚本</CardTitle>
              <CardDescription>TradingView 悬浮记录浮窗（Tampermonkey 用户脚本）。内置版随应用分发，并自动对照 GitHub main 分支——有新版直接复制新版</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex max-w-2xl flex-col">
                <SettingRow title="脚本版本" description="Tampermonkey → 新建脚本 → 粘贴全部内容 → 保存（Ctrl+S）；详细步骤见用户指南">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-1 font-mono text-xs ${widgetUpdate?.remoteNewer ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      v{widgetUpdate?.remoteNewer && widgetUpdate.remote ? widgetUpdate.remote.version : (widgetScript?.version ?? '…')}
                    </span>
                    <Button variant="outline" size="sm" disabled={!widgetScript} onClick={copyWidgetScript}>
                      {copiedWidgetScript ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                      {copiedWidgetScript ? '已复制' : widgetUpdate?.remoteNewer ? '复制最新版' : '复制脚本'}
                    </Button>
                  </div>
                </SettingRow>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {checkingWidget ? (
                    '正在从 GitHub 检查…'
                  ) : widgetUpdate?.remote ? (
                    widgetUpdate.remoteNewer ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        GitHub 有新版 v{widgetUpdate.remote.version}（应用内置 v{widgetUpdate.builtinVersion}），复制后将安装新版
                      </span>
                    ) : widgetUpdate.remote.version === widgetUpdate.builtinVersion ? (
                      `GitHub 与内置版本一致（v${widgetUpdate.builtinVersion}），已是最新`
                    ) : (
                      `GitHub 版本（v${widgetUpdate.remote.version}）尚未跟上应用内置版（v${widgetUpdate.builtinVersion}），复制内置版即可`
                    )
                  ) : (
                    <>
                      无法连接 GitHub，将复制应用内置版
                      <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={checkingWidget} onClick={runWidgetUpdateCheck}>
                        重试
                      </button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>端点速查</CardTitle>
              <CardDescription>供编写配套脚本使用；除 health 外均需 Bearer token</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">方法</TableHead>
                    <TableHead className="w-80">路径</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ['GET', '/api/v1/health', '探测服务，无需 token'],
                    ['GET', '/api/v1/accounts', '账户列表（含嵌套 Period），浮窗选择记录上下文'],
                    ['GET', '/api/v1/cases', 'Case 列表'],
                    ['POST', '/api/v1/cases', '创建 Case；title / accountId / periodId 必填；同 id 同内容幂等'],
                    ['GET', '/api/v1/cases/:id/cards', '该 Case 的 Card 列表'],
                    ['POST', '/api/v1/cases/:id/cards', '提交 Card；phase / rawText 必填，barRef 选填（缺省从原文提取 BAR 引用）；原文不可变，重复提交幂等'],
                    ['PUT', '/api/v1/cases/:id/cards/:cardId', '修正 Card；body 为 { rawText, barRef }（barRef: null 清除、缺省保持，1–1440）；旧表述自动存入 rawTextHistory'],
                    ['POST', '/api/v1/bindings', '建立 Case↔Trade 绑定；双向一对一'],
                    ['DELETE', '/api/v1/bindings/:id', '解除绑定'],
                    ['GET / POST', '/api/v1/case-tags', 'Case 标签查询与创建'],
                  ].map(([method, path, desc]) => (
                    <TableRow key={path}>
                      <TableCell className="font-mono text-xs">{method}</TableCell>
                      <TableCell className="font-mono text-xs">{path}</TableCell>
                      <TableCell className="text-muted-foreground">{desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">请求示例</h3>
                <pre className="overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`curl -X POST http://127.0.0.1:8787/api/v1/cases/case-1/cards \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "card-2026-0826-001",
    "phase": "intermediate",
    "rawText": "BAR41 出现顶部结构，走弱则离场",
    "barRef": 41
  }'`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle>AI 行为</CardTitle>
              <CardDescription>自动化触发时机；AI 调用失败都会自动重试一次</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingRow title="自动 AI 整理" description="浮窗/本地 API 提交新 Card 后自动在后台识别；失败重试一次后记日志，不打扰录制">
                <Switch
                  checked={aiAutoAnalyze}
                  disabled={!isTauriRuntime()}
                  onCheckedChange={(checked) => {
                    setAiAutoAnalyze(checked)
                    void saveAiSettings({ autoAnalyze: checked }).catch(() => undefined)
                  }}
                />
              </SettingRow>
            </CardContent>
          </Card>
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>AI Providers</CardTitle>
              <CardDescription>OpenAI compatible 接口配置；AI 识别与完整性检查将使用默认 Provider</CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isTauriRuntime()}
                  onClick={() => {
                    setEditingProvider(null)
                    setAiDialogOpen(true)
                  }}
                >
                  <Plus data-icon="inline-start" />
                  添加 Provider
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {aiProviders.length === 0 ? (
                <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span>还没有配置 AI Provider。</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  {aiProviders.map((provider) => (
                    <div key={provider.id} className="flex items-center gap-3 border-b py-3.5 last:border-b-0">
                      <AiProviderBadge presetId={provider.presetId} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{provider.name}</span>
                          {provider.isDefault && (
                            <Badge variant="secondary" className="gap-1">
                              <Star className="size-3" />
                              默认
                            </Badge>
                          )}
                        </div>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {provider.baseUrl}
                          {provider.defaultModel ? ` · ${provider.defaultModel}` : ''}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`编辑 ${provider.name}`}
                          onClick={() => {
                            setEditingProvider(provider)
                            setAiDialogOpen(true)
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${provider.name}`}
                          onClick={() => {
                            if (window.confirm(`删除 AI Provider「${provider.name}」？`)) {
                              void deleteAiProvider(provider.id).then(setAiProviders)
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>日志</CardTitle>
              <CardDescription>查看本地运行日志，排查启动、导入、备份和前端错误</CardDescription>
              <CardAction className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadLogs}>
                  <RefreshCw data-icon="inline-start" />
                  刷新
                </Button>
                <Button variant="outline" size="sm" disabled={!logs} onClick={copyLogs}>
                  {copiedLogs ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                  {copiedLogs ? '已复制' : '复制'}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {logPath && <div className="truncate rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">{logPath}</div>}
              <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                {logs || '点击“刷新”查看日志。'}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about">
          <Card>
            <CardContent className="flex min-h-[420px] flex-col items-center justify-center gap-5 text-center">
              <img src="/cairn-logo.svg" alt="" className="size-20 rounded-xl" />
              <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-semibold tracking-tight">CAIRN</h2>
                <p className="text-muted-foreground">Local-first trading journal desktop app.</p>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-2">
                <span className="font-mono text-sm font-medium">v{appVersion}</span>
                <Button variant="outline" size="sm" disabled={checkingUpdate || !isTauriRuntime()} onClick={checkForUpdate}>
                  <RefreshCw data-icon="inline-start" />
                  {checkingUpdate ? '检查中' : '检查更新'}
                </Button>
              </div>
              <div className="text-sm text-muted-foreground">{updateStatus}</div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <a className="transition-colors hover:text-foreground" href="https://github.com/lanbinleo/Cairn" target="_blank" rel="noreferrer">GitHub</a>
                <span>·</span>
                <a className="transition-colors hover:text-foreground" href="https://github.com/lanbinleo/Cairn/releases" target="_blank" rel="noreferrer">Releases</a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AiProviderDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        provider={editingProvider}
        onSaved={(providers) => {
          setAiProviders(providers)
          setAiDialogOpen(false)
        }}
      />
    </div>
  )
}
