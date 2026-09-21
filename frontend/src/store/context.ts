import { createContext, useContext } from 'react'
import type { Alert, AlertStatus, Camera, Role, RoleId, Rule, RuleKey, Site, SiteStatus, User } from '@/data'

export interface AppState {
  role: Role | null
  user: User | null
  alerts: Alert[]
  rules: Record<RuleKey, Rule>
  cameras: Camera[]
  login: (roleId: RoleId) => void
  logout: () => void
  /** Изменить статус отклонения и записать событие в историю */
  updateAlert: (id: string, status: AlertStatus, comment: string) => void
  updateRule: (key: RuleKey, rule: Rule) => void
  toggleCamera: (id: string) => void
  /** Короткое всплывающее подтверждение действия */
  notify: (text: string) => void
  toasts: { id: number; text: string }[]
  /** Объекты, доступные текущей роли */
  visibleSites: Site[]
  siteStatus: (siteId: string) => SiteStatus
  alertsForSite: (siteId: string) => Alert[]
}

export const Ctx = createContext<AppState | null>(null)

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp вне AppProvider')
  return v
}
