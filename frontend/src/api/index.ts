import { request } from './client'
import type {
  Alert, AlertStatus, AnalyticsCatalog, AnalyzeResult, AuditEvent, Camera, CameraPatch, Connection, EquipmentCheckResult, LiveCamera, Meta, NewCamera,
  ProbeResult, RoleId, Rule, Sample, Site, SiteInput, SiteWork, Snapshot, Stage, StageInput, User, UserInput, UserPatch, WeeklyReport, Zone,
  ZoneInput,
} from '@/data'

export { ApiError, getFreshToken, getToken, mediaUrl, setToken, setTokenRefresher, UNAUTHORIZED_EVENT, wsUrl } from './client'

interface Session { token: string; user: User }

function analyzeForm(fields: { image?: File; sample?: string; siteId?: string; ruleKey?: string }): FormData {
  const form = new FormData()
  if (fields.image) form.append('image', fields.image)
  for (const key of ['sample', 'siteId', 'ruleKey'] as const) {
    if (fields[key]) form.append(key, fields[key])
  }
  return form
}

const query = (params: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return q ? `?${q}` : ''
}

export const api = {
  meta: () => request<Meta>('GET', '/meta'),

  login: (login: string, password: string) => request<Session>('POST', '/auth/login', { login, password }),
  demoLogin: (role: RoleId) => request<Session>('POST', '/auth/demo-login', { role }),
  me: () => request<User>('GET', '/auth/me'),

  sites: () => request<Site[]>('GET', '/sites'),
  zones: () => request<Zone[]>('GET', '/zones'),
  stages: () => request<Stage[]>('GET', '/stages'),
  rules: () => request<Rule[]>('GET', '/rules'),
  saveRule: (rule: Rule) => request<Rule>('PUT', `/rules/${rule.key}`, rule),

  cameras: () => request<Camera[]>('GET', '/cameras'),
  probeCamera: (connection: Connection) => request<ProbeResult>('POST', '/cameras/probe', connection),
  closeProbe: (path: string) => request<void>('DELETE', `/cameras/probe/${path}`),
  addCamera: (camera: NewCamera) => request<Camera>('POST', '/cameras', camera),
  patchCamera: (id: string, patch: CameraPatch) => request<Camera>('PATCH', `/cameras/${id}`, patch),
  deleteCamera: (id: string) => request<void>('DELETE', `/cameras/${id}`),
  testCamera: (id: string) => request<ProbeResult>('POST', `/cameras/${id}/test`),
  /** Что видит анализ на камерах прямо сейчас */
  live: (siteId?: string) => request<LiveCamera[]>('GET', `/live${query({ siteId })}`),

  snapshots: () => request<Snapshot[]>('GET', '/snapshots?perCamera=8'),
  alerts: () => request<Alert[]>('GET', '/alerts'),
  alertAction: (id: string, status: AlertStatus, comment: string, dueDate?: string) =>
    request<Alert>('POST', `/alerts/${id}/actions`, { status, comment, dueDate }),

  equipmentCheck: (siteId: string) => request<EquipmentCheckResult>('GET', `/sites/${siteId}/equipment-check`),
  /** Работы по камерам: последние ответы сервисов аналитики по кадрам камер рабочих зон */
  siteWork: (siteId: string) => request<SiteWork>('GET', `/sites/${siteId}/work-analysis`),
  /** Отправить свежие кадры сервисам сейчас — ответы придут в фоне (по снимку — до нескольких минут) */
  runSiteWork: (siteId: string) => request<SiteWork>('POST', `/sites/${siteId}/work-analysis`),
  /** Виды работ справочника сервисов аналитики — для плана объекта */
  analyticsCatalog: (siteId: string) => request<AnalyticsCatalog>('GET', `/analytics/catalog${query({ siteId })}`),
  weeklyReport: () => request<WeeklyReport>('GET', '/reports/weekly'),

  samples: () => request<Sample[]>('GET', '/analyze/samples'),
  analyze: (fields: { image?: File; sample?: string; siteId: string }) => request<AnalyzeResult>('POST', '/analyze', analyzeForm(fields)),

  publicDemo: () => request<{ rules: Rule[]; samples: Sample[]; provider: string }>('GET', '/public/demo'),
  publicAnalyze: (fields: { image?: File; sample?: string; ruleKey: string }) =>
    request<AnalyzeResult>('POST', '/public/analyze', analyzeForm(fields)),

  // ---------- администрирование ----------
  createSite: (site: SiteInput) => request<Site>('POST', '/sites', site),
  updateSite: (id: string, site: SiteInput) => request<Site>('PATCH', `/sites/${id}`, site),
  deleteSite: (id: string) => request<void>('DELETE', `/sites/${id}`),
  createZone: (siteId: string, zone: ZoneInput) => request<Zone>('POST', `/sites/${siteId}/zones`, zone),
  updateZone: (id: string, zone: ZoneInput) => request<Zone>('PATCH', `/zones/${id}`, zone),
  deleteZone: (id: string) => request<void>('DELETE', `/zones/${id}`),
  createStage: (siteId: string, stage: StageInput) => request<Stage>('POST', `/sites/${siteId}/stages`, stage),
  updateStage: (id: string, stage: StageInput) => request<Stage>('PATCH', `/stages/${id}`, stage),
  deleteStage: (id: string) => request<void>('DELETE', `/stages/${id}`),
  setStageProgress: (id: string, factProgress: number) => request<Stage>('PATCH', `/stages/${id}/progress`, { factProgress }),

  users: () => request<User[]>('GET', '/users'),
  createUser: (user: UserInput) => request<User>('POST', '/users', user),
  updateUser: (id: string, patch: UserPatch) => request<User>('PATCH', `/users/${id}`, patch),
  setPassword: (id: string, password: string) => request<void>('POST', `/users/${id}/password`, { password }),
  deleteUser: (id: string) => request<void>('DELETE', `/users/${id}`),

  audit: (filters: { action?: string; actor?: string; q?: string; beforeId?: number; limit?: number }) =>
    request<AuditEvent[]>('GET', `/audit${query(filters)}`),
}
