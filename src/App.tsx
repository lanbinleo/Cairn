import { Route, Routes, useLocation } from 'react-router-dom'

import AccountsPage from '@/app/accounts/page'
import AccountDetailPage from '@/app/accounts/[accountId]/page'
import PeriodDetailPage from '@/app/accounts/[accountId]/periods/[periodId]/page'
import DashboardPage from '@/app/page'
import DataPage from '@/app/data/page'
import ImportPage from '@/app/import/page'
import NoteEditPage from '@/app/notes/[noteId]/edit/page'
import NotesPage from '@/app/notes/page'
import SettingsPage from '@/app/settings/page'
import NewTradePage from '@/app/trades/new/page'
import TradesPage from '@/app/trades/page'
import TradeDetailPage from '@/app/trades/[tradeId]/page'
import { AppSidebar } from '@/components/app-sidebar'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowTitlebar, shouldShowWindowTitlebar } from '@/components/window-titlebar'
import { CairnProvider } from '@/lib/store'
import { cn } from '@/lib/utils'

function AppRoutes() {
  const location = useLocation()
  return (
    <div key={location.pathname} className="animate-page-enter">
      <Routes location={location}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
        <Route path="/accounts/:accountId/periods/:periodId" element={<PeriodDetailPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/trades/new" element={<NewTradePage />} />
        <Route path="/trades/:tradeId" element={<TradeDetailPage />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:noteId/edit" element={<NoteEditPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  )
}

export function App() {
  const showTitlebar = shouldShowWindowTitlebar()
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <CairnProvider>
        <TooltipProvider>
          <WindowTitlebar />
          <AppSidebar />
          <main className={cn('min-h-svh pl-56', showTitlebar && 'pt-10')}>
            <div className="mx-auto max-w-6xl px-8 py-8">
              <AppRoutes />
            </div>
          </main>
        </TooltipProvider>
      </CairnProvider>
    </ThemeProvider>
  )
}
