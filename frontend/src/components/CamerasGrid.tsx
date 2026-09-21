import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, Loader2 } from 'lucide-react'
import { SNAPSHOTS, EQUIPMENT, type Camera, type Snapshot } from '@/data'
import { useApp } from '@/store/context'
import { byZone } from '@/store/selectors'
import { ago, fmtTime } from '@/lib/utils'
import { CameraFrame } from './CameraFrame'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { cn } from '@/lib/utils'

const STEPS = ['Получаем снимки с камер…', 'Ищем технику на снимках…', 'Сверяем с планом работ…', 'Готово']

/** Сетка камер объекта с последними снимками и кнопкой «Проверить сейчас» (демо-анализ) */
export function CamerasGrid({ siteId }: { siteId: string }) {
  const { cameras } = useApp()
  const list = cameras.filter((c) => c.siteId === siteId)
  const [open, setOpen] = useState<Camera | null>(null)
  const [step, setStep] = useState<number | null>(null)

  const runCheck = () => {
    setStep(0)
    STEPS.forEach((_, i) => setTimeout(() => setStep(i), 700 * i))
    setTimeout(() => setStep(null), 700 * STEPS.length + 600)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-muted-foreground">Снимки обновляются каждый час автоматически.</p>
        <Button onClick={runCheck} disabled={step !== null} size="lg">
          {step === null ? <RefreshCw className="w-5 h-5" /> : <Loader2 className="w-5 h-5 animate-spin" />}
          Проверить сейчас
        </Button>
      </div>
      <AnimatePresence>
        {step !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-info-bg text-info-fg rounded-xl p-4 flex items-center gap-3 font-semibold">
              {step < STEPS.length - 1 ? <Loader2 className="w-6 h-6 animate-spin shrink-0" /> : <span className="w-6 h-6 rounded-full bg-ok text-white flex items-center justify-center text-sm">✓</span>}
              {STEPS[step]}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="grid sm:grid-cols-2 gap-4">
        {list.map((c) => {
          const last = SNAPSHOTS.filter((s) => s.cameraId === c.id).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0]
          return (
            <button
              key={c.id} type="button" onClick={() => setOpen(c)}
              className="text-left bg-card rounded-xl border border-border overflow-hidden cursor-pointer hover:border-primary/60 hover:shadow-md transition-all"
            >
              <CameraFrame camera={c} snapshot={last} offline={!c.online} className="rounded-none" />
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold">{c.name}</div>
                  <Badge tone={c.online ? 'ok' : 'neutral'}>{c.online ? 'Работает' : 'Нет сигнала'}</Badge>
                </div>
                <div className="text-muted-foreground text-[14px]">{byZone(c.zoneId).name} · снимок {ago(c.lastSnapshotAt)}</div>
                {last && c.online && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {summarize(last).map(([t, n]) => (
                      <span key={t} className="text-[13px] font-semibold rounded-full px-2 py-0.5 text-white" style={{ background: EQUIPMENT[t as keyof typeof EQUIPMENT].color }}>
                        {EQUIPMENT[t as keyof typeof EQUIPMENT].name} ×{n}
                      </span>
                    ))}
                    {last.detections.length === 0 && <span className="text-[13px] text-muted-foreground">техники не видно</span>}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <CameraHistory camera={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function summarize(s: Snapshot) {
  const m: Record<string, number> = {}
  s.detections.forEach((d) => { m[d.type] = (m[d.type] ?? 0) + 1 })
  return Object.entries(m)
}

/** История снимков одной камеры за день */
function CameraHistory({ camera, onClose }: { camera: Camera | null; onClose: () => void }) {
  const snaps = camera ? SNAPSHOTS.filter((s) => s.cameraId === camera.id && s.takenAt.startsWith('2026-09-15')).sort((a, b) => b.takenAt.localeCompare(a.takenAt)) : []
  const [idx, setIdx] = useState(0)
  const cur = snaps[idx] ?? snaps[0]
  return (
    <Modal open={!!camera} onClose={() => { onClose(); setIdx(0) }} title={camera?.name ?? ''} wide>
      {camera && cur && (
        <div className="space-y-4">
          <CameraFrame camera={camera} snapshot={cur} offline={!camera.online} />
          <div>
            <div className="font-semibold mb-2">Снимки за сегодня</div>
            <div className="flex flex-wrap gap-2">
              {snaps.map((s, i) => (
                <button
                  key={s.id} type="button" onClick={() => setIdx(i)}
                  className={cn('min-h-[44px] px-4 rounded-lg font-semibold border-2 cursor-pointer transition-colors', i === idx ? 'border-primary bg-info-bg text-info-fg' : 'border-border hover:border-primary/60')}
                >
                  {fmtTime(s.takenAt)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold mb-2">Что видно на снимке</div>
            {cur.detections.length === 0 ? (
              <p className="text-muted-foreground">Техники не обнаружено.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-2">
                {cur.detections.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 bg-muted/60 rounded-lg px-3 py-2">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: EQUIPMENT[d.type].color }} />
                    <span className="font-semibold flex-1">{EQUIPMENT[d.type].name}</span>
                    <span className="text-muted-foreground text-[14px]">{d.moving ? 'движется' : 'стоит'} · {Math.round(d.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
