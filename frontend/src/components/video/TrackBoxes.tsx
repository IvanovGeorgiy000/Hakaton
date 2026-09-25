import { AnimatePresence, motion } from 'framer-motion'
import { EQUIPMENT, type LiveCamera } from '@/data'
import { useApp } from '@/store/context'
import { trackPace, useTracks, type TrackObject } from '@/lib/useTracks'
import { cn, inkOn } from '@/lib/utils'
import { DetectionBoxes } from './DetectionBoxes'

/**
 * Рамки поверх живого видео. Есть рамки в реальном времени (модель на сервере разбирает видео камеры 5–8 раз в секунду
 * или их шлёт внешний сервис разметки) — они едут за техникой; нет — рамки из анализа кадров раз в 2 секунды.
 */
export function LiveBoxes({ cameraId, live, labels = true }: { cameraId: string; live?: LiveCamera; labels?: boolean }) {
  const { meta } = useApp()
  const tracks = useTracks(meta?.tracker?.enabled ? cameraId : null)
  // по камере идут рамки в реальном времени (даже «техники нет») — верим им; нет — рамки из анализа кадров
  if (tracks) return <TrackBoxes tracks={tracks} labels={labels} pace={trackPace(cameraId)} />
  return live ? <DetectionBoxes detections={live.detections} labels={labels} /> : null
}

/**
 * Каждая рамка привязана к своему track_id: между сообщениями она линейно доезжает до нового положения
 * за время, равное промежутку между сообщениями (pace, мс), — поэтому едет ровно, а не прыгает.
 * При «уменьшить движение» (MotionConfig в App) рамка сразу встаёт на место.
 */
function TrackBoxes({ tracks, labels, pace }: { tracks: TrackObject[]; labels: boolean; pace: number }) {
  const glide = Math.min(Math.max(pace, 80), 500) / 1000
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      <AnimatePresence initial={false}>
        {tracks.map((t) => {
          const info = EQUIPMENT[t.type]
          return (
            <motion.div
              key={t.trackId} className="absolute"
              initial={{ opacity: 0, left: `${t.box.x}%`, top: `${t.box.y}%`, width: `${t.box.w}%`, height: `${t.box.h}%` }}
              animate={{ opacity: 1, left: `${t.box.x}%`, top: `${t.box.y}%`, width: `${t.box.w}%`, height: `${t.box.h}%` }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: glide, ease: 'linear', opacity: { duration: 0.15 } }}
              style={{ border: `2px solid ${info.color}`, boxShadow: '0 0 0 1px rgba(0,0,0,.45)' }}
            >
              {labels && (
                <span
                  className={cn('absolute -left-[2px] text-[11px] leading-none font-semibold px-1.5 py-[3px] whitespace-nowrap font-mono', t.box.y >= 8 ? '-top-[19px]' : 'top-0')}
                  style={{ background: info.color, color: inkOn(info.color) }}
                >
                  {info.name} {Math.round(t.confidence * 100)}%
                </span>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
