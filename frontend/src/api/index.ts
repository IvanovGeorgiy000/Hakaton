import { request } from './client'
import type {
  Alert, AlertStatus, AnalyzeResult, Camera, CaptureResult, Connection, EquipmentCheckResult, Meta, NewCamera, ProbeResult,
  RoleId, Rule, Sample, Site, Snapshot, Stage, User, WeeklyReport, Zone,
} from '@/data'

export { ApiError, getToken, mediaUrl, setToken, UNAUTHORIZED_EVENT } from './client'

interface Session { token: string; user: User }

function analyzeForm(fields: { image?: File; sample?: string; siteId?: string; ruleKey?: string }): FormData {
  const form = new FormData()
  if (fields.image) form.append('image', fields.image)
  for (const key of ['sample', 'siteId', 'ruleKey'] as const) {
    if (fields[key]) form.append(key, fields[key])
  }
  return form
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
  users: () => request<User[]>('GET', '/users'),

  cameras: () => request<Camera[]>('GET', '/cameras'),
  probeCamera: (connection: Connection) => request<ProbeResult>('POST', '/cameras/probe', connection),
  addCamera: (camera: NewCamera) => request<Camera>('POST', '/cameras', camera),
  patchCamera: (id: string, patch: { enabled?: boolean; name?: string }) => request<Camera>('PATCH', `/cameras/${id}`, patch),
  deleteCamera: (id: string) => request<void>('DELETE', `/cameras/${id}`),
  testCamera: (id: string) => request<ProbeResult>('POST', `/cameras/${id}/test`),

  snapshots: () => request<Snapshot[]>('GET', '/snapshots?perCamera=8'),
  alerts: () => request<Alert[]>('GET', '/alerts'),
  alertAction: (id: string, status: AlertStatus, comment: string) =>
    request<Alert>('POST', `/alerts/${id}/actions`, { status, comment }),

  equipmentCheck: (siteId: string) => request<EquipmentCheckResult>('GET', `/sites/${siteId}/equipment-check`),
  captureSite: (siteId: string) => request<CaptureResult>('POST', `/sites/${siteId}/capture`),
  weeklyReport: () => request<WeeklyReport>('GET', '/reports/weekly'),

  samples: () => request<Sample[]>('GET', '/analyze/samples'),
  analyze: (fields: { image?: File; sample?: string; siteId: string }) => request<AnalyzeResult>('POST', '/analyze', analyzeForm(fields)),

  publicDemo: () => request<{ rules: Rule[]; samples: Sample[]; provider: string }>('GET', '/public/demo'),
  publicAnalyze: (fields: { image?: File; sample?: string; ruleKey: string }) =>
    request<AnalyzeResult>('POST', '/public/analyze', analyzeForm(fields)),
}
