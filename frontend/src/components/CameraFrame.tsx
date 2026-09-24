import { useId } from 'react'
import { EQUIPMENT, type Camera, type Detection, type Snapshot } from '@/data'
import { mediaUrl } from '@/api'
import { fmtTimeSec, fmtDateShort, fmtWhen } from '@/lib/utils'
import { VehicleIcon } from './VehicleIcon'
import { cn, inkOn } from '@/lib/utils'

interface Props {
  camera: Camera
  snapshot?: Snapshot
  /** Подсветить рамки этих типов техники */
  highlight?: string[]
  showLabels?: boolean
  /** Показывать ли рамки распознавания (на странице проверки — только после анализа) */
  showBoxes?: boolean
  offline?: boolean
  /** Миниатюра: без подписей камеры и времени */
  thumb?: boolean
  className?: string
}

/**
 * Кадр с камеры (доказательство в отклонении) с рамками распознанной техники.
 * Если картинки кадра нет — рисуем стилизованную сцену, чтобы карточка не была пустой.
 */
export function CameraFrame({ camera, snapshot, highlight, showLabels = true, showBoxes = true, offline, thumb, className }: Props) {
  const gid = useId()
  const dets = snapshot?.detections ?? []
  // у демонстрационных камер номер из идентификатора (c1 → CAM-01), у добавленных — короткий код
  const camNo = /^c\d+$/.test(camera.id) ? `CAM-${camera.id.slice(1).padStart(2, '0')}` : `CAM-${camera.id.slice(-4).toUpperCase()}`
  return (
    <div className={cn('relative w-full aspect-video rounded-lg overflow-hidden bg-slate-900 select-none', className)}>
      {snapshot?.imageUrl ? (
        <img src={mediaUrl(snapshot.imageUrl)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <svg viewBox="0 0 160 90" className="absolute inset-0 w-full h-full" preserveAspectRatio="none" aria-hidden style={{ filter: 'saturate(.72) contrast(1.06) brightness(.94)' }}>
          <defs>
            <linearGradient id={`${gid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8fa6bd" />
              <stop offset="1" stopColor="#cfd8e0" />
            </linearGradient>
            <linearGradient id={`${gid}-ground`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={groundTop(camera.scene)} />
              <stop offset="1" stopColor={groundBottom(camera.scene)} />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill={`url(#${gid}-sky)`} />
          <Scene scene={camera.scene} groundFill={`url(#${gid}-ground)`} />
          {dets.map((d) => (
            <g key={d.id} transform={`translate(${(d.box.x / 100) * 160} ${(d.box.y / 100) * 90})`}>
              <VehicleSilhouette d={d} />
            </g>
          ))}
        </svg>
      )}

      {/* Зерно и виньетка — как на реальной камере наблюдения */}
      {!snapshot?.imageUrl && (
        <>
          <svg className="absolute inset-0 w-full h-full opacity-[0.22] mix-blend-overlay pointer-events-none" aria-hidden>
            <filter id={`${gid}-n`}><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter>
            <rect width="100%" height="100%" filter={`url(#${gid}-n)`} />
          </svg>
          <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.38) 100%)' }} />
        </>
      )}

      {offline && (
        <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center text-white">
          <span className={thumb ? 'text-sm font-semibold' : 'text-2xl font-semibold'}>Нет сигнала</span>
          {!thumb && <span className="text-sm opacity-80">последний кадр {snapshot ? fmtWhen(snapshot.takenAt) : '—'}</span>}
        </div>
      )}

      {/* Кадр получен, но разобрать его не удалось (например, демо-анализатор не знает этот вид) */}
      {!offline && !thumb && snapshot && !snapshot.analyzed && (
        <div className="absolute inset-x-0 bottom-0 bg-slate-950/75 text-white text-[13px] px-3 py-2 pr-40">
          Кадр получен, техника не распознана: {snapshot.note ?? 'сервис анализа недоступен'}
        </div>
      )}

      {/* Рамки распознавания */}
      {!offline && showBoxes && dets.map((d) => {
        const info = EQUIPMENT[d.type]
        const hl = !highlight || highlight.includes(d.type)
        return (
          <div
            key={d.id}
            className="absolute"
            style={{
              left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%`,
              border: `2px solid ${info.color}`, opacity: hl ? 1 : 0.4,
              boxShadow: hl ? '0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.25)' : 'none',
            }}
          >
            {showLabels && !thumb && (
              <span
                className={cn('absolute -left-[2px] text-[11px] leading-none font-semibold px-1.5 py-[3px] whitespace-nowrap font-mono', d.box.y >= 25 ? '-top-[19px]' : d.box.x < 35 ? 'bottom-0' : 'top-0')}
                style={{ background: info.color, color: inkOn(info.color) }}
              >
                {info.name} {d.confidence.toFixed(2)}
              </span>
            )}
          </div>
        )
      })}

      {/* Экранные надписи камеры */}
      {!thumb && (
        <>
          <div className="absolute left-2 top-2 text-white text-[11px] sm:text-[12px] font-mono leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">
            <div className="font-semibold">{camNo}</div>
            <div className="opacity-90">{camera.name.split('—')[1]?.trim() ?? camera.name}</div>
          </div>
          {!offline && (
            <div className="absolute right-2 top-2 flex items-center gap-1.5 text-white text-[11px] sm:text-[12px] font-mono [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">
              <span className="w-2 h-2 rounded-full bg-red-500" /> REC
            </div>
          )}
          {snapshot && (
            <div className="absolute right-2 bottom-2 text-white text-[11px] sm:text-[12px] font-mono [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">
              {fmtDateShort(snapshot.takenAt)} {fmtTimeSec(snapshot.takenAt)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Реалистичные цвета кузова по типу техники */
const BODY: Record<string, string> = {
  excavator: '#C99700', bulldozer: '#C99700', roller: '#C99700', dump_truck: '#B5541C',
  mixer: '#D8DCE2', truck: '#E3E6EA', manipulator: '#2F6DB5', crane: '#B3261E',
}

function VehicleSilhouette({ d }: { d: Detection }) {
  const w = (d.box.w / 100) * 160
  const h = (d.box.h / 100) * 90
  return (
    <svg x="0" y="0" width={w} height={h} viewBox="0 0 100 60" preserveAspectRatio="xMidYMax meet">
      <ellipse cx="50" cy="56" rx="44" ry="4" fill="#000" opacity=".28" />
      <VehicleIcon type={d.type} fill={BODY[d.type]} />
    </svg>
  )
}

function groundTop(scene: Camera['scene']) {
  return { pit: '#8b7355', foundation: '#8d8d8d', road: '#5d5f63', entrance: '#7a7d80', yard: '#8a8266' }[scene]
}
function groundBottom(scene: Camera['scene']) {
  return { pit: '#5c4a35', foundation: '#6f6f6f', road: '#3d3f43', entrance: '#5c5f63', yard: '#5f5945' }[scene]
}

/** Простые декорации, чтобы кадр читался как стройка */
function Scene({ scene, groundFill }: { scene: Camera['scene']; groundFill: string }) {
  return (
    <g>
      <rect x="0" y="34" width="160" height="56" fill={groundFill} />
      {scene === 'pit' && (
        <>
          <path d="M0 40 L30 36 L130 36 L160 40 L160 90 L0 90 Z" fill="#4e3d2b" opacity=".55" />
          <path d="M20 70 Q40 55 60 70 Q80 85 100 70" stroke="#3b2e20" strokeWidth="2" fill="none" opacity=".5" />
          <path d="M110 44 L135 38 L150 50 Z" fill="#6b5740" />
          <rect x="0" y="34" width="160" height="2" fill="#f2c94c" opacity=".6" />
        </>
      )}
      {scene === 'foundation' && (
        <>
          <rect x="10" y="48" width="140" height="34" fill="#a5a5a5" />
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={i} x1={14 + i * 16} y1="48" x2={14 + i * 16} y2="82" stroke="#7a4a2a" strokeWidth="1" opacity=".7" />
          ))}
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={i} x1="10" y1={54 + i * 8} x2="150" y2={54 + i * 8} stroke="#7a4a2a" strokeWidth="1" opacity=".7" />
          ))}
        </>
      )}
      {scene === 'road' && (
        <>
          <path d="M0 90 L60 34 L100 34 L160 90 Z" fill="#2f3136" />
          <path d="M78 34 L82 34 L88 90 L72 90 Z" fill="#f2c94c" opacity=".5" />
          <rect x="0" y="34" width="60" height="3" fill="#c0392b" opacity=".7" />
        </>
      )}
      {scene === 'entrance' && (
        <>
          <rect x="0" y="34" width="160" height="6" fill="#3f4a5a" />
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x={i * 14} y="34" width="7" height="6" fill="#f2c94c" opacity=".8" />
          ))}
          <rect x="120" y="14" width="30" height="22" fill="#d9dde3" />
          <rect x="124" y="18" width="8" height="8" fill="#6c8ba5" />
          <rect x="0" y="60" width="160" height="30" fill="#4f5257" />
        </>
      )}
      {scene === 'yard' && (
        <>
          <rect x="6" y="20" width="40" height="16" fill="#d0d4da" />
          <rect x="50" y="24" width="30" height="12" fill="#c5c9cf" />
          <rect x="100" y="60" width="24" height="10" fill="#8b5a2b" />
          <rect x="128" y="62" width="24" height="8" fill="#8b5a2b" />
        </>
      )}
    </g>
  )
}
