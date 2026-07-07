'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { PageHeader } from '@/components/page-header'
import { CreateSymbolDialog } from '@/components/create-symbol-dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useCairn } from '@/lib/store'

const categoryLabel: Record<string, string> = {
  crypto: '加密货币',
  forex: '外汇',
  futures: '期货',
  stock: '股票',
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { symbols, trades } = useCairn()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <PageHeader title="品种与设置" description="管理交易品种与应用偏好" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">品种</CardTitle>
          <CardDescription>
            导入数据时必须选择品种归属；品种以「交易所:代码」唯一标识
          </CardDescription>
          <CreateSymbolDialog />
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">偏好</CardTitle>
          <CardDescription>显示与时间相关的全局设置</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-md flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="theme-select">主题</Label>
              <span className="text-xs text-muted-foreground">浅色 / 深色 / 跟随系统</span>
            </div>
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
                <SelectTrigger id="theme-select" className="w-36">
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
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="tz-select">时间基准</Label>
              <span className="text-xs text-muted-foreground">
                所有时间统一以 UTC 存储与展示，一天从 UTC 00:00 开始
              </span>
            </div>
            <Select items={[{ value: 'utc', label: 'UTC' }]} value="utc" disabled>
              <SelectTrigger id="tz-select" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="utc">UTC</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="tf-select">默认录入周期</Label>
              <span className="text-xs text-muted-foreground">
                手动录入时 Bar 序号 ↔ 时间换算的默认周期（5m 一天 288 根）
              </span>
            </div>
            <Select
              items={[
                { value: '1', label: '1 分钟' },
                { value: '5', label: '5 分钟' },
                { value: '15', label: '15 分钟' },
                { value: '60', label: '1 小时' },
              ]}
              defaultValue="5"
            >
              <SelectTrigger id="tf-select" className="w-36">
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
