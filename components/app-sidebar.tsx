'use client'

import { Link, useLocation } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Wallet,
  ChartCandlestick,
  MessagesSquare,
  Database,
  NotebookPen,
  Upload,
  Settings,
  Sun,
  Moon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/', label: '总览', icon: LayoutDashboard },
  { href: '/accounts', label: '账户', icon: Wallet },
  { href: '/trades', label: '交易', icon: ChartCandlestick },
  { href: '/cases', label: '案例', icon: MessagesSquare },
  { href: '/data', label: '数据', icon: Database },
  { href: '/notes', label: '笔记', icon: NotebookPen },
  { href: '/import', label: '导入', icon: Upload },
  { href: '/settings', label: '设置', icon: Settings },
]

export function AppSidebar() {
  const { pathname } = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <img src="/cairn-logo.svg" alt="" className="size-8 rounded-lg" />
        <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">Cairn</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 pt-4" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="size-4.5 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border px-5 py-4">
        <span className="text-xs text-muted-foreground">交易复盘日志</span>
        {mounted ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        ) : (
          <div className="size-8" aria-hidden="true" />
        )}
      </div>
    </aside>
  )
}
