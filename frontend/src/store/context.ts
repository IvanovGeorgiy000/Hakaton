import { createContext, useContext } from 'react'
import type {
  Alert, AlertStatus, Camera, CaptureResult, NewCamera, Role, RoleId, Rule, Site, SiteStatus, Snapshot, Stage, User, Zone,
} from '@/data'

export interface Toast { id: number; text: string; tone: 'ok' | 'error' }

export interface AppState {
  // ---- кто вошёл ----
  user: User | null
  role: Role | null
  /** Объект прораба (у остальных ролей — null) */
  ownSiteId: string | null
  login: (login: string, password: string) => Promise<void>
  demoLogin: (role: RoleId) => Promise<void>
  logout: () => void

  // ---- данные с сервера ----
  sites: Site[]
  zones: Zone[]
  cameras: Camera[]
  stages: Stage[]
  rules: Record<string, Rule>
  snapshots: Snapshot[]
  alerts: Alert[]
  /** Время самого свежего снимка — «данные на 12:30» */
  lastDataAt: string | null
  refresh: () => Promise<void>

  // ---- поиск по справочникам ----
  bySite: (id: string) => Site | undefined
  byZone: (id: string) => Zone | undefined
  byStage: (id: string | null) => Stage | undefined
  byCamera: (id: string | null) => Camera | undefined
  bySnapshot: (id: string) => Snapshot | undefined
  stagesOf: (siteId: string) => Stage[]
  /** Снимки камеры, от новых к старым */
  snapshotsOf: (cameraId: string) => Snapshot[]
  alertsForSite: (siteId: string) => Alert[]
  siteStatus: (siteId: string) => SiteStatus

  // ---- действия: возвращают true при успехе, об ошибке сообщают сами ----
  updateAlert: (id: string, status: AlertStatus, comment: string) => Promise<boolean>
  saveRule: (rule: Rule) => Promise<boolean>
  setCameraEnabled: (camera: Camera, enabled: boolean) => Promise<boolean>
  addCamera: (camera: NewCamera) => Promise<Camera>
  deleteCamera: (camera: Camera) => Promise<boolean>
  captureSite: (siteId: string) => Promise<CaptureResult | null>

  notify: (text: string, tone?: Toast['tone']) => void
  toasts: Toast[]
}

export const Ctx = createContext<AppState | null>(null)

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp вне AppProvider')
  return v
}
