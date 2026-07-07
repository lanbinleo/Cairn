import { Route, Routes } from 'react-router-dom'

import AccountsPage from '@/app/accounts/page'
import AccountDetailPage from '@/app/accounts/[accountId]/page'
import PeriodDetailPage from '@/app/accounts/[accountId]/periods/[periodId]/page'
import DashboardPage from '@/app/page'
import DataPage from '@/app/data/page'
import ImportPage from '@/app/import/page'
import NoteEditPage from '@/app/notes/[noteId]/edit/page'
import NotesPage from '@/app/notes/page'
import SettingsPage from '@/app/settings/page'
import TradesPage from '@/app/trades/page'
import TradeDetailPage from '@/app/trades/[tradeId]/page'
import { AppSidebar } from '@/components/app-sidebar'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CairnProvider } from '@/lib/store'

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <CairnProvider>
        <TooltipProvider>
          <AppSidebar />
          <main className="min-h-svh pl-56">
            <div className="mx-auto max-w-6xl px-8 py-8">
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
                <Route path="/accounts/:accountId/periods/:periodId" element={<PeriodDetailPage />} />
                <Route path="/trades" element={<TradesPage />} />
                <Route path="/trades/:tradeId" element={<TradeDetailPage />} />
                <Route path="/data" element={<DataPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:noteId/edit" element={<NoteEditPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
          </main>
        </TooltipProvider>
      </CairnProvider>
    </ThemeProvider>
  )
}
