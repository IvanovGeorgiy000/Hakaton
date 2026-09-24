/**
 * Живое видео камер: WebRTC (протокол WHEP) через шлюз mediamtx.
 *
 * Браузер не умеет RTSP, поэтому видео с камер забирает шлюз и раздаёт по WebRTC — задержка около полусекунды.
 * Кто может смотреть поток, шлюз спрашивает у сервера: браузер передаёт тот же токен, что и в запросах к API.
 */
import { useEffect, useRef, useState } from 'react'
import { getFreshToken } from '@/api'
import type { Camera, LiveCamera, Meta } from '@/data'

export type StreamState = 'idle' | 'connecting' | 'playing' | 'error'

const RETRY_MS = 10_000 // видео прервалось — пробуем снова: камера могла вернуться
const RETRY_MAX_MS = 60_000 // камера молчит долго — пробуем реже, но не реже раза в минуту
// «disconnected» у WebRTC обычно временный (моргнула сеть, телефон сменил вышку) и сам проходит за пару секунд
const DISCONNECT_GRACE_MS = 5_000

/**
 * Адрес шлюза из настроек сервера. Если сервер назвал его «localhost», а приложение открыто по адресу в сети
 * (например, с телефона), подставляем этот адрес — иначе телефон искал бы шлюз у себя.
 */
export function gatewayUrl(meta: Meta | undefined): string | null {
  if (!meta?.video.enabled) return null
  // относительный адрес (/webrtc за тем же nginx) считаем от адреса приложения; без второго аргумента new URL упал бы
  const url = new URL(meta.video.webrtcUrl, window.location.origin)
  if (['localhost', '127.0.0.1'].includes(url.hostname) && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    url.hostname = window.location.hostname
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}

export function whepUrl(meta: Meta | undefined, streamPath: string): string | null {
  const base = gatewayUrl(meta)
  return base ? `${base}/${streamPath}/whep` : null
}

/** Подключиться к потоку (url = null — отключиться). Возвращает ссылку для <video> и состояние. */
export function useWhep(url: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // состояние помнит, к какому адресу и какой попытке относится: сменился адрес или пошла новая попытка —
  // пока это «подключаемся» (раньше при повторе всё время переподключения висело «нет сигнала»)
  const [status, setStatus] = useState<{ url: string; attempt: number; state: StreamState } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)  // неудачи подряд: от них растёт пауза перед повтором; видео пошло — счёт с нуля

  useEffect(() => {
    if (!url) return
    let stopped = false
    let resourceUrl = ''
    let pc: RTCPeerConnection | null = null
    let retry: number | undefined
    let grace: number | undefined
    const setState = (state: StreamState) => setStatus({ url, attempt, state })

    const dropSession = () => {
      if (resourceUrl) fetch(resourceUrl, { method: 'DELETE' }).catch(() => {})
      resourceUrl = ''
    }
    const fail = () => {
      if (stopped) return
      setState('error')
      dropSession()
      pc?.close()
      window.clearTimeout(retry)
      window.clearTimeout(grace)
      const pause = Math.min(RETRY_MS * 2 ** Math.min(failures.current, 3), RETRY_MAX_MS)
      failures.current += 1
      retry = window.setTimeout(() => setAttempt((n) => n + 1), pause)
    }

    async function connect(target: string) {
      const conn = new RTCPeerConnection()
      pc = conn
      conn.addTransceiver('video', { direction: 'recvonly' })
      conn.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
      }
      conn.onconnectionstatechange = () => {
        if (stopped) return
        window.clearTimeout(grace)
        if (conn.connectionState === 'connected') { failures.current = 0; setState('playing') }
        else if (conn.connectionState === 'failed') fail()
        else if (conn.connectionState === 'disconnected') grace = window.setTimeout(fail, DISCONNECT_GRACE_MS)
      }
      await conn.setLocalDescription(await conn.createOffer())
      // WHEP без trickle-ICE: ждём сбора кандидатов (не дольше 1,5 с), затем отправляем предложение целиком
      await new Promise<void>((resolve) => {
        if (conn.iceGatheringState === 'complete') return resolve()
        const finish = () => { window.clearTimeout(timer); conn.removeEventListener('icegatheringstatechange', check); resolve() }
        const check = () => { if (conn.iceGatheringState === 'complete') finish() }
        const timer = window.setTimeout(finish, 1500)
        conn.addEventListener('icegatheringstatechange', check)
      })
      if (stopped) return

      const headers: Record<string, string> = { 'Content-Type': 'application/sdp' }
      const token = await getFreshToken()  // в режиме Keycloak токен мог истечь, пока открыта страница
      if (stopped) return
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(target, { method: 'POST', headers, body: conn.localDescription!.sdp })
      if (!response.ok) throw new Error(`шлюз ответил ${response.status}`)
      const location = response.headers.get('Location')
      if (location) resourceUrl = new URL(location, target).href
      if (stopped) return dropSession() // закрыли, пока шлюз отвечал
      const answer = await response.text()
      if (stopped) return
      await conn.setRemoteDescription({ type: 'answer', sdp: answer })
    }

    connect(url).catch(fail)
    return () => {
      stopped = true
      window.clearTimeout(retry)
      window.clearTimeout(grace)
      dropSession()
      pc?.close()
    }
  }, [url, attempt])

  const state: StreamState = !url ? 'idle' : status?.url === url && status.attempt === attempt ? status.state : 'connecting'
  return { videoRef, state }
}

/** Что показать на плитке камеры: в эфире, подключаемся, нет сигнала, выключена */
export type TileStatus = 'live' | 'connecting' | 'offline' | 'disabled'

export function tileStatus(camera: Camera, live: LiveCamera | undefined, state: StreamState): TileStatus {
  if (!camera.enabled) return 'disabled'
  if (state === 'playing') return 'live'
  if (state === 'error' || (live && !live.online && state !== 'connecting')) return 'offline'
  return 'connecting'
}

/** Элемент на экране (с запасом) — только тогда держим видео: десятки невидимых потоков зря грузят сеть */
export function useInView<T extends Element>(margin = '150px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: margin })
    observer.observe(el)
    return () => observer.disconnect()
  }, [margin])
  return { ref, inView }
}

/** Вкладка на виду? Свернули или ушли на другую — видео отключаем */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}
