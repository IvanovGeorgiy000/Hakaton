import { useEffect, useRef, useState } from 'react'
import { Loader2, VideoOff } from 'lucide-react'
import type { Camera } from '@/data'
import { Modal } from './ui/Modal'

/**
 * Живое видео в реальном времени по WebRTC (протокол WHEP).
 *
 * Браузер не умеет проигрывать RTSP напрямую, поэтому между камерой и приложением стоит шлюз mediamtx:
 * он забирает RTSP-поток камеры и отдаёт его как WebRTC. Шлюз запускается скриптом tools/live-view.sh
 * (спрашивает пароль камеры). Здесь мы только принимаем готовый WebRTC-поток и показываем его — задержка ~0.5 с.
 *
 * Адрес шлюза: VITE_WEBRTC_URL (по умолчанию http://localhost:8889).
 */
const GATEWAY: string = import.meta.env.VITE_WEBRTC_URL ?? 'http://localhost:8889'

/** По какому пути на шлюзе искать поток этой камеры. В демо все камеры RTSP идут через один поток «cam». */
function streamPathFor(_camera: Camera): string {
  return 'cam'
}

type State = 'connecting' | 'playing' | 'error'

function LivePlayer({ path }: { path: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<State>('connecting')

  useEffect(() => {
    let pc: RTCPeerConnection | null = null
    let resourceUrl = ''
    let stopped = false

    async function connect() {
      const conn = new RTCPeerConnection()
      pc = conn
      conn.addTransceiver('video', { direction: 'recvonly' })
      conn.addTransceiver('audio', { direction: 'recvonly' })
      conn.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]
      }
      conn.onconnectionstatechange = () => {
        if (stopped) return
        if (conn.connectionState === 'connected') setState('playing')
        else if (conn.connectionState === 'failed') setState('error')
      }

      const offer = await conn.createOffer()
      await conn.setLocalDescription(offer)
      // WHEP без trickle-ICE: дожидаемся сбора всех кандидатов (не дольше 1,5 с), затем отправляем предложение
      await new Promise<void>((resolve) => {
        if (conn.iceGatheringState === 'complete') return resolve()
        const finish = () => { clearTimeout(timer); conn.removeEventListener('icegatheringstatechange', check); resolve() }
        const check = () => { if (conn.iceGatheringState === 'complete') finish() }
        const timer = setTimeout(finish, 1500)
        conn.addEventListener('icegatheringstatechange', check)
      })
      if (stopped) return

      const whep = `${GATEWAY}/${path}/whep`
      const resp = await fetch(whep, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: conn.localDescription!.sdp })
      if (!resp.ok) throw new Error(`шлюз ответил ${resp.status}`)
      const location = resp.headers.get('Location')
      if (location) resourceUrl = new URL(location, whep).href
      // окно закрыли, пока шлюз отвечал: очистка уже прошла без адреса сессии — закрываем сессию сами
      if (stopped) {
        if (resourceUrl) fetch(resourceUrl, { method: 'DELETE' }).catch(() => {})
        return
      }
      const answer = await resp.text()
      if (stopped) return
      await conn.setRemoteDescription({ type: 'answer', sdp: answer })
    }

    connect().catch(() => { if (!stopped) setState('error') })

    return () => {
      stopped = true
      if (resourceUrl) fetch(resourceUrl, { method: 'DELETE' }).catch(() => {})
      pc?.close()
    }
  }, [path])

  return (
    <div className="relative w-full aspect-video bg-slate-950 rounded-lg overflow-hidden">
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain" />
      {state === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/85">
          <Loader2 className="w-8 h-8 animate-spin" /> Подключаемся к видео…
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85 p-6 text-center">
          <VideoOff className="w-9 h-9" />
          <div>
            <div className="font-semibold text-white">Живое видео не запущено</div>
            <p className="text-[14px] mt-1 max-w-sm">
              Запустите на сервере <span className="font-mono">tools/live-view.sh</span> и введите пароль камеры,
              затем откройте это окно снова.
            </p>
          </div>
        </div>
      )}
      {state === 'playing' && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1.5 bg-black/60 text-white text-[12px] font-medium px-2 py-0.5 rounded">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> В эфире
        </span>
      )}
    </div>
  )
}

/** Модальное окно с живым видео камеры */
export function LiveVideoModal({ camera, onClose }: { camera: Camera | null; onClose: () => void }) {
  return (
    <Modal open={!!camera} onClose={onClose} title={camera ? `${camera.name} — видео в реальном времени` : ''} wide>
      {camera && (
        <div className="space-y-3">
          <LivePlayer path={streamPathFor(camera)} />
          <p className="text-[13px] text-muted-foreground">
            Прямая трансляция с камеры по WebRTC через шлюз mediamtx. Задержка около полусекунды.
          </p>
        </div>
      )}
    </Modal>
  )
}
