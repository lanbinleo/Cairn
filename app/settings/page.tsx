'use client'

import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { CreateSymbolDialog } from '@/components/create-symbol-dialog'
import { BackupCard } from '@/components/backup-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!isTauriRuntime()) return
    void invoke<string>('get_app_version').then(setAppVersion).catch(() => undefined)
    void invoke<string>('get_log_path').then(setLogPath).catch(() => undefined)
  }, [])

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
    </div>
  )
}
