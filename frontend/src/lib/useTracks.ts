/**
 * Рамки техники в реальном времени (сервис разметки → сервер → браузер по WebSocket /api/tracks).
 *
 * Одно подключение на вкладку, сколько бы плиток ни было открыто: каждая плитка подписывается на свою камеру,
 * а серверу уходит список камер «на экране» — лишние рамки по сети не гоняем.
 * Токен уходит первым сообщением, а не в адресе: адреса попадают в журналы сервера и nginx.
 * Трек, пропавший на одно-два сообщения, ещё немного держим — иначе рамка мигала бы.
 * Если по камере давно ничего нет, считаем, что данных нет (null), — тогда плитка покажет рамки из анализа кадров.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { getFreshToken, getToken, wsUrl } from '@/api'
import type { EquipmentType } from '@/data'

export interface TrackObject {
  trackId: string
  type: EquipmentType
  confidence: number
  box: { x: number; y: number; w: number; h: number }
}

interface TrackMessage { cameraId: string; ts: string | null; objects: TrackObject[] }

const HOLD_MS = 400  // трек не пришёл — держим рамку ещё столько
const STALE_MS = 1500  // по камере ничего нет дольше — данных нет
const RETRY_MIN_MS = 1000, RETRY_MAX_MS = 30_000
const LINGER_MS = 5000  // все плитки закрылись — подключение держим ещё немного: вдруг сразу откроют другую

class TrackHub {
  private ws: WebSocket | null = null
  private token: string | null = null  // с каким входом открыто подключение: сменился пользователь — переподключаемся
  private wanted = new Map<string, number>()  // камера → сколько компонентов на неё подписано
  private listeners = new Map<string, Set<() => void>>()
  /** Камера → рамки. Нет записи — данных нет; пустой список — сервис сообщил, что техники в кадре нет */
  private frames = new Map<string, TrackObject[]>()
  private seen = new Map<string, Map<string, { obj: TrackObject; at: number }>>()
  private staleTimers = new Map<string, number>()
  private retry = RETRY_MIN_MS
  private retryTimer: number | undefined
  private lingerTimer: number | undefined
  private disabled = false  // сервер ответил «сервис разметки не подключён» — не стучимся зря

  subscribe(cameraId: string, listener: () => void) {
    this.wanted.set(cameraId, (this.wanted.get(cameraId) ?? 0) + 1)
    let set = this.listeners.get(cameraId)
    if (!set) this.listeners.set(cameraId, (set = new Set()))
    set.add(listener)
    window.clearTimeout(this.lingerTimer)
    if (this.ws && getToken() !== this.token) this.close()  // вышли и вошли другим пользователем, пока сокет ещё жил
    this.ensureOpen()
    this.sendWanted()
    return () => {
      set.delete(listener)
      const n = (this.wanted.get(cameraId) ?? 1) - 1
      if (n > 0) this.wanted.set(cameraId, n)
      else {
        this.wanted.delete(cameraId)
        this.drop(cameraId)
      }
      this.sendWanted()
      if (!this.wanted.size) this.lingerTimer = window.setTimeout(() => this.close(), LINGER_MS)
    }
  }

  get(cameraId: string): TrackObject[] | null {
    return this.frames.get(cameraId) ?? null
  }

  private ensureOpen() {
    if (this.ws || this.disabled || this.retryTimer !== undefined) return
    void this.open()
  }

  private async open() {
    const token = await getFreshToken()
    if (!token || !this.wanted.size || this.ws) return
    const ws = new WebSocket(wsUrl('/tracks'))
    this.ws = ws
    this.token = token
    ws.onopen = () => {
      this.retry = RETRY_MIN_MS
      ws.send(JSON.stringify({ token, subscribe: [...this.wanted.keys()] }))
    }
    ws.onmessage = (e) => {
      try { this.receive(JSON.parse(e.data as string) as TrackMessage) } catch { /* кривое сообщение пропускаем */ }
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (e.code === 4404) { this.disabled = true; return }  // сервис разметки не подключён
      if (!this.wanted.size) return
      // 4401 — токен истёк или сменился: при повторе возьмём свежий
      this.retryTimer = window.setTimeout(() => { this.retryTimer = undefined; this.ensureOpen() }, this.retry)
      this.retry = Math.min(this.retry * 2, RETRY_MAX_MS)
    }
  }

  private close() {
    window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const ws = this.ws
    this.ws = null
    this.token = null
    ws?.close()
  }

  private sendWanted() {
    // до onopen список уйдёт вместе с токеном; после — отдельным сообщением
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ subscribe: [...this.wanted.keys()] }))
  }

  private receive(msg: TrackMessage) {
    if (!this.wanted.has(msg.cameraId)) return
    const now = performance.now()
    const tracks = this.seen.get(msg.cameraId) ?? new Map()
    for (const obj of msg.objects) tracks.set(obj.trackId, { obj, at: now })
    for (const [id, t] of tracks) if (now - t.at > HOLD_MS) tracks.delete(id)
    this.seen.set(msg.cameraId, tracks)
    this.frames.set(msg.cameraId, [...tracks.values()].map((t) => t.obj))
    this.notify(msg.cameraId)
    window.clearTimeout(this.staleTimers.get(msg.cameraId))
    this.staleTimers.set(msg.cameraId, window.setTimeout(() => this.drop(msg.cameraId), STALE_MS))
  }

  private drop(cameraId: string) {
    window.clearTimeout(this.staleTimers.get(cameraId))
    this.staleTimers.delete(cameraId)
    this.seen.delete(cameraId)
    if (this.frames.delete(cameraId)) this.notify(cameraId)
  }

  private notify(cameraId: string) {
    this.listeners.get(cameraId)?.forEach((fn) => fn())
  }
}

const hub = new TrackHub()

/**
 * Рамки камеры прямо сейчас: список (может быть пустым — техники нет) или null — от сервиса разметки данных нет.
 * cameraId = null — не подписываться.
 */
export function useTracks(cameraId: string | null): TrackObject[] | null {
  // подписка — та же функция, пока камера та же: иначе каждый рендер переподписывал бы плитку
  const subscribe = useCallback((fn: () => void) => (cameraId ? hub.subscribe(cameraId, fn) : () => {}), [cameraId])
  return useSyncExternalStore(subscribe, () => (cameraId ? hub.get(cameraId) : null))
}
