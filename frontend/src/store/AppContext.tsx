import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Ctx, type AppState } from './context'
import {
  ALERTS, CAMERAS, CURRENT_USER_BY_ROLE, ROLES, RULES, SITES,
  type Alert, type AlertStatus, type Camera, type Role, type RoleId, type Rule, type RuleKey, type SiteStatus,
} from '@/data'
import { isOpen, roleTitle } from './selectors'


const NOW_ISO = '2026-09-15T12:40:00+03:00'

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(() => {
    try { return ROLES.find((r) => r.id === localStorage.getItem('sk-role')) ?? null } catch { return null }
  })
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS)
  const [rules, setRules] = useState<Record<RuleKey, Rule>>(RULES)
  const [cameras, setCameras] = useState<Camera[]>(CAMERAS)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const user = role ? CURRENT_USER_BY_ROLE[role.id] : null

  const login = useCallback((roleId: RoleId) => {
    setRole(ROLES.find((r) => r.id === roleId) ?? null)
    try { localStorage.setItem('sk-role', roleId) } catch { /* приватный режим — не страшно */ }
  }, [])
  const logout = useCallback(() => {
    setRole(null)
    try { localStorage.removeItem('sk-role') } catch { /* ignore */ }
  }, [])

  const updateAlert = useCallback((id: string, status: AlertStatus, comment: string) => {
    setAlerts((prev) => prev.map((a) => {
      if (a.id !== id) return a
      const who = user ? `${user.name} (${roleTitle(user.role).toLowerCase()})` : 'Пользователь'
      return { ...a, status, history: [...a.history, { at: NOW_ISO, who, text: comment }] }
    }))
  }, [user])

  const updateRule = useCallback((key: RuleKey, rule: Rule) => {
    setRules((prev) => ({ ...prev, [key]: rule }))
  }, [])

  const toggleCamera = useCallback((id: string) => {
    setCameras((prev) => prev.map((c) => (c.id === id ? { ...c, online: !c.online } : c)))
  }, [])

  const visibleSites = useMemo(() => {
    if (!role) return []
    if (role.siteId) return SITES.filter((s) => s.id === role.siteId)
    return SITES
  }, [role])

  const alertsForSite = useCallback((siteId: string) => alerts.filter((a) => a.siteId === siteId), [alerts])

  const siteStatus = useCallback((siteId: string): SiteStatus => {
    const open = alerts.filter((a) => a.siteId === siteId && isOpen(a.status))
    if (open.some((a) => a.severity === 'high')) return 'critical'
    if (open.length > 0) return 'warning'
    return 'ok'
  }, [alerts])

  const value: AppState = {
    role, user, alerts, rules, cameras, login, logout, updateAlert, updateRule, toggleCamera, notify, toasts,
    visibleSites, siteStatus, alertsForSite,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

