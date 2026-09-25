import { AnimatePresence, motion } from 'framer-motion'
import { EQUIPMENT, type LiveCamera } from '@/data'
import { useApp } from '@/store/context'
import { useTracks, type TrackObject } from '@/lib/useTracks'
import { cn, inkOn } from '@/lib/utils'
import { DetectionBoxes } from './DetectionBoxes'

/**
 * Рамки поверх живого видео. Подключён сервис разметки — рамки идут от него 10–15 раз в секунду и едут за техникой;
 * нет — рамки из анализа кадров, который разбирает кадр раз в 2 секунды.
 */
export function LiveBoxes({ cameraId, live, labels = true }: { cameraId: string; live?: LiveCamera; labels?: boolean }) {
  const { meta } = useApp()
  const tracks = useTracks(meta?.tracker?.enabled ? cameraId : null)
  if (tracks.length) return <TrackBoxes tracks={tracks} labels={labels} />
  return live ? <DetectionBoxes detections={live.detections} labels={labels} /> : null
}

/**
 * Каждая рамка привязана к своему track_id: между сообщениями она линейно доезжает до нового положения
 * за время, близкое к интервалу между сообщениями, — поэтому едет ровно, а не прыгает.
 * При «уменьшить движение» (MotionConfig в App) рамка сразу встаёт на место.
 */
function TrackBoxes({ tracks, labels }: { tracks: TrackObject[]; labels: boolean }) {
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
              transition={{ duration: 0.12, ease: 'linear', opacity: { duration: 0.15 } }}
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
