import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Home, Camera, CalendarDays, Building2, Bell, ScanSearch, ClipboardList, BarChart3, ListChecks, Users } from 'lucide-react'
import { AppProvider } from '@/store/AppContext'
import { ThemeProvider } from '@/store/theme'
import { useApp } from '@/store/context'
import { AppShell, type NavItem } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { Help } from '@/pages/Help'
import { MinimalDemo } from '@/pages/MinimalDemo'
import { ForemanToday } from '@/pages/foreman/Today'
import { ForemanCameras } from '@/pages/foreman/Cameras'
import { ForemanPlan } from '@/pages/foreman/Plan'
import { ManagerOverview } from '@/pages/manager/Overview'
import { ManagerSite } from '@/pages/manager/SiteDetail'
import { ManagerAlerts } from '@/pages/manager/Alerts'
import { CheckSnapshot } from '@/pages/manager/CheckSnapshot'
import { InspectorViolations } from '@/pages/inspector/Violations'
import { InspectorReports } from '@/pages/inspector/Reports'
import { AdminRules } from '@/pages/admin/Rules'
import { AdminCameras } from '@/pages/admin/Cameras'
import { AdminUsers } from '@/pages/admin/Users'

const NAV: Record<string, NavItem[]> = {
  foreman: [
    { to: '/foreman', label: 'Сегодня', Icon: Home, end: true },
    { to: '/foreman/cameras', label: 'Камеры', Icon: Camera },
    { to: '/foreman/plan', label: 'План', Icon: CalendarDays },
  ],
  manager: [
    { to: '/manager', label: 'Объекты', Icon: Building2, end: true },
    { to: '/manager/alerts', label: 'Отклонения', Icon: Bell },
    { to: '/manager/check', label: 'Проверить фото', Icon: ScanSearch },
  ],
  inspector: [
    { to: '/inspector', label: 'Нарушения', Icon: ClipboardList, end: true },
    { to: '/inspector/reports', label: 'Отчёты', Icon: BarChart3 },
  ],
  admin: [
    { to: '/admin', label: 'Правила', Icon: ListChecks, end: true },
    { to: '/admin/cameras', label: 'Камеры', Icon: Camera },
    { to: '/admin/users', label: 'Сотрудники', Icon: Users },
  ],
}

/** Куда ведёт колокольчик уведомлений для каждой роли */
const ALERTS_PATH: Record<string, string> = { foreman: '/foreman', manager: '/manager/alerts', inspector: '/inspector', admin: '/admin' }

function Router() {
  const { role } = useApp()
  const home = role ? `/${role.id}` : '/'
  return (
    <Routes>
      {/* Минимальная страница по ТЗ — доступна без выбора роли */}
      <Route path="/demo" element={<MinimalDemo />} />
      {!role && <Route path="*" element={<Login />} />}
      {role && (
      <Route element={<AppShell nav={NAV[role.id]} alertsPath={ALERTS_PATH[role.id]} />}>
        <Route path="/help" element={<Help />} />
        {role.id === 'foreman' && (
          <>
            <Route path="/foreman" element={<ForemanToday />} />
            <Route path="/foreman/cameras" element={<ForemanCameras />} />
            <Route path="/foreman/plan" element={<ForemanPlan />} />
          </>
        )}
        {role.id === 'manager' && (
          <>
            <Route path="/manager" element={<ManagerOverview />} />
            <Route path="/manager/site/:id" element={<ManagerSite />} />
            <Route path="/manager/alerts" element={<ManagerAlerts />} />
            <Route path="/manager/check" element={<CheckSnapshot />} />
          </>
        )}
        {role.id === 'inspector' && (
          <>
            <Route path="/inspector" element={<InspectorViolations />} />
            <Route path="/inspector/reports" element={<InspectorReports />} />
          </>
        )}
        {role.id === 'admin' && (
          <>
            <Route path="/admin" element={<AdminRules />} />
            <Route path="/admin/cameras" element={<AdminCameras />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
      )}
    </Routes>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
})

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppProvider>
            <Router />
          </AppProvider>
        </BrowserRouter>
      </QueryClientProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}
