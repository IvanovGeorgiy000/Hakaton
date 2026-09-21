import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, MapPin, Clock } from 'lucide-react'
import { CAMERAS, SNAPSHOTS, type Alert } from '@/data'
import { alertCode, bySite, byZone } from '@/store/selectors'
import { ago } from '@/lib/utils'
import { SEVERITY, STATUS } from '@/lib/labels'
import { Badge } from './ui/Badge'
import { CameraFrame } from './CameraFrame'
import { cn } from '@/lib/utils'

interface Props {
  alert: Alert
  onOpen: (a: Alert) => void
  showSite?: boolean
  compact?: boolean
}

/** Карточка отклонения: одна большая кнопка — вся карточка */
export function AlertCard({ alert, onOpen, showSite, compact }: Props) {
  const reduce = useReducedMotion()
  const sev = SEVERITY[alert.severity]
  const st = STATUS[alert.status]
  const snap = SNAPSHOTS.find((s) => s.id === alert.evidence[alert.evidence.length - 1])
  const cam = snap ? CAMERAS.find((c) => c.id === snap.cameraId) : undefined
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(alert)}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      className={cn(
        'w-full text-left bg-card rounded-xl border border-border overflow-hidden cursor-pointer shadow-[var(--shadow-card)]',
        'flex items-stretch transition-shadow duration-200 hover:shadow-md hover:border-primary/50',
      )}
    >
      <span className={cn('w-1.5 shrink-0', sev.bar)} aria-hidden />
      <span className="flex-1 min-w-0 flex flex-col">
      {/* На телефоне фото идёт широкой полосой сверху карточки */}
      {!compact && cam && (
        <span className="block sm:hidden">
          <CameraFrame camera={cam} snapshot={snap} thumb showBoxes={false} offline={alert.kind === 'camera_offline'} className="aspect-[5/2] rounded-none" />
        </span>
      )}
      <span className="flex-1 min-w-0 p-4 flex gap-4 items-center">
        {!compact && cam && (
          <span className="hidden sm:block w-40 shrink-0">
            <CameraFrame camera={cam} snapshot={snap} showLabels={false} thumb highlight={alert.equipment && (alert.kind === 'unexpected' || alert.kind === 'idle') ? [alert.equipment] : undefined} offline={alert.kind === 'camera_offline'} />
          </span>
        )}
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge tone={sev.tone}>{sev.label}</Badge>
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="text-[13px] text-muted-foreground font-mono ml-auto hidden sm:inline">№ {alertCode(alert)}</span>
          </span>
          <span className="block text-lg sm:text-xl font-bold leading-snug">{alert.title}</span>
          {!compact && <span className="block text-muted-foreground mt-1 line-clamp-2">{alert.summary}</span>}
          <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[14px] text-muted-foreground">
            {showSite && <span className="font-semibold text-foreground">{bySite(alert.siteId).name}</span>}
            <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" />{byZone(alert.zoneId).name}</span>
            <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" />{ago(alert.startedAt)}</span>
          </span>
        </span>
        <ChevronRight className="w-7 h-7 text-muted-foreground shrink-0" />
      </span>
      </span>
    </motion.button>
  )
}
